//! Encrypted P2P Chat
//!
//! Provides basic end-to-end encrypted messaging between Libmaly users for
//! coordinating multiplayer sessions or sharing game notes.
//!
//! # Cryptography
//! - **Key agreement**: X25519 Diffie-Hellman (one keypair per identity, stored in vault)
//! - **Encryption**: ChaCha20-Poly1305 AEAD (256-bit key, 96-bit nonce)
//! - **Authentication**: ED25519 signature over (nonce ‖ ciphertext), using the
//!   existing social identity signing key
//! - **KDF**: SHA-256(shared_secret ‖ "libmaly-chat-v1") → ChaCha20 key
//!
//! # Transport
//! If a Pulse relay is configured and supports the `"chat"` capability, messages
//! are posted to:
//!   POST {relay}/pulse/{room}/chat/send        → OutboundEnvelope
//!   GET  {relay}/pulse/{room}/chat/inbox/{fp}?since={ts} → Vec<OutboundEnvelope>
//!
//! When the relay is unavailable, outgoing messages are queued locally (status
//! "pending") and re-tried on the next `chat_fetch_remote` call.
//!
//! # Key exchange
//! Share your X25519 public key (returned by `chat_get_my_x25519_pub`) with
//! peers — for example by pasting it into a conversation starter.  The UI
//! presents this as a copyable "chat key".  Contacts are stored locally with
//! their name + X25519 public key so subsequent messages are one-tap.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Key, Nonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret as X25519Secret};

use crate::data_paths::app_data_root;
use crate::vault::{get_secret, set_secret};

// ── Constants ─────────────────────────────────────────────────────────────────

const VAULT_X25519_PRIVATE: &str = "chat::x25519::private_key";
const CONFIG_FILE: &str = "chat_config.json";
const MESSAGES_DIR: &str = "chat_messages";
const CONTACTS_FILE: &str = "chat_contacts.json";
const KDF_LABEL: &[u8] = b"libmaly-chat-v1";
/// Maximum messages stored per conversation.
const MAX_MESSAGES_PER_CONV: usize = 500;
/// How many seconds back to fetch from relay on each poll.
const RELAY_FETCH_WINDOW_SECS: u64 = 3600;

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatConfig {
    /// Whether P2P chat is enabled.
    #[serde(default)]
    pub enabled: bool,

    /// Relay base URL (e.g. "https://relay.example.com").
    /// When None, messages are stored locally only.
    #[serde(default)]
    pub relay_url: Option<String>,

    /// Shared room key — must match across all participants.
    /// Defaults to the Pulse room key if set.
    #[serde(default)]
    pub room_key: Option<String>,

    /// Cached local X25519 public key (base64).
    #[serde(default)]
    pub my_x25519_pub_b64: String,
}

impl Default for ChatConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            relay_url: None,
            room_key: None,
            my_x25519_pub_b64: String::new(),
        }
    }
}

// ── Contact ───────────────────────────────────────────────────────────────────

/// A known peer — name + their X25519 public key for encryption.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatContact {
    /// ED25519-derived fingerprint of the peer (8-byte hex as "ab:cd:…").
    pub fingerprint: String,
    /// Human-readable display name.
    pub name: String,
    /// Base64-encoded X25519 public key (32 bytes).
    pub x25519_pub_b64: String,
    /// Unix timestamp when contact was added.
    pub added_at: u64,
}

// ── Wire format ───────────────────────────────────────────────────────────────

