use crate::data_paths::app_data_root;
use crate::vault::profile_file_path;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use rand::{distributions::Alphanumeric, Rng};
use s3::creds::Credentials as S3Credentials;
use s3::{Bucket as S3Bucket, Region as S3Region};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

/// Sync provider type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SyncProviderType {
    Webdav,
    Nextcloud,
    S3,
    Git,
    GoogleDrive,
    Dropbox,
}

/// Sync provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "provider", content = "config", rename_all = "kebab-case")]
pub enum SyncProviderConfig {
    Webdav(WebdavConfig),
    Nextcloud(NextcloudConfig),
    S3(S3Config),
    Git(GitConfig),
    GoogleDrive(GoogleDriveConfig),
    Dropbox(DropboxConfig),
}

/// WebDAV configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path: String,
}

/// Nextcloud configuration (extends WebDAV)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextcloudConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub path: String,
}

/// S3 configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Config {
    pub bucket: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
    pub endpoint: Option<String>,
    pub path: String,
}

/// Git configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConfig {
    pub url: String,
    pub branch: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssh_key_path: Option<String>,
}

/// Google Drive configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveConfig {
    pub access_token: String,
    pub file_name: String,
    pub client_id: Option<String>,
    pub refresh_token: Option<String>,
}

/// Dropbox configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropboxConfig {
    pub access_token: String,
    pub path: String,
    pub client_id: Option<String>,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOAuthPending {
    pub provider: SyncProviderType,
    pub client_id: String,
    pub code_verifier: String,
    pub state: String,
    pub redirect_uri: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOAuthStartResult {
    pub authorization_url: String,
    pub provider_type: SyncProviderType,
    pub redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DropboxTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Sync state metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMetadata {
    pub last_sync_at: u64,
    pub last_sync_hash: String,
    pub provider_type: SyncProviderType,
}

/// Sync result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub conflicts_detected: bool,
    pub entries_synced: usize,
}

/// Sync provider enum for dispatch
pub enum SyncProvider {
    Webdav(WebdavProvider),
    Nextcloud(NextcloudProvider),
    S3(S3Provider),
    Git(GitProvider),
    GoogleDrive(GoogleDriveProvider),
    Dropbox(DropboxProvider),
}

impl SyncProvider {
    pub async fn upload(&self, data: &str, metadata: &SyncMetadata) -> Result<(), String> {
        match self {
            SyncProvider::Webdav(p) => p.upload(data, metadata).await,
            SyncProvider::Nextcloud(p) => p.upload(data, metadata).await,
            SyncProvider::S3(p) => p.upload(data, metadata).await,
            SyncProvider::Git(p) => p.upload(data, metadata).await,
            SyncProvider::GoogleDrive(p) => p.upload(data, metadata).await,
            SyncProvider::Dropbox(p) => p.upload(data, metadata).await,
        }
    }

    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        match self {
            SyncProvider::Webdav(p) => p.download().await,
            SyncProvider::Nextcloud(p) => p.download().await,
            SyncProvider::S3(p) => p.download().await,
            SyncProvider::Git(p) => p.download().await,
            SyncProvider::GoogleDrive(p) => p.download().await,
            SyncProvider::Dropbox(p) => p.download().await,
        }
    }

    pub async fn exists(&self) -> Result<bool, String> {
        match self {
            SyncProvider::Webdav(p) => p.exists().await,
            SyncProvider::Nextcloud(p) => p.exists().await,
            SyncProvider::S3(p) => p.exists().await,
            SyncProvider::Git(p) => p.exists().await,
            SyncProvider::GoogleDrive(p) => p.exists().await,
            SyncProvider::Dropbox(p) => p.exists().await,
        }
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        match self {
            SyncProvider::Webdav(p) => p.upload_save_backup(file_name, data).await,
            SyncProvider::Nextcloud(p) => p.upload_save_backup(file_name, data).await,
            SyncProvider::S3(p) => p.upload_save_backup(file_name, data).await,
            SyncProvider::Git(p) => p.upload_save_backup(file_name, data).await,
            SyncProvider::GoogleDrive(p) => p.upload_save_backup(file_name, data).await,
            SyncProvider::Dropbox(p) => p.upload_save_backup(file_name, data).await,
        }
    }

    pub fn provider_type(&self) -> SyncProviderType {
        match self {
            SyncProvider::Webdav(_) => SyncProviderType::Webdav,
            SyncProvider::Nextcloud(_) => SyncProviderType::Nextcloud,
            SyncProvider::S3(_) => SyncProviderType::S3,
            SyncProvider::Git(_) => SyncProviderType::Git,
            SyncProvider::GoogleDrive(_) => SyncProviderType::GoogleDrive,
            SyncProvider::Dropbox(_) => SyncProviderType::Dropbox,
        }
    }
}

