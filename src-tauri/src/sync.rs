use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use chrono::Utc;
use crate::data_paths::app_data_root;

/// Sync provider type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SyncProviderType {
    Webdav,
    Nextcloud,
    S3,
    Git,
}

/// Sync provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "lowercase")]
pub enum SyncProviderConfig {
    Webdav(WebdavConfig),
    Nextcloud(NextcloudConfig),
    S3(S3Config),
    Git(GitConfig),
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

/// Conflict information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub key: String,
    pub local_value: String,
    pub remote_value: String,
    pub base_value: String,
}

/// Sync provider enum for dispatch
pub enum SyncProvider {
    Webdav(WebdavProvider),
    Nextcloud(NextcloudProvider),
    S3(S3Provider),
    Git(GitProvider),
}

impl SyncProvider {
    pub async fn upload(&self, data: &str, metadata: &SyncMetadata) -> Result<(), String> {
        match self {
            SyncProvider::Webdav(p) => p.upload(data, metadata).await,
            SyncProvider::Nextcloud(p) => p.upload(data, metadata).await,
            SyncProvider::S3(p) => p.upload(data, metadata).await,
            SyncProvider::Git(p) => p.upload(data, metadata).await,
        }
    }
    
    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        match self {
            SyncProvider::Webdav(p) => p.download().await,
            SyncProvider::Nextcloud(p) => p.download().await,
            SyncProvider::S3(p) => p.download().await,
            SyncProvider::Git(p) => p.download().await,
        }
    }
    
    pub async fn exists(&self) -> Result<bool, String> {
        match self {
            SyncProvider::Webdav(p) => p.exists().await,
            SyncProvider::Nextcloud(p) => p.exists().await,
            SyncProvider::S3(p) => p.exists().await,
            SyncProvider::Git(p) => p.exists().await,
        }
    }
    
    pub fn provider_type(&self) -> SyncProviderType {
        match self {
            SyncProvider::Webdav(_) => SyncProviderType::Webdav,
            SyncProvider::Nextcloud(_) => SyncProviderType::Nextcloud,
            SyncProvider::S3(_) => SyncProviderType::S3,
            SyncProvider::Git(_) => SyncProviderType::Git,
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
        let client = reqwest::Client::builder()
            .build()
            .unwrap_or_default();
        Self { config, client }
    }
    
    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), self.config.path.trim_start_matches('/'));
        
        let response = self.client
            .put(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .header("Content-Type", "application/json")
            .body(data.to_string())
            .send()
            .await
            .map_err(|e| format!("WebDAV upload failed: {}", e))?;
        
        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("WebDAV upload failed with status: {}", response.status()))
        }
    }
    
    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), self.config.path.trim_start_matches('/'));
        
        let response = self.client
            .get(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await
            .map_err(|e| format!("WebDAV download failed: {}", e))?;
        
        if response.status().is_success() {
            let data = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
            let metadata = SyncMetadata {
                last_sync_at: Utc::now().timestamp() as u64,
                last_sync_hash: format!("{:x}", md5::compute(data.as_bytes())),
                provider_type: SyncProviderType::Webdav,
            };
            Ok((data, metadata))
        } else {
            Err(format!("WebDAV download failed with status: {}", response.status()))
        }
    }
    
    pub async fn exists(&self) -> Result<bool, String> {
        let url = format!("{}/{}", self.config.url.trim_end_matches('/'), self.config.path.trim_start_matches('/'));
        
        let response = self.client
            .head(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .send()
            .await
            .map_err(|e| format!("WebDAV check failed: {}", e))?;
        
        Ok(response.status().is_success())
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
        let metadata = SyncMetadata {
            last_sync_at: Utc::now().timestamp() as u64,
            last_sync_hash: format!("{:x}", md5::compute(data.as_bytes())),
            provider_type: SyncProviderType::Nextcloud,
        };
        Ok((data, metadata))
    }
    
    pub async fn exists(&self) -> Result<bool, String> {
        self.webdav.exists().await
    }
}

/// S3 provider implementation
pub struct S3Provider {
    _config: S3Config,
}

impl S3Provider {
    pub fn new(config: S3Config) -> Self {
        Self { _config: config }
    }
    
    pub async fn upload(&self, _data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        Err("S3 provider requires AWS SDK integration. Please use WebDAV, Nextcloud, or Git for now.".to_string())
    }
    
    pub async fn download(&self) -> Result<(String, SyncMetadata), String> {
        Err("S3 provider requires AWS SDK integration. Please use WebDAV, Nextcloud, or Git for now.".to_string())
    }
    
