//! Portable Social Identity
//!
//! Manages a stable ED25519 keypair that acts as the user's social identity,
//! independent of any specific relay or server.  The user can export the full
//! bundle (display name + avatar + keys) to a JSON file and import it on any
//! machine or after reinstalling, keeping the same cryptographic fingerprint
//! across all services.
//!
//! # What is stored where
//! | Data              | Storage             | Notes                       |
//! |-------------------|---------------------|-----------------------------|
//! | Private key seed  | OS keychain (vault) | Never touches disk as plaintext |
//! | Public key (b64)  | social_identity.json| Non-secret, fingerprint     |
//! | Display name      | social_identity.json| Editable                    |
//! | Avatar (base64)   | social_identity.json| Optional; stripped on relay |
//! | Created timestamp | social_identity.json| Informational               |
//!
//! # Export bundle format (version 1)
//! ```json
//! {
//!   "version": 1,
//!   "displayName": "Alice",
//!   "avatarBase64": null,
//!   "publicKeyB64": "<base64 of 32-byte verifying key>",
//!   "privateKeyB64": "<base64 of 32-byte signing key seed>",
//!   "createdAt": 1714000000
//! }
//! ```
//! The bundle is plain JSON — users should protect the file like a password.
//! Future versions may add optional passphrase encryption.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

use crate::data_paths::app_data_root;
use crate::vault::{delete_secret, get_secret, set_secret};

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_FILE: &str = "social_identity.json";
const VAULT_PRIVATE_KEY: &str = "social::identity::private_key";
const BUNDLE_VERSION: u32 = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

/// Persisted (non-secret) identity profile.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SocialIdentityProfile {
    /// Human-readable display name shown to peers.
    #[serde(default)]
    pub display_name: String,
    /// Avatar encoded as a data-URL or base64 JPEG/PNG string. Optional.
    #[serde(default)]
    pub avatar_base64: Option<String>,
    /// Base64-encoded ED25519 verifying (public) key — 32 bytes.
    #[serde(default)]
    pub public_key_b64: String,
    /// Unix timestamp (seconds) when this keypair was first generated.
    #[serde(default)]
    pub created_at: u64,
}

/// Full portable export bundle — includes the private key.
/// SENSITIVE: treat this file like a password manager export.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PortableIdentityBundle {
    /// Format version for forward-compatibility checks.
    pub version: u32,
    /// Display name.
    pub display_name: String,
    /// Avatar (optional).
    pub avatar_base64: Option<String>,
    /// Base64 of 32-byte ED25519 verifying key.
    pub public_key_b64: String,
    /// Base64 of 32-byte ED25519 signing key seed (secret).
    pub private_key_b64: String,
    /// Unix seconds when the keypair was created.
    pub created_at: u64,
}

// ── Persistence helpers ───────────────────────────────────────────────────────

fn config_path() -> std::path::PathBuf {
    app_data_root().join(CONFIG_FILE)
}

fn load_profile() -> SocialIdentityProfile {
    let path = config_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_profile(profile: &SocialIdentityProfile) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

// ── Key helpers ───────────────────────────────────────────────────────────────

/// Generate a new ED25519 signing key and return (private_b64, public_b64).
fn generate_keypair() -> (String, String) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key: VerifyingKey = signing_key.verifying_key();
    let private_b64 = B64.encode(signing_key.to_bytes());
    let public_b64 = B64.encode(verifying_key.to_bytes());
    (private_b64, public_b64)
}

/// Derive the 32-byte verifying key from a stored private key seed.
/// Returns None if the stored key is invalid.
fn public_from_private(private_b64: &str) -> Option<String> {
    let bytes = B64.decode(private_b64).ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    let signing_key = SigningKey::from_bytes(&arr);
    Some(B64.encode(signing_key.verifying_key().to_bytes()))
}