/// The envelope posted to / fetched from the relay.
/// All binary blobs are base64-encoded.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct OutboundEnvelope {
    /// Random UUID-style message id.
    message_id: String,
    /// Sender's ED25519 fingerprint.
    sender_fingerprint: String,
    /// Sender's display name (plaintext, informational).
    sender_name: String,
    /// Sender's X25519 public key (base64) — lets recipient compute shared secret.
    sender_x25519_pub_b64: String,
    /// Recipient's ED25519 fingerprint ("*" = room broadcast).
    recipient_fingerprint: String,
    /// ChaCha20-Poly1305 ciphertext (base64).
    ciphertext_b64: String,
    /// 12-byte nonce (base64).
    nonce_b64: String,
    /// ED25519 signature over SHA-256(nonce_bytes ‖ ciphertext_bytes) (base64).
    signature_b64: String,
    /// Unix timestamp (seconds).
    timestamp: u64,
}

// ── Stored message ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub peer_fingerprint: String,
    pub peer_name: String,
    pub direction: String, // "sent" | "received"
    pub plaintext: String,
    pub timestamp: u64,
    pub status: String, // "delivered" | "pending" | "failed"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub peer_fingerprint: String,
    pub peer_name: String,
    pub last_message: String,
    pub last_timestamp: u64,
    pub unread_count: u32,
}

// ── Path helpers ──────────────────────────────────────────────────────────────

fn config_path() -> std::path::PathBuf {
    app_data_root().join(CONFIG_FILE)
}

fn contacts_path() -> std::path::PathBuf {
    app_data_root().join(CONTACTS_FILE)
}