    pub async fn exists(&self) -> Result<bool, String> {
        Err("S3 provider requires AWS SDK integration. Please use WebDAV, Nextcloud, or Git for now.".to_string())
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
    
    pub async fn upload(&self, data: &str, _metadata: &SyncMetadata) -> Result<(), String> {
        use git2::{Repository, Signature, Oid};
        use std::fs;
        
        // Ensure repo directory exists
        fs::create_dir_all(&self.repo_path)
            .map_err(|e| format!("Failed to create repo directory: {}", e))?;
        
        let repo = if self.repo_path.join(".git").exists() {
            Repository::open(&self.repo_path)
                .map_err(|e| format!("Failed to open repo: {}", e))?
        } else {
            Repository::init(&self.repo_path)
                .map_err(|e| format!("Failed to init repo: {}", e))?
        };
        
        // Write state file
        let state_path = self.repo_path.join("state.json");
        fs::write(&state_path, data)
            .map_err(|e| format!("Failed to write state: {}", e))?;
        
        // Stage and commit
        let mut index = repo.index()
            .map_err(|e| format!("Failed to get index: {}", e))?;
        index.add_path(std::path::Path::new("state.json"))
            .map_err(|e| format!("Failed to stage file: {}", e))?;
        index.write()
            .map_err(|e| format!("Failed to write index: {}", e))?;
        
        let tree_id = index.write_tree()
            .map_err(|e| format!("Failed to write tree: {}", e))?;
        let tree = repo.find_tree(tree_id)
            .map_err(|e| format!("Failed to find tree: {}", e))?;
        
        let sig = Signature::now("Libmaly", "libmaly@local")
            .map_err(|e| format!("Failed to create signature: {}", e))?;
        
        let head_oid = match repo.head() {
            Ok(head) => Some(head.target().unwrap_or(Oid::zero())),
            Err(_) => None,
        };
        
        let parents = match head_oid {
            Some(oid) if !oid.is_zero() => vec![repo.find_commit(oid).map_err(|e| format!("Failed to find commit: {}", e))?],
            _ => vec![],
        };
        
        let parents_refs: Vec<&git2::Commit> = parents.iter().collect();
        
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &format!("Sync update at {}", Utc::now().to_rfc3339()),
            &tree,
            &parents_refs,
        ).map_err(|e| format!("Failed to commit: {}", e))?;
        
        // Push to remote
        let mut remote = repo.find_remote("origin")
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
        
        remote.push(&[format!("refs/heads/{}", self.config.branch)], Some(&mut push_options))
            .map_err(|e| format!("Failed to push: {}", e))?;
        
        Ok(())
    }
    
    async fn download(&self) -> Result<(String, SyncMetadata), String> {
        use git2::{Repository, FetchOptions};
        use std::fs;
        
        // Clone or fetch
        if self.repo_path.exists() {
            let repo = Repository::open(&self.repo_path)
                .map_err(|e| format!("Failed to open repo: {}", e))?;
            
            let mut remote = repo.find_remote("origin")
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
            
            remote.fetch(&[&self.config.branch], Some(&mut fetch_options), None)
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
        let data = fs::read_to_string(&state_path)
            .map_err(|e| format!("Failed to read state: {}", e))?;
        
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
}

/// Create a sync provider from configuration
pub fn create_provider(config: SyncProviderConfig) -> Result<SyncProvider, String> {
    match config {
        SyncProviderConfig::Webdav(cfg) => Ok(SyncProvider::Webdav(WebdavProvider::new(cfg))),
        SyncProviderConfig::Nextcloud(cfg) => Ok(SyncProvider::Nextcloud(NextcloudProvider::new(cfg))),
        SyncProviderConfig::S3(cfg) => Ok(SyncProvider::S3(S3Provider::new(cfg))),
        SyncProviderConfig::Git(cfg) => Ok(SyncProvider::Git(GitProvider::new(cfg)?)),
    }
}

/// Compute MD5 hash
pub fn compute_hash(data: &str) -> String {
    use md5;
    format!("{:x}", md5::compute(data.as_bytes()))
}

/// Detect conflicts between local and remote state
pub fn detect_conflicts(local: &HashMap<String, String>, remote: &HashMap<String, String>) -> Vec<SyncConflict> {
    let mut conflicts = Vec::new();
    
    for (key, local_val) in local {
        if let Some(remote_val) = remote.get(key) {
            if local_val != remote_val {
                conflicts.push(SyncConflict {
                    key: key.clone(),
                    local_value: local_val.clone(),
                    remote_value: remote_val.clone(),
                    base_value: String::new(), // Would need 3-way merge for proper base
                });
            }
        }
    }
    
    conflicts
}

/// Merge state with conflict resolution
pub fn merge_state(
    local: HashMap<String, String>,
    remote: HashMap<String, String>,
    conflicts: &[SyncConflict],
    resolution: &HashMap<String, String>, // key -> "local" or "remote"
) -> HashMap<String, String> {
    let mut merged = HashMap::new();
    
    // Start with remote state
    for (key, value) in &remote {
        if conflicts.iter().any(|c| c.key == *key) {
            // Apply resolution
            if let Some(res) = resolution.get(key) {
                if res == "local" {
                    if let Some(local_val) = local.get(key) {
                        merged.insert(key.clone(), local_val.clone());
                    }
                } else {
                    merged.insert(key.clone(), value.clone());
                }
            } else {
                // Default to remote
                merged.insert(key.clone(), value.clone());
            }
        } else {
            merged.insert(key.clone(), value.clone());
        }
    }
    
    // Add local-only entries
    for (key, value) in local {
        if !remote.contains_key(&key) {
            merged.insert(key, value);
        }
    }
    
    merged
}
