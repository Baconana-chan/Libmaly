//! Decentralized Sharing — Nostr and Mastodon/ActivityPub
//!
//! Publishes game reviews, ratings, and screenshots to decentralized social feeds.
//!
//! # Nostr
//! - Generates a secp256k1 keypair (private key stored in OS vault)
//! - Constructs kind:1 text notes with BIP340 Schnorr signatures
//! - Publishes to user-configured WebSocket relays
//!
//! # Mastodon / ActivityPub
//! - Uses the standard Mastodon-compatible client HTTP API
//! - Optionally uploads a screenshot via POST /api/v2/media
//! - Bearer token authentication (obtained from the instance's apps page)

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use rand::rngs::OsRng;
use secp256k1::{Keypair, Message, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

use crate::data_paths::app_data_root;
use crate::vault::{get_secret, set_secret};

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_FILE: &str = "dshare_config.json";
const VAULT_NOSTR_SECRET: &str = "dshare::nostr::secret_key";

// ── Helpers ───────────────────────────────────────────────────────────────────

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DShareConfig {
    /// Nostr WebSocket relay URLs (e.g. "wss://relay.damus.io").
    #[serde(default)]
    pub nostr_relays: Vec<String>,

    /// Mastodon-compatible instance URL (e.g. "https://mastodon.social").
    #[serde(default)]
    pub mastodon_instance_url: Option<String>,

    /// Mastodon Bearer access token.
    #[serde(default)]
    pub mastodon_access_token: Option<String>,

    /// Default post visibility. "public" | "unlisted" | "followers" | "direct"
    #[serde(default = "default_visibility")]
    pub mastodon_visibility: String,

    /// Cached local Nostr hex public key (xonly, 64 chars).
    #[serde(default)]
    pub nostr_pubkey_hex: String,
}

fn default_visibility() -> String {
    "public".to_string()
}

impl Default for DShareConfig {
    fn default() -> Self {
        Self {
            nostr_relays: vec![
                "wss://relay.damus.io".to_string(),
                "wss://nos.lol".to_string(),
                "wss://relay.nostr.band".to_string(),
            ],
            mastodon_instance_url: None,
            mastodon_access_token: None,
            mastodon_visibility: default_visibility(),
            nostr_pubkey_hex: String::new(),
        }
    }
}

// ── Post and result types ─────────────────────────────────────────────────────

/// Input for a share action.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DSharePost {
    pub game_title: String,
    /// 1–10 rating; None = no rating included.
    #[serde(default)]
    pub rating: Option<u8>,
    #[serde(default)]
    pub review_text: Option<String>,
    /// Absolute path to a screenshot file (Mastodon only — attached as image).
    #[serde(default)]
    pub screenshot_path: Option<String>,
    /// Additional user-defined hashtags without #.
    #[serde(default)]
    pub extra_tags: Vec<String>,
    /// Override Mastodon visibility for this specific post.
    #[serde(default)]
    pub mastodon_visibility: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelayResult {
    pub relay_url: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DShareResult {
    pub nostr_published: bool,
    pub nostr_event_id: Option<String>,
    pub nostr_relay_results: Vec<RelayResult>,
    pub nostr_error: Option<String>,
    pub mastodon_published: bool,
    pub mastodon_url: Option<String>,
    pub mastodon_error: Option<String>,
}

// ── Nostr event ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NostrEvent {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u64,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

// ── Persistence ───────────────────────────────────────────────────────────────

fn config_path() -> std::path::PathBuf {
    app_data_root().join(CONFIG_FILE)
}

fn load_config() -> DShareConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_config(cfg: &DShareConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).ok();
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Nostr key management ──────────────────────────────────────────────────────

fn get_or_create_nostr_keypair() -> Result<(SecretKey, String), String> {
    let secp = Secp256k1::new();

    if let Ok(Some(hex_key)) = get_secret(VAULT_NOSTR_SECRET) {
        let bytes = from_hex(&hex_key).ok_or("invalid stored Nostr secret key")?;
        let secret = SecretKey::from_slice(&bytes).map_err(|e| e.to_string())?;
        let keypair = Keypair::from_secret_key(&secp, &secret);
        let (xonly, _) = keypair.x_only_public_key();
        return Ok((secret, to_hex(&xonly.serialize())));
    }

    // Generate a fresh keypair.
    let (secret, _) = secp.generate_keypair(&mut OsRng);
    let keypair = Keypair::from_secret_key(&secp, &secret);
    let (xonly, _) = keypair.x_only_public_key();
    let pubkey_hex = to_hex(&xonly.serialize());

    set_secret(VAULT_NOSTR_SECRET, &to_hex(&secret.secret_bytes()))
        .map_err(|e| e.to_string())?;

    Ok((secret, pubkey_hex))
}

// ── Nostr content helpers ─────────────────────────────────────────────────────

/// Build (content_string, nostr_tags) from a DSharePost.
pub fn build_note_content(post: &DSharePost) -> (String, Vec<Vec<String>>) {
    let mut lines: Vec<String> = Vec::new();
    lines.push(format!("🎮 {}", post.game_title));

    if let Some(rating) = post.rating {
        let r = rating.min(10);
        let stars = "⭐".repeat((r / 2) as usize);
        lines.push(format!("{} {}/10", stars, r));
    }

    if let Some(ref review) = post.review_text {
        let trimmed = review.trim();
        if !trimmed.is_empty() {
            lines.push(String::new());
            lines.push(trimmed.to_string());
        }
    }

    // Hashtags — always include "gaming" and "libmaly".
    let mut tag_words: Vec<String> = vec!["gaming".to_string(), "libmaly".to_string()];
    for t in &post.extra_tags {
        let clean = t
            .trim()
            .trim_start_matches('#')
            .replace(' ', "")
            .to_lowercase();
        if !clean.is_empty() && !tag_words.contains(&clean) {
            tag_words.push(clean);
        }
    }
    let hashtag_line = tag_words
        .iter()
        .map(|t| format!("#{}", t))
        .collect::<Vec<_>>()
        .join(" ");
    lines.push(String::new());
    lines.push(hashtag_line);

    let content = lines.join("\n");

    // NIP-12 "t" tags.
    let tags: Vec<Vec<String>> = tag_words
        .iter()
        .map(|t| vec!["t".to_string(), t.clone()])
        .collect();

    (content, tags)
}

fn build_nostr_event(post: &DSharePost, pubkey_hex: &str) -> NostrEvent {
    let created_at = now_secs();
    let kind: u64 = 1;
    let (content, tags) = build_note_content(post);

    // Event ID = SHA256([0, pubkey, created_at, kind, tags, content])
    let preimage = serde_json::json!([0, pubkey_hex, created_at, kind, tags, content]);
    let preimage_bytes = serde_json::to_vec(&preimage).unwrap_or_default();
    let id_hex = to_hex(&Sha256::digest(&preimage_bytes));

    NostrEvent {
        id: id_hex,
        pubkey: pubkey_hex.to_string(),
        created_at,
        kind,
        tags,
        content,
        sig: String::new(), // filled by sign_nostr_event
    }
}

fn sign_nostr_event(event: &mut NostrEvent, secret: &SecretKey) -> Result<(), String> {
    let secp = Secp256k1::new();
    let keypair = Keypair::from_secret_key(&secp, secret);

    let id_bytes = from_hex(&event.id).ok_or("invalid event id hex")?;
    let msg = Message::from_digest_slice(&id_bytes).map_err(|e| e.to_string())?;
    let sig = secp.sign_schnorr_with_rng(&msg, &keypair, &mut OsRng);

    event.sig = to_hex(&sig.serialize());
    Ok(())
}

// ── Nostr relay publishing ────────────────────────────────────────────────────

async fn publish_to_relay(relay_url: &str, event: &NostrEvent) -> Result<bool, String> {
    let (mut ws, _) = tokio::time::timeout(
        Duration::from_secs(10),
        connect_async(relay_url),
    )
    .await
    .map_err(|_| "relay connection timed out".to_string())?
    .map_err(|e| format!("relay connect: {}", e))?;

    // Send ["EVENT", event_object].
    let msg_json = serde_json::to_string(&serde_json::json!(["EVENT", event]))
        .map_err(|e| e.to_string())?;
    ws.send(WsMessage::Text(msg_json))
        .await
        .map_err(|e| format!("relay send: {}", e))?;

    // Wait for ["OK", event_id, accepted, message].
    let response = tokio::time::timeout(Duration::from_secs(8), ws.next()).await;

    // ws is dropped here, closing the connection.
    match response {
        Ok(Some(Ok(WsMessage::Text(text)))) => {
            if let Ok(arr) = serde_json::from_str::<serde_json::Value>(&text) {
                if arr[0].as_str() == Some("OK") {
                    return Ok(arr[2].as_bool().unwrap_or(true));
                }
            }
            Ok(true) // unexpected message format — assume delivered
        }
        Err(_) => Err("relay response timed out".to_string()),
        Ok(None) => Err("relay closed connection early".to_string()),
        Ok(Some(Err(e))) => Err(format!("relay error: {}", e)),
        Ok(Some(Ok(_))) => Ok(true), // binary/ping frame — assume ok
    }
}

// ── Mastodon API ──────────────────────────────────────────────────────────────

async fn mastodon_upload_media(
    instance: &str,
    token: &str,
    file_path: &str,
) -> Result<String, String> {
    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("cannot read screenshot: {}", e))?;

    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("screenshot.{}", ext))
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/v2/media", instance.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("media upload failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("media upload HTTP {}: {}", status, body));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    json["id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "media response missing 'id'".to_string())
}