fn messages_path(peer_fingerprint: &str) -> std::path::PathBuf {
    // Sanitize fingerprint for use as filename.
    let safe: String = peer_fingerprint
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    app_data_root().join(MESSAGES_DIR).join(format!("{}.json", safe))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── Persistence ───────────────────────────────────────────────────────────────

fn load_config() -> ChatConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_config(cfg: &ChatConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).ok(); }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_contacts() -> Vec<ChatContact> {
    std::fs::read_to_string(contacts_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_contacts(contacts: &[ChatContact]) -> Result<(), String> {
    let path = contacts_path();
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).ok(); }
    let json = serde_json::to_string_pretty(contacts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_messages(peer_fingerprint: &str) -> Vec<ChatMessageRecord> {
    std::fs::read_to_string(messages_path(peer_fingerprint))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_messages(peer_fingerprint: &str, msgs: &[ChatMessageRecord]) -> Result<(), String> {
    let path = messages_path(peer_fingerprint);
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).ok(); }
    let json = serde_json::to_string_pretty(msgs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Key management ────────────────────────────────────────────────────────────

/// Load or generate the local X25519 static secret.
fn get_or_create_x25519_secret() -> Result<X25519Secret, String> {
    if let Ok(Some(b64)) = get_secret(VAULT_X25519_PRIVATE) {
        let bytes = B64.decode(&b64).map_err(|e| e.to_string())?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "invalid stored X25519 key length".to_string())?;
        return Ok(X25519Secret::from(arr));
    }
    // Generate fresh.
    let secret = X25519Secret::random_from_rng(OsRng);
    let b64 = B64.encode(secret.to_bytes());
    set_secret(VAULT_X25519_PRIVATE, &b64).map_err(|e| e.to_string())?;
    Ok(secret)
}

/// Derive a 32-byte ChaCha20 key from the X25519 shared secret.
fn derive_chacha_key(shared_secret: &[u8; 32]) -> Key {
    let mut h = Sha256::new();
    h.update(shared_secret);
    h.update(KDF_LABEL);
    let hash_bytes: [u8; 32] = h.finalize().into();
    Key::from(hash_bytes)
}

/// Load the ED25519 signing key from vault (same key used by social_identity).
fn get_signing_key() -> Option<SigningKey> {
    let b64 = get_secret("social::identity::private_key").ok()??;
    let bytes = B64.decode(&b64).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    Some(SigningKey::from_bytes(&arr))
}

fn my_fingerprint() -> Option<String> {
    let profile_path = app_data_root().join("social_identity.json");
    let json = std::fs::read_to_string(&profile_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&json).ok()?;
    let pub_b64 = v["publicKeyB64"].as_str()?;
    let bytes = B64.decode(pub_b64).ok()?;
    Some(
        bytes
            .iter()
            .take(8)
            .map(|b| format!("{:02x}", b))
            .collect::<Vec<_>>()
            .join(":"),
    )
}

fn my_display_name() -> String {
    let profile_path = app_data_root().join("social_identity.json");
    std::fs::read_to_string(&profile_path)
        .ok()
        .and_then(|s| {
            let v: serde_json::Value = serde_json::from_str(&s).ok()?;
            v["displayName"].as_str().map(|s| s.to_string())
        })
        .unwrap_or_else(|| "Me".to_string())
}

// ── Encryption ────────────────────────────────────────────────────────────────

fn encrypt_message(
    plaintext: &str,
    recipient_x25519_pub_b64: &str,
    sender_fingerprint: &str,
    recipient_fingerprint: &str,
) -> Result<(String, String), String> {
    let my_secret = get_or_create_x25519_secret()?;
    let pub_bytes = B64.decode(recipient_x25519_pub_b64).map_err(|e| e.to_string())?;
    let pub_arr: [u8; 32] = pub_bytes
        .try_into()
        .map_err(|_| "invalid recipient X25519 key".to_string())?;
    let recipient_pub = X25519PublicKey::from(pub_arr);

    let shared_secret = my_secret.diffie_hellman(&recipient_pub);
    let chacha_key = derive_chacha_key(shared_secret.as_bytes());
    let cipher = ChaCha20Poly1305::new(&chacha_key);

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);

    let aad = format!("{}:{}", sender_fingerprint, recipient_fingerprint);
    let payload = Payload {
        msg: plaintext.as_bytes(),
        aad: aad.as_bytes(),
    };

    let ciphertext = cipher
        .encrypt(&nonce, payload)
        .map_err(|_| "encryption failed".to_string())?;

    Ok((B64.encode(&ciphertext), B64.encode(&nonce_bytes)))
}

fn decrypt_message(
    ciphertext_b64: &str,
    nonce_b64: &str,
    sender_x25519_pub_b64: &str,
    sender_fingerprint: &str,
    recipient_fingerprint: &str,
) -> Result<String, String> {
    let my_secret = get_or_create_x25519_secret()?;
    let pub_bytes = B64.decode(sender_x25519_pub_b64).map_err(|e| e.to_string())?;
    let pub_arr: [u8; 32] = pub_bytes
        .try_into()
        .map_err(|_| "invalid sender X25519 key".to_string())?;
    let sender_pub = X25519PublicKey::from(pub_arr);

    let shared_secret = my_secret.diffie_hellman(&sender_pub);
    let chacha_key = derive_chacha_key(shared_secret.as_bytes());
    let cipher = ChaCha20Poly1305::new(&chacha_key);

    let ciphertext = B64.decode(ciphertext_b64).map_err(|e| e.to_string())?;
    let nonce_bytes = B64.decode(nonce_b64).map_err(|e| e.to_string())?;
    let nonce_arr: [u8; 12] = nonce_bytes
        .try_into()
        .map_err(|_| "invalid nonce".to_string())?;
    let nonce = Nonce::from(nonce_arr);

    let aad = format!("{}:{}", sender_fingerprint, recipient_fingerprint);
    let payload = Payload {
        msg: &ciphertext,
        aad: aad.as_bytes(),
    };

    let plaintext_bytes = cipher
        .decrypt(&nonce, payload)
        .map_err(|_| "decryption failed — message may be corrupted or from wrong key".to_string())?;

    String::from_utf8(plaintext_bytes).map_err(|e| e.to_string())
}

fn sign_message(nonce_b64: &str, ciphertext_b64: &str) -> Result<String, String> {
    let signing_key = get_signing_key().ok_or("no social identity key — generate one first")?;
    let nonce_bytes = B64.decode(nonce_b64).map_err(|e| e.to_string())?;
    let cipher_bytes = B64.decode(ciphertext_b64).map_err(|e| e.to_string())?;
    let mut msg = Vec::with_capacity(nonce_bytes.len() + cipher_bytes.len());
    msg.extend_from_slice(&nonce_bytes);
    msg.extend_from_slice(&cipher_bytes);
    let sig: Signature = signing_key.sign(&msg);
    Ok(B64.encode(sig.to_bytes()))
}

fn verify_signature(
    nonce_b64: &str,
    ciphertext_b64: &str,
    signature_b64: &str,
    sender_ed25519_pub_b64: &str,
) -> bool {
    (|| -> Option<bool> {
        let pub_bytes = B64.decode(sender_ed25519_pub_b64).ok()?;
        let pub_arr: [u8; 32] = pub_bytes.try_into().ok()?;
        let verifying_key = VerifyingKey::from_bytes(&pub_arr).ok()?;

        let sig_bytes = B64.decode(signature_b64).ok()?;
        let sig_arr: [u8; 64] = sig_bytes.try_into().ok()?;
        let signature = Signature::from_bytes(&sig_arr);

        let nonce_bytes = B64.decode(nonce_b64).ok()?;
        let cipher_bytes = B64.decode(ciphertext_b64).ok()?;
        let mut msg = Vec::with_capacity(nonce_bytes.len() + cipher_bytes.len());
        msg.extend_from_slice(&nonce_bytes);
        msg.extend_from_slice(&cipher_bytes);

        Some(verifying_key.verify(&msg, &signature).is_ok())
    })()
    .unwrap_or(false)
}

/// Look up a contact's ED25519 public key by fingerprint from social_identity
/// or the known-peers list (best-effort; used for signature verification).
fn lookup_ed25519_pub(fingerprint: &str) -> Option<String> {
    // Check social peers registry.
    let peers_path = app_data_root().join("social_peers.json");
    if let Ok(data) = std::fs::read_to_string(&peers_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(arr) = v.as_array() {
                for peer in arr {
                    let fp = peer["fingerprint"].as_str().unwrap_or("");
                    if fp == fingerprint {
                        if let Some(pub_b64) = peer["publicKeyB64"].as_str() {
                            return Some(pub_b64.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

// ── Relay transport ───────────────────────────────────────────────────────────

async fn relay_send(
    relay_url: &str,
    room_key: &str,
    envelope: &OutboundEnvelope,
) -> Result<(), String> {
    let url = format!("{}/pulse/{}/chat/send", relay_url.trim_end_matches('/'), room_key);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(envelope)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("relay returned {}", resp.status()))
    }
}

async fn relay_fetch(
    relay_url: &str,
    room_key: &str,
    my_fingerprint: &str,
    since: u64,
) -> Result<Vec<OutboundEnvelope>, String> {
    let url = format!(
        "{}/pulse/{}/chat/inbox/{}?since={}",
        relay_url.trim_end_matches('/'),
        room_key,
        my_fingerprint,
        since
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("relay returned {}", resp.status()));
    }

    resp.json::<Vec<OutboundEnvelope>>()
        .await
        .map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the current chat configuration.
#[tauri::command]
pub fn chat_get_config() -> ChatConfig {
    load_config()
}

/// Save chat configuration.
#[tauri::command]
pub fn chat_save_config(config: ChatConfig) -> Result<(), String> {
    persist_config(&config)
}

/// Return the local X25519 public key (base64) for sharing with contacts.
/// Generates and stores the keypair on first call.
#[tauri::command]
pub fn chat_get_my_x25519_pub() -> Result<String, String> {
    let secret = get_or_create_x25519_secret()?;
    let pub_key = X25519PublicKey::from(&secret);
    let pub_b64 = B64.encode(pub_key.as_bytes());

    // Cache in config.
    let mut cfg = load_config();
    if cfg.my_x25519_pub_b64 != pub_b64 {
        cfg.my_x25519_pub_b64 = pub_b64.clone();
        let _ = persist_config(&cfg);
    }
    Ok(pub_b64)
}

/// Return all known contacts.
#[tauri::command]
pub fn chat_get_contacts() -> Vec<ChatContact> {
    load_contacts()
}

/// Add or update a contact.
#[tauri::command]
pub fn chat_save_contact(
    fingerprint: String,
    name: String,
    x25519_pub_b64: String,
) -> Result<(), String> {
    // Validate base64 and key length.
    let bytes = B64.decode(&x25519_pub_b64).map_err(|e| format!("invalid X25519 key: {}", e))?;
    if bytes.len() != 32 {
        return Err("X25519 key must be exactly 32 bytes".to_string());
    }

    let mut contacts = load_contacts();
    if let Some(existing) = contacts.iter_mut().find(|c| c.fingerprint == fingerprint) {
        existing.name = name.chars().take(64).collect();
        existing.x25519_pub_b64 = x25519_pub_b64;
    } else {
        contacts.push(ChatContact {
            fingerprint,
            name: name.chars().take(64).collect(),
            x25519_pub_b64,
            added_at: now_secs(),
        });
    }
    persist_contacts(&contacts)
}

/// Remove a contact (does not delete message history).
#[tauri::command]
pub fn chat_remove_contact(fingerprint: String) -> Result<(), String> {
    let mut contacts = load_contacts();
    contacts.retain(|c| c.fingerprint != fingerprint);
    persist_contacts(&contacts)
}

/// Return all conversation summaries sorted by most-recent message.
#[tauri::command]
pub fn chat_get_conversations() -> Vec<ConversationSummary> {
    let contacts = load_contacts();
    let messages_dir = app_data_root().join(MESSAGES_DIR);

    let mut summaries: Vec<ConversationSummary> = contacts
        .iter()
        .map(|c| {
            let msgs = load_messages(&c.fingerprint);
            let last = msgs.last();
            let unread = msgs
                .iter()
                .filter(|m| m.direction == "received" && m.status == "delivered")
                .count() as u32;
            ConversationSummary {
                peer_fingerprint: c.fingerprint.clone(),
                peer_name: c.name.clone(),
                last_message: last
                    .map(|m| {
                        if m.plaintext.len() > 80 {
                            format!("{}…", &m.plaintext[..80])
                        } else {
                            m.plaintext.clone()
                        }
                    })
                    .unwrap_or_default(),
                last_timestamp: last.map(|m| m.timestamp).unwrap_or(c.added_at),
                unread_count: unread,
            }
        })
        .collect();

    // Also include any conversation files for unknown contacts (relay-received).
    if let Ok(entries) = std::fs::read_dir(&messages_dir) {
        for entry in entries.flatten() {
            if let Some(stem) = entry.path().file_stem().and_then(|s| s.to_str()) {
                let fp = stem.replace('_', ":");
                if !summaries.iter().any(|s| s.peer_fingerprint == fp) {
                    let msgs = load_messages(stem);
                    if let Some(last) = msgs.last() {
                        summaries.push(ConversationSummary {
                            peer_fingerprint: last.peer_fingerprint.clone(),
                            peer_name: last.peer_name.clone(),
                            last_message: if last.plaintext.len() > 80 {
                                format!("{}…", &last.plaintext[..80])
                            } else {
                                last.plaintext.clone()
                            },
                            last_timestamp: last.timestamp,
                            unread_count: 0,
                        });
                    }
                }
            }
        }
    }

    summaries.sort_by(|a, b| b.last_timestamp.cmp(&a.last_timestamp));
    summaries
}

/// Return all stored messages for a conversation.
#[tauri::command]
pub fn chat_get_messages(peer_fingerprint: String) -> Vec<ChatMessageRecord> {
    load_messages(&peer_fingerprint)
}

/// Mark all received messages from a peer as read (clears unread badge).
#[tauri::command]
pub fn chat_mark_read(peer_fingerprint: String) -> Result<(), String> {
    let mut msgs = load_messages(&peer_fingerprint);
    for m in msgs.iter_mut() {
        if m.direction == "received" && m.status == "delivered" {
            m.status = "read".to_string();
        }
    }
    persist_messages(&peer_fingerprint, &msgs)
}

/// Delete all messages in a conversation.
#[tauri::command]
pub fn chat_delete_conversation(peer_fingerprint: String) -> Result<(), String> {
    let path = messages_path(&peer_fingerprint);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Send an encrypted message to a contact.
/// Requires that the contact's X25519 public key is known (via chat_save_contact).
/// Posts to relay if configured; always stores locally.
#[tauri::command]
pub async fn chat_send_message(
    recipient_fingerprint: String,
    plaintext: String,
) -> Result<(), String> {
    if plaintext.trim().is_empty() {
        return Err("cannot send an empty message".to_string());
    }
    if plaintext.len() > 4096 {
        return Err("message exceeds 4096 character limit".to_string());
    }

    let contacts = load_contacts();
    let contact = contacts
        .iter()
        .find(|c| c.fingerprint == recipient_fingerprint)
        .ok_or("contact not found — add them first")?;

    let my_fp = my_fingerprint().ok_or("no social identity — generate one in Social settings")?;
    let my_name = my_display_name();

    let (ciphertext_b64, nonce_b64) = encrypt_message(
        &plaintext,
        &contact.x25519_pub_b64,
        &my_fp,
        &recipient_fingerprint,
    )?;
    let signature_b64 = sign_message(&nonce_b64, &ciphertext_b64)?;

    let my_secret = get_or_create_x25519_secret()?;
    let my_x25519_pub = X25519PublicKey::from(&my_secret);
    let sender_x25519_pub_b64 = B64.encode(my_x25519_pub.as_bytes());

    let envelope = OutboundEnvelope {
        message_id: random_id(),
        sender_fingerprint: my_fp.clone(),
        sender_name: my_name.clone(),
        sender_x25519_pub_b64,
        recipient_fingerprint: recipient_fingerprint.clone(),
        ciphertext_b64,
        nonce_b64,
        signature_b64,
        timestamp: now_secs(),
    };

    // Attempt relay delivery.
    let cfg = load_config();
    let mut status = "pending".to_string();
    if let (Some(relay_url), Some(room_key)) = (&cfg.relay_url, &cfg.room_key) {
        if cfg.enabled {
            match relay_send(relay_url, room_key, &envelope).await {
                Ok(_) => status = "delivered".to_string(),
                Err(_) => {} // keep "pending"; next fetch retry will re-queue
            }
        }
    }

    // Store locally.
    let record = ChatMessageRecord {
        id: envelope.message_id.clone(),
        peer_fingerprint: recipient_fingerprint.clone(),
        peer_name: contact.name.clone(),
        direction: "sent".to_string(),
        plaintext,
        timestamp: envelope.timestamp,
        status,
    };
    let mut msgs = load_messages(&recipient_fingerprint);
    msgs.push(record);
    if msgs.len() > MAX_MESSAGES_PER_CONV {
        msgs.drain(0..msgs.len() - MAX_MESSAGES_PER_CONV);
    }
    persist_messages(&recipient_fingerprint, &msgs)
}

/// Retry sending pending outbound messages and fetch new inbound messages from relay.
/// Returns the number of new messages received.
#[tauri::command]
pub async fn chat_fetch_remote() -> Result<usize, String> {
    let cfg = load_config();
    if !cfg.enabled {
        return Ok(0);
    }
    let relay_url = match &cfg.relay_url {
        Some(u) => u.clone(),
        None => return Ok(0),
    };
    let room_key = match &cfg.room_key {
        Some(k) => k.clone(),
        None => return Ok(0),
    };
    let my_fp = match my_fingerprint() {
        Some(fp) => fp,
        None => return Ok(0),
    };

    let since = now_secs().saturating_sub(RELAY_FETCH_WINDOW_SECS);
    let envelopes = relay_fetch(&relay_url, &room_key, &my_fp, since)
        .await
        .unwrap_or_default();

    let contacts = load_contacts();
    let mut new_count = 0usize;

    for env in &envelopes {
        // Skip messages sent by ourselves.
        if env.sender_fingerprint == my_fp {
            continue;
        }
        // Must be addressed to us or broadcast.
        if env.recipient_fingerprint != my_fp && env.recipient_fingerprint != "*" {
            continue;
        }

        // Find sender in contacts for signature verification.
        let sender_ed25519_pub = contacts
            .iter()
            .find(|c| c.fingerprint == env.sender_fingerprint)
            .and_then(|_| lookup_ed25519_pub(&env.sender_fingerprint));

        // Verify signature if we have the sender's ED25519 key.
        if let Some(ref pub_b64) = sender_ed25519_pub {
            if !verify_signature(&env.nonce_b64, &env.ciphertext_b64, &env.signature_b64, pub_b64) {
                continue; // drop tampered message silently
            }
        }

        // Decrypt.
        let plaintext = match decrypt_message(
            &env.ciphertext_b64,
            &env.nonce_b64,
            &env.sender_x25519_pub_b64,
            &env.sender_fingerprint,
            &my_fp,
        ) {
            Ok(p) => p,
            Err(_) => continue, // not for us or wrong key
        };

        // Check for duplicate (already stored).
        let peer_fp = env.sender_fingerprint.clone();
        let mut msgs = load_messages(&peer_fp);
        if msgs.iter().any(|m| m.id == env.message_id) {
            continue;
        }

        msgs.push(ChatMessageRecord {
            id: env.message_id.clone(),
            peer_fingerprint: peer_fp.clone(),
            peer_name: env.sender_name.clone(),
            direction: "received".to_string(),
            plaintext,
            timestamp: env.timestamp,
            status: "delivered".to_string(),
        });
        if msgs.len() > MAX_MESSAGES_PER_CONV {
            msgs.drain(0..msgs.len() - MAX_MESSAGES_PER_CONV);
        }
        let _ = persist_messages(&peer_fp, &msgs);
        new_count += 1;
    }

    // Retry pending outbound messages.
    let contacts_snap = load_contacts();
    for contact in &contacts_snap {
        let mut msgs = load_messages(&contact.fingerprint);
        let mut changed = false;
        for m in msgs.iter_mut() {
            if m.direction == "sent" && m.status == "pending" {
                // Re-encrypt and re-send.
                if let Ok((ct, nonce)) = encrypt_message(
                    &m.plaintext,
                    &contact.x25519_pub_b64,
                    &my_fp,
                    &contact.fingerprint,
                ) {
                    if let Ok(sig) = sign_message(&nonce, &ct) {
                        let my_secret = get_or_create_x25519_secret().unwrap();
                        let my_x25519_pub = X25519PublicKey::from(&my_secret);
                        let env = OutboundEnvelope {
                            message_id: m.id.clone(),
                            sender_fingerprint: my_fp.clone(),
                            sender_name: my_display_name(),
                            sender_x25519_pub_b64: B64.encode(my_x25519_pub.as_bytes()),
                            recipient_fingerprint: contact.fingerprint.clone(),
                            ciphertext_b64: ct,
                            nonce_b64: nonce,
                            signature_b64: sig,
                            timestamp: m.timestamp,
                        };
                        if relay_send(&relay_url, &room_key, &env).await.is_ok() {
                            m.status = "delivered".to_string();
                            changed = true;
                        }
                    }
                }
            }
        }
        if changed {
            let _ = persist_messages(&contact.fingerprint, &msgs);
        }
    }

    Ok(new_count)
}