#[derive(Debug, Deserialize)]
struct GoogleDriveFileListResponse {
    files: Vec<GoogleDriveFileEntry>,
}

#[derive(Debug, Deserialize)]
struct GoogleDriveFileEntry {
    id: String,
}

fn build_sync_metadata(data: &str, provider_type: SyncProviderType) -> SyncMetadata {
    SyncMetadata {
        last_sync_at: Utc::now().timestamp() as u64,
        last_sync_hash: format!("{:x}", md5::compute(data.as_bytes())),
        provider_type,
    }
}

fn trim_response_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.len() > 240 {
        format!("{}...", &trimmed[..240])
    } else {
        trimmed.to_string()
    }
}

fn google_drive_query_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn normalized_s3_object_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("S3 object path cannot be empty".to_string());
    }
    Ok(trimmed.to_string())
}

fn remote_parent_path(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/").trim_matches('/').to_string();
    match normalized.rsplit_once('/') {
        Some((parent, _)) => parent.to_string(),
        None => String::new(),
    }
}

fn remote_join_path(base: &str, leaf: &str) -> String {
    let base = base.trim().trim_matches('/');
    let leaf = leaf.trim().trim_matches('/');
    if base.is_empty() {
        leaf.to_string()
    } else if leaf.is_empty() {
        base.to_string()
    } else {
        format!("{}/{}", base, leaf)
    }
}

fn remote_save_backup_path(base_state_path: &str, file_name: &str) -> String {
    remote_join_path(
        &remote_join_path(&remote_parent_path(base_state_path), "save-backups"),
        file_name,
    )
}

fn dropbox_parent_path(path: &str) -> String {
    let trimmed = path.trim().replace('\\', "/");
    let absolute = trimmed.starts_with('/');
    let normalized = trimmed.trim_matches('/');
    let parent = match normalized.rsplit_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => String::new(),
    };
    if absolute {
        if parent.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", parent)
        }
    } else {
        parent
    }
}

fn dropbox_join_path(base: &str, leaf: &str) -> String {
    let base = base.trim();
    let leaf = leaf.trim().trim_matches('/');
    if base.is_empty() || base == "/" {
        format!("/{}", leaf)
    } else {
        format!("{}/{}", base.trim_end_matches('/'), leaf)
    }
}

fn google_drive_save_backup_name(file_name: &str) -> String {
    format!("save-backups--{}", file_name.trim())
}

fn sync_oauth_pending_path() -> PathBuf {
    profile_file_path("sync_oauth_pending.json")
}

fn oauth_redirect_uri(provider: SyncProviderType) -> Result<String, String> {
    match provider {
        SyncProviderType::GoogleDrive => Ok("libmaly://oauth/google-drive".to_string()),
        SyncProviderType::Dropbox => Ok("libmaly://oauth/dropbox".to_string()),
        _ => Err("OAuth is only supported for Google Drive and Dropbox".to_string()),
    }
}

fn generate_secure_token(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn save_sync_oauth_pending(pending: &SyncOAuthPending) -> Result<(), String> {
    let path = sync_oauth_pending_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create OAuth state directory: {}", e))?;
    }
    let raw = serde_json::to_string(pending)
        .map_err(|e| format!("Failed to serialize OAuth state: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Failed to persist OAuth state: {}", e))
}

fn load_sync_oauth_pending() -> Result<SyncOAuthPending, String> {
    let path = sync_oauth_pending_path();
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read pending OAuth state: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse pending OAuth state: {}", e))
}

fn clear_sync_oauth_pending() {
    let _ = fs::remove_file(sync_oauth_pending_path());
}