async fn mastodon_post_status(
    instance: &str,
    token: &str,
    status_text: &str,
    visibility: &str,
    media_ids: &[String],
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/v1/statuses", instance.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "status": status_text,
        "visibility": visibility,
    });
    if !media_ids.is_empty() {
        body["media_ids"] = serde_json::json!(media_ids);
    }

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("post status failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("post status HTTP {}: {}", status, body_text));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json["url"].as_str().unwrap_or("").to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn dshare_get_config() -> DShareConfig {
    load_config()
}

#[tauri::command]
pub fn dshare_save_config(config: DShareConfig) -> Result<(), String> {
    persist_config(&config)
}

/// Return the local Nostr public key as a hex string (64 chars = 32-byte x-only pubkey).
/// Generates and vaults the keypair on first call.
#[tauri::command]
pub fn dshare_get_nostr_pubkey() -> Result<String, String> {
    let (_, pubkey_hex) = get_or_create_nostr_keypair()?;
    let mut cfg = load_config();
    if cfg.nostr_pubkey_hex != pubkey_hex {
        cfg.nostr_pubkey_hex = pubkey_hex.clone();
        let _ = persist_config(&cfg);
    }
    Ok(pubkey_hex)
}

/// Build and return a preview of the post content without publishing.
#[tauri::command]
pub fn dshare_preview_content(post: DSharePost) -> String {
    let (content, _) = build_note_content(&post);
    content
}

