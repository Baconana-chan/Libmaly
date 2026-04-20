use crate::data_paths::app_data_root;
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const LIBMALY_VAULT_SERVICE: &str = "Libmaly";
const LIBRARY_PROFILES_FILE: &str = "library_profiles.json";

#[derive(Deserialize)]
struct LibraryProfileRegistrySnapshot {
    #[serde(default)]
    active_profile_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntryStatus {
    pub key: String,
    pub group: String,
    pub label: String,
    pub has_value: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSummary {
    pub profile_id: String,
    pub entries: Vec<VaultEntryStatus>,
}

const KNOWN_VAULT_ITEMS: &[(&str, &str, &str)] = &[
    ("cookies::f95", "Storefront Sessions", "F95zone session cookies"),
    ("cookies::dlsite", "Storefront Sessions", "DLsite session cookies"),
    ("cookies::fakku", "Storefront Sessions", "FAKKU session cookies"),
    ("api::itch_io", "Storefront Tokens", "itch.io Butler API key"),
    ("api::igdb_client_id", "Metadata APIs", "IGDB client ID"),
    ("api::igdb_client_secret", "Metadata APIs", "IGDB client secret"),
    ("api::rawg", "Metadata APIs", "RAWG API key"),
    ("api::mobygames", "Metadata APIs", "MobyGames API key"),
    ("sync::webdav::password", "Sync Secrets", "WebDAV password"),
    ("sync::nextcloud::password", "Sync Secrets", "Nextcloud password"),
    ("sync::s3::access_key", "Sync Secrets", "S3 access key"),
    ("sync::s3::secret_key", "Sync Secrets", "S3 secret key"),
    ("sync::git::password", "Sync Secrets", "Git password / personal access token"),
    ("sync::google_drive::access_token", "Sync Secrets", "Google Drive access token"),
    ("sync::google_drive::refresh_token", "Sync Secrets", "Google Drive refresh token"),
    ("sync::dropbox::access_token", "Sync Secrets", "Dropbox access token"),
    ("sync::dropbox::refresh_token", "Sync Secrets", "Dropbox refresh token"),
];

pub fn current_profile_id() -> String {
    let path = app_data_root().join(LIBRARY_PROFILES_FILE);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<LibraryProfileRegistrySnapshot>(&raw).ok())
        .map(|snapshot| snapshot.active_profile_id.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "default".to_string())
}

pub fn profile_file_path(file_name: &str) -> PathBuf {
    let base = app_data_root().join("profiles").join(current_profile_id());
    if file_name.is_empty() {
        base
    } else {
        base.join(file_name)
    }
}

pub fn legacy_global_file_path(file_name: &str) -> PathBuf {
    app_data_root().join(file_name)
}

fn keyring_entry(secret_key: &str) -> Result<Entry, String> {
    Entry::new(
        LIBMALY_VAULT_SERVICE,
        &format!("profile::{}::{}", current_profile_id(), secret_key),
    )
    .map_err(|e| format!("Failed to initialize secure vault entry: {}", e))
}

pub fn set_secret(secret_key: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return delete_secret(secret_key);
    }
    keyring_entry(secret_key)?
        .set_password(value)
        .map_err(|e| format!("Failed to store secure secret: {}", e))
}

pub fn get_secret(secret_key: &str) -> Result<Option<String>, String> {
    match keyring_entry(secret_key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read secure secret: {}", e)),
    }
}

pub fn delete_secret(secret_key: &str) -> Result<(), String> {
    match keyring_entry(secret_key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete secure secret: {}", e)),
    }
}

#[tauri::command]
pub fn vault_list_entries() -> Result<VaultSummary, String> {
    let profile_id = current_profile_id();
    let mut entries = Vec::with_capacity(KNOWN_VAULT_ITEMS.len());
    for (key, group, label) in KNOWN_VAULT_ITEMS {
        entries.push(VaultEntryStatus {
            key: (*key).to_string(),
            group: (*group).to_string(),
            label: (*label).to_string(),
            has_value: get_secret(key)?.is_some(),
        });
    }
    Ok(VaultSummary { profile_id, entries })
}

#[tauri::command]
pub fn vault_delete_entry(key: String) -> Result<(), String> {
    delete_secret(&key)
}