pub fn start_oauth(
    provider: SyncProviderType,
    client_id: String,
) -> Result<SyncOAuthStartResult, String> {
    if client_id.trim().is_empty() {
        return Err("Client ID / App key is required to start OAuth".to_string());
    }

    let redirect_uri = oauth_redirect_uri(provider.clone())?;
    let state = generate_secure_token(32);
    let verifier = generate_secure_token(96);
    let challenge = code_challenge(&verifier);
    let pending = SyncOAuthPending {
        provider: provider.clone(),
        client_id: client_id.trim().to_string(),
        code_verifier: verifier,
        state: state.clone(),
        redirect_uri: redirect_uri.clone(),
        created_at: Utc::now().timestamp_millis() as u64,
    };
    save_sync_oauth_pending(&pending)?;

    let authorization_url = match provider {
        SyncProviderType::GoogleDrive => format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent&state={}",
            urlencoding::encode(&pending.client_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode("https://www.googleapis.com/auth/drive.appdata"),
            urlencoding::encode(&challenge),
            urlencoding::encode(&state),
        ),
        SyncProviderType::Dropbox => format!(
            "https://www.dropbox.com/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&code_challenge={}&code_challenge_method=S256&token_access_type=offline&state={}",
            urlencoding::encode(&pending.client_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(&challenge),
            urlencoding::encode(&state),
        ),
        _ => return Err("OAuth is only supported for Google Drive and Dropbox".to_string()),
    };

    Ok(SyncOAuthStartResult {
        authorization_url,
        provider_type: pending.provider,
        redirect_uri,
    })
}

pub async fn complete_oauth_callback(callback_url: &str) -> Result<SyncProviderConfig, String> {
    let pending = load_sync_oauth_pending()?;
    let parsed =
        url::Url::parse(callback_url).map_err(|e| format!("Invalid OAuth callback URL: {}", e))?;
    let code = parsed
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned());
    let state = parsed
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned());
    let error = parsed
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.into_owned());

    if let Some(error) = error {
        clear_sync_oauth_pending();
        return Err(format!("OAuth authorization failed: {}", error));
    }

    let code =
        code.ok_or_else(|| "OAuth callback does not include an authorization code".to_string())?;
    let state = state.ok_or_else(|| "OAuth callback does not include a state value".to_string())?;
    if state != pending.state {
        clear_sync_oauth_pending();
        return Err("OAuth state mismatch. Please retry the connection flow.".to_string());
    }

    let client = reqwest::Client::builder().build().unwrap_or_default();

    let config = match pending.provider {
        SyncProviderType::GoogleDrive => {
            let response = client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", pending.client_id.as_str()),
                    ("code", code.as_str()),
                    ("code_verifier", pending.code_verifier.as_str()),
                    ("grant_type", "authorization_code"),
                    ("redirect_uri", pending.redirect_uri.as_str()),
                ])
                .send()
                .await
                .map_err(|e| format!("Google token exchange failed: {}", e))?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                clear_sync_oauth_pending();
                return Err(format!(
                    "Google token exchange failed with status {}: {}",
                    status,
                    trim_response_body(&body)
                ));
            }
            let token: GoogleTokenResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Google token response: {}", e))?;
            SyncProviderConfig::GoogleDrive(GoogleDriveConfig {
                access_token: token.access_token,
                file_name: "libmaly-state.json".to_string(),
                client_id: Some(pending.client_id.clone()),
                refresh_token: token.refresh_token,
            })
        }
        SyncProviderType::Dropbox => {
            let response = client
                .post("https://api.dropboxapi.com/oauth2/token")
                .form(&[
                    ("client_id", pending.client_id.as_str()),
                    ("code", code.as_str()),
                    ("code_verifier", pending.code_verifier.as_str()),
                    ("grant_type", "authorization_code"),
                    ("redirect_uri", pending.redirect_uri.as_str()),
                ])
                .send()
                .await
                .map_err(|e| format!("Dropbox token exchange failed: {}", e))?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                clear_sync_oauth_pending();
                return Err(format!(
                    "Dropbox token exchange failed with status {}: {}",
                    status,
                    trim_response_body(&body)
                ));
            }
            let token: DropboxTokenResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Dropbox token response: {}", e))?;
            SyncProviderConfig::Dropbox(DropboxConfig {
                access_token: token.access_token,
                path: "/Apps/Libmaly/libmaly-state.json".to_string(),
                client_id: Some(pending.client_id.clone()),
                refresh_token: token.refresh_token,
            })
        }
        _ => {
            clear_sync_oauth_pending();
            return Err("OAuth callback does not match a supported provider".to_string());
        }
    };

    clear_sync_oauth_pending();
    Ok(config)
}