/// Publish to one or more platforms.
/// `platforms`: subset of `["nostr", "mastodon"]`.
#[tauri::command]
pub async fn dshare_publish(
    post: DSharePost,
    platforms: Vec<String>,
) -> Result<DShareResult, String> {
    let cfg = load_config();
    let mut result = DShareResult::default();

    // ── Nostr ──────────────────────────────────────────────────────────────────
    if platforms.iter().any(|p| p == "nostr") {
        if cfg.nostr_relays.is_empty() {
            result.nostr_error = Some("No Nostr relays configured".to_string());
        } else {
            match get_or_create_nostr_keypair() {
                Err(e) => result.nostr_error = Some(format!("keypair error: {}", e)),
                Ok((secret, pubkey_hex)) => {
                    let mut event = build_nostr_event(&post, &pubkey_hex);
                    match sign_nostr_event(&mut event, &secret) {
                        Err(e) => result.nostr_error = Some(format!("signing error: {}", e)),
                        Ok(()) => {
                            result.nostr_event_id = Some(event.id.clone());
                            let mut any_ok = false;
                            for relay_url in &cfg.nostr_relays {
                                match publish_to_relay(relay_url, &event).await {
                                    Ok(accepted) => {
                                        if accepted {
                                            any_ok = true;
                                        }
                                        result.nostr_relay_results.push(RelayResult {
                                            relay_url: relay_url.clone(),
                                            success: accepted,
                                            error: if accepted {
                                                None
                                            } else {
                                                Some("relay rejected the event".to_string())
                                            },
                                        });
                                    }
                                    Err(e) => {
                                        result.nostr_relay_results.push(RelayResult {
                                            relay_url: relay_url.clone(),
                                            success: false,
                                            error: Some(e),
                                        });
                                    }
                                }
                            }
                            result.nostr_published = any_ok;
                            if !any_ok && result.nostr_error.is_none() {
                                result.nostr_error =
                                    Some("All relays failed or rejected the event".to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Mastodon ───────────────────────────────────────────────────────────────
    if platforms.iter().any(|p| p == "mastodon") {
        let instance = match &cfg.mastodon_instance_url {
            Some(u) if !u.is_empty() => u.clone(),
            _ => {
                result.mastodon_error =
                    Some("Mastodon instance URL not configured".to_string());
                return Ok(result);
            }
        };
        let token = match &cfg.mastodon_access_token {
            Some(t) if !t.is_empty() => t.clone(),
            _ => {
                result.mastodon_error =
                    Some("Mastodon access token not configured".to_string());
                return Ok(result);
            }
        };

        let (content, _) = build_note_content(&post);
        let visibility = post
            .mastodon_visibility
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(&cfg.mastodon_visibility);

        // Upload screenshot if provided.
        let mut media_ids: Vec<String> = Vec::new();
        if let Some(ref path) = post.screenshot_path {
            if !path.is_empty() {
                match mastodon_upload_media(&instance, &token, path).await {
                    Ok(id) => media_ids.push(id),
                    Err(e) => {
                        result.mastodon_error = Some(e);
                        return Ok(result);
                    }
                }
            }
        }

        match mastodon_post_status(&instance, &token, &content, visibility, &media_ids).await {
            Ok(url) => {
                result.mastodon_published = true;
                result.mastodon_url = Some(url);
            }
            Err(e) => {
                result.mastodon_error = Some(e);
            }
        }
    }

    Ok(result)
}