/// Derive a compact hex fingerprint from a base64 public key
/// (first 8 bytes → 16 hex chars with colons, like `ab:cd:ef:12:34:56:78:90`).
fn fingerprint(public_b64: &str) -> String {
    B64.decode(public_b64)
        .ok()
        .map(|bytes| {
            bytes
                .iter()
                .take(8)
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(":")
        })
        .unwrap_or_else(|| "??:??:??:??:??:??:??:??".to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the current identity profile (without the private key).
/// Returns a default/empty profile if no identity has been generated yet.
#[tauri::command]
pub fn identity_get_profile() -> SocialIdentityProfile {
    let mut profile = load_profile();
    // Derive public key from vault if profile has none (migration / first load).
    if profile.public_key_b64.is_empty() {
        if let Ok(Some(priv_b64)) = get_secret(VAULT_PRIVATE_KEY) {
            if let Some(pub_b64) = public_from_private(&priv_b64) {
                profile.public_key_b64 = pub_b64;
                let _ = persist_profile(&profile);
            }
        }
    }
    profile
}

/// Returns a compact human-readable fingerprint for the current public key
/// (`ab:cd:ef:12:34:56:78:90`), or None if no identity exists yet.
#[tauri::command]
pub fn identity_get_fingerprint() -> Option<String> {
    let profile = load_profile();
    if profile.public_key_b64.is_empty() {
        None
    } else {
        Some(fingerprint(&profile.public_key_b64))
    }
}

/// Save editable profile fields (display_name, avatar_base64).
/// Does NOT touch the keypair.
#[tauri::command]
pub fn identity_save_profile(
    display_name: String,
    avatar_base64: Option<String>,
) -> Result<(), String> {
    let mut profile = load_profile();
    profile.display_name = display_name.chars().take(64).collect();
    profile.avatar_base64 = avatar_base64;
    persist_profile(&profile)
}

/// Generate a fresh ED25519 keypair for this identity.
///
/// ⚠️  This REPLACES the existing keypair — any relay that knew the old public
///    key will treat this as a different person.  The frontend must warn the
///    user before calling this command.
#[tauri::command]
pub fn identity_generate_keys() -> Result<SocialIdentityProfile, String> {
    let (priv_b64, pub_b64) = generate_keypair();
    set_secret(VAULT_PRIVATE_KEY, &priv_b64)?;

    let mut profile = load_profile();
    profile.public_key_b64 = pub_b64;
    profile.created_at = now_secs();
    persist_profile(&profile)?;
    Ok(profile)
}

/// Returns true when a private key is present in the vault
/// (i.e., the user has a keypair — even if the profile is empty).
#[tauri::command]
pub fn identity_has_keys() -> bool {
    get_secret(VAULT_PRIVATE_KEY).ok().flatten().is_some()
}

/// Export the full portable identity bundle as a JSON string.
///
/// The returned string is meant to be written to a `.libmaly-identity.json`
/// file.  It contains the private key — the frontend must warn the user to
/// keep it safe.
#[tauri::command]
pub fn identity_export_bundle() -> Result<String, String> {
    let priv_b64 = get_secret(VAULT_PRIVATE_KEY)?
        .ok_or_else(|| "No identity keypair found. Generate one first.".to_string())?;
    let profile = load_profile();
    let pub_b64 = if profile.public_key_b64.is_empty() {
        public_from_private(&priv_b64).ok_or("Stored private key is malformed.")?
    } else {
        profile.public_key_b64.clone()
    };
    let bundle = PortableIdentityBundle {
        version: BUNDLE_VERSION,
        display_name: profile.display_name.clone(),
        avatar_base64: profile.avatar_base64.clone(),
        public_key_b64: pub_b64,
        private_key_b64: priv_b64,
        created_at: profile.created_at,
    };
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

/// Import an identity from a bundle JSON string.
///
/// Validates the bundle, restores the private key to the vault, and
/// overwrites the profile config.  Returns the restored profile.
///
/// Fails with a descriptive error if:
/// - The JSON is malformed.
/// - The version is unsupported.
/// - The private/public key bytes are invalid or do not correspond.
#[tauri::command]
pub fn identity_import_bundle(bundle_json: String) -> Result<SocialIdentityProfile, String> {
    let bundle: PortableIdentityBundle =
        serde_json::from_str(&bundle_json).map_err(|e| format!("Invalid bundle JSON: {}", e))?;

    if bundle.version > BUNDLE_VERSION {
        return Err(format!(
            "Bundle version {} is newer than this installation supports (max {}).",
            bundle.version, BUNDLE_VERSION
        ));
    }

    // Validate private key bytes
    let priv_bytes = B64
        .decode(&bundle.private_key_b64)
        .map_err(|_| "Private key is not valid base64.".to_string())?;
    let priv_arr: [u8; 32] = priv_bytes
        .try_into()
        .map_err(|_| "Private key must be exactly 32 bytes.".to_string())?;
    let signing_key = SigningKey::from_bytes(&priv_arr);

    // Derive public key and cross-check if the bundle includes one
    let derived_pub = B64.encode(signing_key.verifying_key().to_bytes());
    if !bundle.public_key_b64.is_empty() && bundle.public_key_b64 != derived_pub {
        return Err(
            "Public key in bundle does not match the private key. Bundle may be corrupted.".into(),
        );
    }

    // Store private key in vault
    set_secret(VAULT_PRIVATE_KEY, &bundle.private_key_b64)?;

    // Sanitize and persist profile
    let profile = SocialIdentityProfile {
        display_name: bundle.display_name.chars().take(64).collect(),
        avatar_base64: bundle.avatar_base64,
        public_key_b64: derived_pub,
        created_at: bundle.created_at,
    };
    persist_profile(&profile)?;
    Ok(profile)
}

/// Delete the current identity keypair from the vault and clear the profile.
///
/// ⚠️  Irreversible unless the user has an exported bundle.
#[tauri::command]
pub fn identity_delete() -> Result<(), String> {
    delete_secret(VAULT_PRIVATE_KEY)?;
    let empty = SocialIdentityProfile::default();
    persist_profile(&empty)
}