pub async fn refresh_oauth_config(
    config: SyncProviderConfig,
) -> Result<SyncProviderConfig, String> {
    let client = reqwest::Client::builder().build().unwrap_or_default();
    match config {
        SyncProviderConfig::GoogleDrive(cfg) => {
            let Some(client_id) = cfg.client_id.clone() else {
                return Ok(SyncProviderConfig::GoogleDrive(cfg));
            };
            let Some(refresh_token) = cfg.refresh_token.clone() else {
                return Ok(SyncProviderConfig::GoogleDrive(cfg));
            };
            let response = client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", client_id.as_str()),
                    ("refresh_token", refresh_token.as_str()),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .await
                .map_err(|e| format!("Google token refresh failed: {}", e))?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!(
                    "Google token refresh failed with status {}: {}",
                    status,
                    trim_response_body(&body)
                ));
            }
            let token: GoogleTokenResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Google refresh response: {}", e))?;
            Ok(SyncProviderConfig::GoogleDrive(GoogleDriveConfig {
                access_token: token.access_token,
                file_name: cfg.file_name,
                client_id: Some(client_id),
                refresh_token: Some(refresh_token),
            }))
        }
        SyncProviderConfig::Dropbox(cfg) => {
            let Some(client_id) = cfg.client_id.clone() else {
                return Ok(SyncProviderConfig::Dropbox(cfg));
            };
            let Some(refresh_token) = cfg.refresh_token.clone() else {
                return Ok(SyncProviderConfig::Dropbox(cfg));
            };
            let response = client
                .post("https://api.dropboxapi.com/oauth2/token")
                .form(&[
                    ("client_id", client_id.as_str()),
                    ("refresh_token", refresh_token.as_str()),
                    ("grant_type", "refresh_token"),
                ])
                .send()
                .await
                .map_err(|e| format!("Dropbox token refresh failed: {}", e))?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!(
                    "Dropbox token refresh failed with status {}: {}",
                    status,
                    trim_response_body(&body)
                ));
            }
            let token: DropboxTokenResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Dropbox refresh response: {}", e))?;
            Ok(SyncProviderConfig::Dropbox(DropboxConfig {
                access_token: token.access_token,
                path: cfg.path,
                client_id: Some(client_id),
                refresh_token: Some(refresh_token),
            }))
        }
        other => Ok(other),
    }
}

/// Google Drive provider implementation
pub struct GoogleDriveProvider {
    config: GoogleDriveConfig,
    client: reqwest::Client,
}

impl GoogleDriveProvider {
    pub fn new(config: GoogleDriveConfig) -> Self {
        let client = reqwest::Client::builder().build().unwrap_or_default();
        Self { config, client }
    }

    async fn find_file_id_by_name(&self, file_name: &str) -> Result<Option<String>, String> {
        let escaped_name = google_drive_query_escape(file_name);
        let response = self
            .client
            .get("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(&self.config.access_token)
            .query(&[
                ("spaces", "appDataFolder"),
                ("fields", "files(id)"),
                (
                    "q",
                    &format!(
                        "name = '{}' and 'appDataFolder' in parents and trashed = false",
                        escaped_name
                    ),
                ),
            ])
            .send()
            .await
            .map_err(|e| format!("Google Drive lookup failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Google Drive lookup failed with status {}: {}",
                status,
                trim_response_body(&body)
            ));
        }

        let payload: GoogleDriveFileListResponse = response
            .json()
            .await
            .map_err(|e| format!("Google Drive lookup response parse failed: {}", e))?;
        Ok(payload.files.into_iter().next().map(|file| file.id))
    }

    async fn find_file_id(&self) -> Result<Option<String>, String> {
        self.find_file_id_by_name(&self.config.file_name).await
    }

    async fn upload_named_content(
        &self,
        file_name: &str,
        content_type: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let boundary = format!("libmaly-sync-{}", Utc::now().timestamp_millis());
        let metadata = serde_json::json!({
            "name": file_name,
            "parents": ["appDataFolder"],
            "mimeType": content_type,
        });

        let mut body = Vec::<u8>::new();
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {content_type}\r\n\r\n",
                boundary = boundary,
                metadata = metadata,
                content_type = content_type,
            )
            .as_bytes(),
        );
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

        let existing_file_id = self.find_file_id_by_name(file_name).await?;
        let (method, url) = if let Some(file_id) = existing_file_id {
            (
                reqwest::Method::PATCH,
                format!(
                    "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=multipart",
                    file_id
                ),
            )
        } else {
            (
                reqwest::Method::POST,
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart".to_string(),
            )
        };

        let response = self
            .client
            .request(method, url)
            .bearer_auth(&self.config.access_token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={}", boundary),
            )
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Google Drive upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "Google Drive upload failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }

    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        self.upload_named_content(&self.config.file_name, "application/json", data.as_bytes())
            .await
    }

    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        let file_id = self
            .find_file_id()
            .await?
            .ok_or_else(|| "Google Drive state file not found".to_string())?;
        let response = self
            .client
            .get(format!(
                "https://www.googleapis.com/drive/v3/files/{}?alt=media",
                file_id
            ))
            .bearer_auth(&self.config.access_token)
            .send()
            .await
            .map_err(|e| format!("Google Drive download failed: {}", e))?;

        if response.status().is_success() {
            let data = response
                .text()
                .await
                .map_err(|e| format!("Failed to read Google Drive response: {}", e))?;
            Ok((
                data.clone(),
                build_sync_metadata(&data, SyncProviderType::GoogleDrive),
            ))
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "Google Drive download failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }

    pub async fn exists(&self) -> Result<bool, String> {
        Ok(self.find_file_id().await?.is_some())
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        let remote_name = google_drive_save_backup_name(file_name);
        self.upload_named_content(&remote_name, "application/zip", data)
            .await?;
        Ok(format!("appDataFolder/{}", remote_name))
    }
}

/// Dropbox provider implementation
pub struct DropboxProvider {
    config: DropboxConfig,
    client: reqwest::Client,
}

impl DropboxProvider {
    pub fn new(config: DropboxConfig) -> Self {
        let client = reqwest::Client::builder().build().unwrap_or_default();
        Self { config, client }
    }

    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        let arg = serde_json::json!({
            "path": self.config.path,
            "mode": "overwrite",
            "autorename": false,
            "mute": true,
            "strict_conflict": false,
        });
        let response = self
            .client
            .post("https://content.dropboxapi.com/2/files/upload")
            .bearer_auth(&self.config.access_token)
            .header("Content-Type", "application/octet-stream")
            .header("Dropbox-API-Arg", arg.to_string())
            .body(data.to_string())
            .send()
            .await
            .map_err(|e| format!("Dropbox upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "Dropbox upload failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }

    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        let arg = serde_json::json!({
            "path": self.config.path,
        });
        let response = self
            .client
            .post("https://content.dropboxapi.com/2/files/download")
            .bearer_auth(&self.config.access_token)
            .header("Dropbox-API-Arg", arg.to_string())
            .send()
            .await
            .map_err(|e| format!("Dropbox download failed: {}", e))?;

        if response.status().is_success() {
            let data = response
                .text()
                .await
                .map_err(|e| format!("Failed to read Dropbox response: {}", e))?;
            Ok((
                data.clone(),
                build_sync_metadata(&data, SyncProviderType::Dropbox),
            ))
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "Dropbox download failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }

    pub async fn exists(&self) -> Result<bool, String> {
        let response = self
            .client
            .post("https://api.dropboxapi.com/2/files/get_metadata")
            .bearer_auth(&self.config.access_token)
            .json(&serde_json::json!({ "path": self.config.path }))
            .send()
            .await
            .map_err(|e| format!("Dropbox metadata lookup failed: {}", e))?;

        if response.status().is_success() {
            Ok(true)
        } else if response.status().as_u16() == 409 {
            Ok(false)
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "Dropbox metadata lookup failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        let remote_path = dropbox_join_path(
            &dropbox_parent_path(&self.config.path),
            &format!("save-backups/{}", file_name),
        );
        let arg = serde_json::json!({
            "path": remote_path,
            "mode": "overwrite",
            "autorename": false,
            "mute": true,
            "strict_conflict": false,
        });
        let response = self
            .client
            .post("https://content.dropboxapi.com/2/files/upload")
            .bearer_auth(&self.config.access_token)
            .header("Content-Type", "application/octet-stream")
            .header("Dropbox-API-Arg", arg.to_string())
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| format!("Dropbox save-backup upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(remote_path)
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(format!(
                "Dropbox save-backup upload failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }
}

/// WebDAV provider implementation
pub struct WebdavProvider {
    config: WebdavConfig,
    client: reqwest::Client,
}

impl WebdavProvider {
    pub fn new(config: WebdavConfig) -> Self {
        let client = reqwest::Client::builder().build().unwrap_or_default();
        Self { config, client }
    }

    fn build_url(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.config.url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    async fn ensure_directory(&self, dir_path: &str) -> Result<(), String> {
        let normalized = dir_path.trim().trim_matches('/');
        if normalized.is_empty() {
            return Ok(());
        }

        let mkcol = reqwest::Method::from_bytes(b"MKCOL").map_err(|e| e.to_string())?;
        let mut current = String::new();
        for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(segment);

            let response = self
                .client
                .request(mkcol.clone(), self.build_url(&current))
                .basic_auth(&self.config.username, Some(&self.config.password))
                .send()
                .await
                .map_err(|e| format!("WebDAV directory creation failed: {}", e))?;

            let status = response.status().as_u16();
            if !(response.status().is_success() || status == 405 || status == 409) {
                return Err(format!(
                    "WebDAV directory creation failed with status {} for {}",
                    response.status(),
                    current
                ));
            }
        }

        Ok(())
    }

    async fn upload_bytes(
        &self,
        path: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> Result<(), String> {
        self.ensure_directory(&remote_parent_path(path)).await?;
        let response = self
            .client
            .put(self.build_url(path))
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("Content-Type", content_type)
            .body(data)
            .send()
            .await
            .map_err(|e| format!("WebDAV upload failed: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!(
                "WebDAV upload failed with status: {}",
                response.status()
            ))
        }
    }

    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        self.upload_bytes(
            &self.config.path,
            data.as_bytes().to_vec(),
            "application/json",
        )
        .await
    }

    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        let response = self
            .client
            .get(self.build_url(&self.config.path))
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await
            .map_err(|e| format!("WebDAV download failed: {}", e))?;

        if response.status().is_success() {
            let data = response
                .text()
                .await
                .map_err(|e| format!("Failed to read response: {}", e))?;
            let metadata = build_sync_metadata(&data, SyncProviderType::Webdav);
            Ok((data, metadata))
        } else {
            Err(format!(
                "WebDAV download failed with status: {}",
                response.status()
            ))
        }
    }

    pub async fn exists(&self) -> Result<bool, String> {
        let response = self
            .client
            .head(self.build_url(&self.config.path))
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await
            .map_err(|e| format!("WebDAV check failed: {}", e))?;

        Ok(response.status().is_success())
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        let remote_path = remote_save_backup_path(&self.config.path, file_name);
        self.upload_bytes(&remote_path, data.to_vec(), "application/zip")
            .await?;
        Ok(remote_path)
    }
}

/// Nextcloud provider (WebDAV-based)
pub struct NextcloudProvider {
    webdav: WebdavProvider,
}

impl NextcloudProvider {
    pub fn new(config: NextcloudConfig) -> Self {
        let webdav_config = WebdavConfig {
            url: format!("{}/remote.php/webdav", config.url.trim_end_matches('/')),
            username: config.username.clone(),
            password: config.password.clone(),
            path: config.path.clone(),
        };
        Self {
            webdav: WebdavProvider::new(webdav_config),
        }
    }

    pub async fn upload(&self, data: &str, metadata: &SyncMetadata) -> Result<(), String> {
        self.webdav.upload(data, metadata).await
    }

    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        let (data, _) = self.webdav.download().await?;
        let metadata = build_sync_metadata(&data, SyncProviderType::Nextcloud);
        Ok((data, metadata))
    }

    pub async fn exists(&self) -> Result<bool, String> {
        self.webdav.exists().await
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        self.webdav.upload_save_backup(file_name, data).await
    }
}

/// S3 provider implementation
pub struct S3Provider {
    bucket: Box<S3Bucket>,
    object_path: String,
}

impl S3Provider {
    pub fn new(config: S3Config) -> Result<Self, String> {
        let region = if let Some(endpoint) = config.endpoint.as_ref() {
            S3Region::Custom {
                region: config.region.clone(),
                endpoint: endpoint.trim().trim_end_matches('/').to_string(),
            }
        } else {
            config
                .region
                .parse::<S3Region>()
                .map_err(|e| format!("Invalid S3 region '{}': {}", config.region, e))?
        };

        let credentials = S3Credentials::new(
            Some(config.access_key.as_str()),
            Some(config.secret_key.as_str()),
            None,
            None,
            None,
        )
        .map_err(|e| format!("Invalid S3 credentials: {}", e))?;

        let bucket = S3Bucket::new(&config.bucket, region, credentials)
            .map_err(|e| format!("Failed to configure S3 bucket '{}': {}", config.bucket, e))?
            .with_path_style();

        let object_path = normalized_s3_object_path(&config.path)?;

        Ok(Self {
            bucket,
            object_path,
        })
    }

    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        let response = self
            .bucket
            .put_object_with_content_type(&self.object_path, data.as_bytes(), "application/json")
            .await
            .map_err(|e| format!("S3 upload failed: {}", e))?;

        let status = response.status_code();
        if (200..300).contains(&status) {
            Ok(())
        } else {
            let body = response
                .to_string()
                .unwrap_or_else(|_| "<binary body>".to_string());
            Err(format!(
                "S3 upload failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }

    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        let response = self
            .bucket
            .get_object(&self.object_path)
            .await
            .map_err(|e| format!("S3 download failed: {}", e))?;

        let status = response.status_code();
        if !(200..300).contains(&status) {
            let body = response
                .to_string()
                .unwrap_or_else(|_| "<binary body>".to_string());
            return Err(format!(
                "S3 download failed with status {}: {}",
                status,
                trim_response_body(&body)
            ));
        }

        let data = response
            .to_string()
            .map_err(|e| format!("Failed to decode S3 object as UTF-8: {}", e))?;
        Ok((
            data.clone(),
            build_sync_metadata(&data, SyncProviderType::S3),
        ))
    }

    pub async fn exists(&self) -> Result<bool, String> {
        let (_head, status) = self
            .bucket
            .head_object(&self.object_path)
            .await
            .map_err(|e| format!("S3 metadata lookup failed: {}", e))?;

        if (200..300).contains(&status) {
            Ok(true)
        } else if status == 404 {
            Ok(false)
        } else {
            Err(format!("S3 metadata lookup failed with status {}", status))
        }
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        let remote_path = remote_save_backup_path(&self.object_path, file_name);
        let response = self
            .bucket
            .put_object_with_content_type(&remote_path, data, "application/zip")
            .await
            .map_err(|e| format!("S3 save-backup upload failed: {}", e))?;

        let status = response.status_code();
        if (200..300).contains(&status) {
            Ok(remote_path)
        } else {
            let body = response
                .to_string()
                .unwrap_or_else(|_| "<binary body>".to_string());
            Err(format!(
                "S3 save-backup upload failed with status {}: {}",
                status,
                trim_response_body(&body)
            ))
        }
    }
}

/// Git provider implementation
pub struct GitProvider {
    config: GitConfig,
    repo_path: PathBuf,
}

impl GitProvider {
    pub fn new(config: GitConfig) -> Result<Self, String> {
        let repo_path = app_data_root().join("sync-repo");
        Ok(Self { config, repo_path })
    }

    fn prepare_repo(&self) -> Result<git2::Repository, String> {
        use git2::Repository;

        fs::create_dir_all(&self.repo_path)
            .map_err(|e| format!("Failed to create repo directory: {}", e))?;

        if self.repo_path.join(".git").exists() {
            Repository::open(&self.repo_path).map_err(|e| format!("Failed to open repo: {}", e))
        } else {
            Repository::init(&self.repo_path).map_err(|e| format!("Failed to init repo: {}", e))
        }
    }

    fn commit_and_push_file(
        &self,
        relative_path: &str,
        data: &[u8],
        message: &str,
    ) -> Result<(), String> {
        use git2::{Oid, Signature};

        let repo = self.prepare_repo()?;
        let target_path = self.repo_path.join(relative_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create target directory: {}", e))?;
        }
        fs::write(&target_path, data)
            .map_err(|e| format!("Failed to write {}: {}", relative_path, e))?;

        let mut index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;
        index
            .add_path(std::path::Path::new(relative_path))
            .map_err(|e| format!("Failed to stage file: {}", e))?;
        index
            .write()
            .map_err(|e| format!("Failed to write index: {}", e))?;

        let tree_id = index
            .write_tree()
            .map_err(|e| format!("Failed to write tree: {}", e))?;
        let tree = repo
            .find_tree(tree_id)
            .map_err(|e| format!("Failed to find tree: {}", e))?;

        let sig = Signature::now("Libmaly", "libmaly@local")
            .map_err(|e| format!("Failed to create signature: {}", e))?;

        let head_oid = match repo.head() {
            Ok(head) => Some(head.target().unwrap_or(Oid::zero())),
            Err(_) => None,
        };

        let parents = match head_oid {
            Some(oid) if !oid.is_zero() => vec![repo
                .find_commit(oid)
                .map_err(|e| format!("Failed to find commit: {}", e))?],
            _ => vec![],
        };
        let parents_refs: Vec<&git2::Commit> = parents.iter().collect();

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents_refs)
            .map_err(|e| format!("Failed to commit: {}", e))?;

        let mut remote = repo
            .find_remote("origin")
            .or_else(|_| repo.remote("origin", &self.config.url))
            .map_err(|e| format!("Failed to get remote: {}", e))?;

        let mut callbacks = git2::RemoteCallbacks::new();
        let username = self.config.username.clone();
        let password = self.config.password.clone();
        callbacks.credentials(move |_url, username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext(
                username.as_deref().unwrap_or(username_from_url.unwrap()),
                password.as_deref().unwrap_or(""),
            )
        });

        let mut push_options = git2::PushOptions::default();
        push_options.remote_callbacks(callbacks);

        remote
            .push(
                &[format!("refs/heads/{}", self.config.branch)],
                Some(&mut push_options),
            )
            .map_err(|e| format!("Failed to push: {}", e))?;

        Ok(())
    }

    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        self.commit_and_push_file(
            "state.json",
            data.as_bytes(),
            &format!("Sync update at {}", Utc::now().to_rfc3339()),
        )
    }

    async fn download(&self) -> Result<(String, SyncMetadata), String> {
        use git2::{FetchOptions, Repository};
        use std::fs;

        // Clone or fetch
        if self.repo_path.exists() {
            let repo = Repository::open(&self.repo_path)
                .map_err(|e| format!("Failed to open repo: {}", e))?;

            let mut remote = repo
                .find_remote("origin")
                .map_err(|e| format!("Failed to find remote: {}", e))?;

            let username = self.config.username.clone();
            let password = self.config.password.clone();
            let mut callbacks = git2::RemoteCallbacks::new();
            callbacks.credentials(move |_url, username_from_url, _allowed_types| {
                git2::Cred::userpass_plaintext(
                    username.as_deref().unwrap_or(username_from_url.unwrap()),
                    password.as_deref().unwrap_or(""),
                )
            });

            let mut fetch_options = FetchOptions::default();
            fetch_options.remote_callbacks(callbacks);

            remote
                .fetch(&[&self.config.branch], Some(&mut fetch_options), None)
                .map_err(|e| format!("Failed to fetch: {}", e))?;
        } else {
            let username = self.config.username.clone();
            let password = self.config.password.clone();
            let mut callbacks = git2::RemoteCallbacks::new();
            callbacks.credentials(move |_url, username_from_url, _allowed_types| {
                git2::Cred::userpass_plaintext(
                    username.as_deref().unwrap_or(username_from_url.unwrap()),
                    password.as_deref().unwrap_or(""),
                )
            });

            let mut fetch_options = FetchOptions::default();
            fetch_options.remote_callbacks(callbacks);

            Repository::clone(&self.config.url, &self.repo_path)
                .map_err(|e| format!("Failed to clone: {}", e))?;
        }

        // Read state file
        let state_path = self.repo_path.join("state.json");
        let data =
            fs::read_to_string(&state_path).map_err(|e| format!("Failed to read state: {}", e))?;

        let metadata = SyncMetadata {
            last_sync_at: Utc::now().timestamp() as u64,
            last_sync_hash: format!("{:x}", md5::compute(data.as_bytes())),
            provider_type: SyncProviderType::Git,
        };

        Ok((data, metadata))
    }

    async fn exists(&self) -> Result<bool, String> {
        Ok(self.repo_path.join(".git").exists())
    }

    pub async fn upload_save_backup(&self, file_name: &str, data: &[u8]) -> Result<String, String> {
        let relative_path = format!("save-backups/{}", file_name);
        self.commit_and_push_file(
            &relative_path,
            data,
            &format!("Save backup {} at {}", file_name, Utc::now().to_rfc3339()),
        )?;
        Ok(relative_path)
    }
}

/// Create a sync provider from configuration
pub fn create_provider(config: SyncProviderConfig) -> Result<SyncProvider, String> {
    match config {
        SyncProviderConfig::Webdav(cfg) => Ok(SyncProvider::Webdav(WebdavProvider::new(cfg))),
        SyncProviderConfig::Nextcloud(cfg) => {
            Ok(SyncProvider::Nextcloud(NextcloudProvider::new(cfg)))
        }
        SyncProviderConfig::S3(cfg) => Ok(SyncProvider::S3(S3Provider::new(cfg)?)),
        SyncProviderConfig::Git(cfg) => Ok(SyncProvider::Git(GitProvider::new(cfg)?)),
        SyncProviderConfig::GoogleDrive(cfg) => {
            Ok(SyncProvider::GoogleDrive(GoogleDriveProvider::new(cfg)))
        }
        SyncProviderConfig::Dropbox(cfg) => Ok(SyncProvider::Dropbox(DropboxProvider::new(cfg))),
    }
}

/// Compute MD5 hash
pub fn compute_hash(data: &str) -> String {
    use md5;
    format!("{:x}", md5::compute(data.as_bytes()))
}
