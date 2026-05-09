//! Concurrent Social Providers
//!
//! Architecture that aggregates peer/friend data from multiple independent
//! social identity sources (Pulse LAN/relay, Discord SDK, Steam Web API, …)
//! without any one source "extinguishing" or overriding another.
//!
//! # Core concepts
//!
//! ## Provider
//! Any source of social presence information (who is online, what are they
//! playing).  Each provider has a stable string ID (`"pulse"`, `"discord"`,
//! `"steam"`, or a custom string).  Providers are independent: adding Discord
//! does not affect Pulse, and vice-versa.
//!
//! ## SocialPeerRecord
//! A peer as reported by exactly one provider.  Tagged with `provider_id` and
//! a `provider_peer_id` that is stable within that provider.
//!
//! ## UnifiedPeer
//! The merged view of a person across all providers.  Two records are merged
//! only when the user **explicitly links** them via `social_link_identities`.
//! Without a link, records from different providers appear side-by-side with
//! their source badges — no accidental collisions.
//!
//! ## Identity link
//! A user-asserted equivalence: "Discord:123456" = "Pulse:abc".  Stored in
//! `social_identity_links.json`.  The union-find algorithm groups linked
//! records and picks the best display data.
//!
//! ## Steam provider
//! Polls Steam Web API (GetFriendList + GetPlayerSummaries) every 60 s.
//! Requires the user's Steam API key and Steam64 ID in the provider config.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::data_paths::app_data_root;

// ── Well-known provider IDs ───────────────────────────────────────────────────

pub const PROVIDER_PULSE: &str = "pulse";
pub const PROVIDER_DISCORD: &str = "discord";
pub const PROVIDER_STEAM: &str = "steam";

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Public re-export for sibling modules (e.g. discord.rs).
pub fn now_secs_pub() -> u64 {
    now_secs()
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Provider-agnostic gaming activity.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SocialActivity {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    /// Unix seconds when the session started (if known).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_start: Option<u64>,
    /// Human-readable status e.g. "Playing via Steam".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_text: Option<String>,
}

/// A peer as reported by one specific provider.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SocialPeerRecord {
    pub provider_id: String,
    pub provider_peer_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<SocialActivity>,
    pub last_seen: u64,
    pub online: bool,
}

/// A single source entry within a UnifiedPeer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SocialSource {
    pub provider_id: String,
    pub provider_peer_id: String,
    pub last_seen: u64,
    pub online: bool,
}

/// Merged peer view across all providers.
///
/// Two records are only merged when the user has explicitly linked them.
/// Without a link, records from different providers remain separate.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedPeer {
    /// Stable identifier: `"<primary_provider>:<primary_peer_id>"`.
    pub unified_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<SocialActivity>,
    /// Every provider that currently reports this peer.
    pub sources: Vec<SocialSource>,
    /// Unix seconds of the most recent update across all sources.
    pub last_seen: u64,
}

/// User-asserted equivalence between two provider identities.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SocialIdentityLink {
    pub provider_a: String,
    pub peer_id_a: String,
    pub provider_b: String,
    pub peer_id_b: String,
}

/// Automatic suggestion when two records from different providers share the
/// same display name.  The user must confirm before the link is stored.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdentityLinkSuggestion {
    pub provider_a: String,
    pub peer_id_a: String,
    pub display_name_a: String,
    pub provider_b: String,
    pub peer_id_b: String,
    pub display_name_b: String,
}

/// Per-provider configuration persisted to disk.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SocialProviderConfig {
    pub provider_id: String,
    /// Whether this provider should contribute to the unified feed.
    pub enabled: bool,
    /// Human-readable label shown in the UI.
    pub label: String,
    /// Opaque string→string bag; each provider reads what it needs.
    ///   Steam: `"apiKey"`, `"steamId"`
    #[serde(default)]
    pub credentials: HashMap<String, String>,
}

impl SocialProviderConfig {
    fn default_for(id: &str) -> Self {
        Self {
            provider_id: id.to_owned(),
            enabled: false,
            label: match id {
                PROVIDER_PULSE => "Pulse (LAN / Relay)".to_owned(),
                PROVIDER_DISCORD => "Discord".to_owned(),
                PROVIDER_STEAM => "Steam".to_owned(),
                other => other.to_owned(),
            },
            credentials: HashMap::new(),
        }
    }
}

/// Live status summary for one provider.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SocialProviderStatus {
    pub provider_id: String,
    /// `"active"` | `"connecting"` | `"disconnected"` | `"error: <msg>"`
    pub status: String,
    pub peer_count: usize,
}

// ── Config / links file names ─────────────────────────────────────────────────

const CONFIG_FILE: &str = "social_providers.json";
const LINKS_FILE: &str = "social_identity_links.json";

const BUILTIN_PROVIDERS: &[&str] = &[PROVIDER_PULSE, PROVIDER_DISCORD, PROVIDER_STEAM];

// ── Union-Find helpers (free functions to avoid lifetime issues) ───────────────

type UfKey = (String, String);

fn uf_find(parent: &mut HashMap<UfKey, UfKey>, key: UfKey) -> UfKey {
    if !parent.contains_key(&key) {
        parent.insert(key.clone(), key.clone());
        return key;
    }
    let p = parent[&key].clone();
    if p == key {
        return key;
    }
    let root = uf_find(parent, p);
    parent.insert(key.clone(), root.clone());
    root
}

fn uf_union(parent: &mut HashMap<UfKey, UfKey>, a: UfKey, b: UfKey) {
    let ra = uf_find(parent, a);
    let rb = uf_find(parent, b);
    if ra != rb {
        parent.insert(rb, ra);
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

struct SocialRegistry {
    app: Option<AppHandle>,
    /// provider_id → current live records
    records: HashMap<String, Vec<SocialPeerRecord>>,
    /// provider_id → status string
    statuses: HashMap<String, String>,
    /// User-asserted identity links
    links: Vec<SocialIdentityLink>,
    /// Persisted provider configs
    configs: Vec<SocialProviderConfig>,
}

impl SocialRegistry {
    fn new() -> Self {
        Self {
            app: None,
            records: HashMap::new(),
            statuses: HashMap::new(),
            links: load_links(),
            configs: load_all_configs(),
        }
    }

    fn unified_peers(&self) -> Vec<UnifiedPeer> {
        // Collect all online records across all enabled providers
        let all: Vec<&SocialPeerRecord> = self
            .records
            .values()
            .flat_map(|v| v.iter())
            .filter(|r| r.online)
            .collect();

        if all.is_empty() {
            return vec![];
        }

        // Build union-find structure
        let mut parent: HashMap<UfKey, UfKey> = HashMap::new();

        // Apply explicit identity links
        for link in &self.links {
            let a = (link.provider_a.clone(), link.peer_id_a.clone());
            let b = (link.provider_b.clone(), link.peer_id_b.clone());
            uf_union(&mut parent, a, b);
        }

        // Group records by union-find root
        let mut groups: HashMap<UfKey, Vec<&SocialPeerRecord>> = HashMap::new();
        for record in &all {
            let key = (record.provider_id.clone(), record.provider_peer_id.clone());
            let root = uf_find(&mut parent, key);
            groups.entry(root).or_default().push(record);
        }

        // Provider priority for display_name / avatar resolution
        let priority = |pid: &str| match pid {
            PROVIDER_PULSE => 0u8,
            PROVIDER_DISCORD => 1,
            PROVIDER_STEAM => 2,
            _ => 3,
        };

        let mut unified: Vec<UnifiedPeer> = groups
            .into_iter()
            .map(|(root_key, mut records)| {
                records.sort_by_key(|r| priority(&r.provider_id));

                let primary = records[0];
                let last_seen = records.iter().map(|r| r.last_seen).max().unwrap_or(0);

                // Best activity: prefer the record with the most recent session_start
                let activity = records
                    .iter()
                    .filter_map(|r| r.activity.as_ref())
                    .max_by_key(|a| a.session_start.unwrap_or(0))
                    .cloned();

                let avatar_url = records.iter().find_map(|r| r.avatar_url.clone());

                UnifiedPeer {
                    unified_id: format!("{}:{}", root_key.0, root_key.1),
                    display_name: primary.display_name.clone(),
                    avatar_url,
                    activity,
                    sources: records
                        .iter()
                        .map(|r| SocialSource {
                            provider_id: r.provider_id.clone(),
                            provider_peer_id: r.provider_peer_id.clone(),
                            last_seen: r.last_seen,
                            online: r.online,
                        })
                        .collect(),
                    last_seen,
                }
            })
            .collect();

        // Sort: playing first, then by last_seen descending
        unified.sort_by(|a, b| {
            b.activity
                .is_some()
                .cmp(&a.activity.is_some())
                .then(b.last_seen.cmp(&a.last_seen))
        });

        unified
    }

    fn suggest_links(&self) -> Vec<IdentityLinkSuggestion> {
        let all: Vec<&SocialPeerRecord> = self.records.values().flat_map(|v| v.iter()).collect();

        let mut suggestions = Vec::new();
        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                let a = all[i];
                let b = all[j];
                if a.provider_id == b.provider_id {
                    continue;
                }

                // Skip already linked
                let linked = self.links.iter().any(|l| {
                    (l.provider_a == a.provider_id
                        && l.peer_id_a == a.provider_peer_id
                        && l.provider_b == b.provider_id
                        && l.peer_id_b == b.provider_peer_id)
                        || (l.provider_a == b.provider_id
                            && l.peer_id_a == b.provider_peer_id
                            && l.provider_b == a.provider_id
                            && l.peer_id_b == a.provider_peer_id)
                });
                if linked {
                    continue;
                }

                if a.display_name.trim().to_lowercase() == b.display_name.trim().to_lowercase() {
                    suggestions.push(IdentityLinkSuggestion {
                        provider_a: a.provider_id.clone(),
                        peer_id_a: a.provider_peer_id.clone(),
                        display_name_a: a.display_name.clone(),
                        provider_b: b.provider_id.clone(),
                        peer_id_b: b.provider_peer_id.clone(),
                        display_name_b: b.display_name.clone(),
                    });
                }
            }
        }
        suggestions
    }

    fn emit_update(&self) {
        if let Some(app) = &self.app {
            let _ = app.emit("social-peers-updated", &self.unified_peers());
        }
    }
}

// ── Global state ──────────────────────────────────────────────────────────────

static REGISTRY: OnceLock<Arc<Mutex<SocialRegistry>>> = OnceLock::new();

fn registry() -> &'static Arc<Mutex<SocialRegistry>> {
    REGISTRY.get_or_init(|| Arc::new(Mutex::new(SocialRegistry::new())))
}

/// Initialise the registry with the app handle (call once from `setup`).
pub fn init(app: AppHandle) {
    registry().lock().unwrap().app = Some(app);
}

// ── Feed interface (called by providers) ──────────────────────────────────────

/// Submit the current peer list from a provider.
/// Overwrites the previous list for that provider; does not affect others.
pub fn submit_peers(provider_id: &str, records: Vec<SocialPeerRecord>) {
    let mut reg = registry().lock().unwrap();
    reg.records.insert(provider_id.to_owned(), records);
    reg.statuses
        .insert(provider_id.to_owned(), "active".to_owned());
    reg.emit_update();
}

/// Update a provider's status string without touching its peer list.
/// Calling with a non-active status clears the peer list for that provider.
pub fn set_provider_status(provider_id: &str, status: &str) {
    let mut reg = registry().lock().unwrap();
    reg.statuses
        .insert(provider_id.to_owned(), status.to_owned());
    if status.starts_with("error") || status.starts_with("disconnected") {
        reg.records.remove(provider_id);
        reg.emit_update();
    }
}

// ── Persistence helpers ───────────────────────────────────────────────────────

fn load_all_configs() -> Vec<SocialProviderConfig> {
    let path = app_data_root().join(CONFIG_FILE);
    let mut saved: Vec<SocialProviderConfig> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();

    // Ensure every builtin provider has an entry
    for &id in BUILTIN_PROVIDERS {
        if !saved.iter().any(|c| c.provider_id == id) {
            saved.push(SocialProviderConfig::default_for(id));
        }
    }
    saved
}

fn save_all_configs(configs: &[SocialProviderConfig]) -> Result<(), String> {
    let dir = app_data_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(CONFIG_FILE), raw).map_err(|e| e.to_string())
}

fn load_links() -> Vec<SocialIdentityLink> {
    let path = app_data_root().join(LINKS_FILE);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_links(links: &[SocialIdentityLink]) -> Result<(), String> {
    let dir = app_data_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(links).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(LINKS_FILE), raw).map_err(|e| e.to_string())
}

// ── Steam provider (polling thread) ──────────────────────────────────────────
//
// Uses a per-thread tokio runtime to run async reqwest calls inside a
// std::thread (same pattern as pulse.rs relay thread).

static STEAM_STOP: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

fn steam_stop_cell() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    STEAM_STOP.get_or_init(|| Mutex::new(None))
}

#[derive(Deserialize)]
struct SteamFriendListResponse {
    friendslist: SteamFriendList,
}

#[derive(Deserialize)]
struct SteamFriendList {
    friends: Vec<SteamFriendEntry>,
}

#[derive(Deserialize)]
struct SteamFriendEntry {
    steamid: String,
}

#[derive(Deserialize)]
struct SteamPlayerSummariesResponse {
    response: SteamPlayersResponse,
}

#[derive(Deserialize)]
struct SteamPlayersResponse {
    players: Vec<SteamPlayer>,
}

#[derive(Deserialize)]
struct SteamPlayer {
    steamid: String,
    personaname: String,
    avatarfull: Option<String>,
    /// Set when the player is in-game; the game name.
    gameextrainfo: Option<String>,
    /// 0 = Offline, 1 = Online, 2 = Busy, 3 = Away, …
    personastate: u8,
}

pub fn start_steam_provider(api_key: String, steam_id: String) {
    // Stop any running Steam thread first
    if let Some(old) = steam_stop_cell().lock().unwrap().take() {
        old.store(true, Ordering::SeqCst);
    }

    let stop = Arc::new(AtomicBool::new(false));
    *steam_stop_cell().lock().unwrap() = Some(stop.clone());

    std::thread::Builder::new()
        .name("social-steam".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    set_provider_status(PROVIDER_STEAM, &format!("error: {}", e));
                    return;
                }
            };

            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .build()
                .unwrap_or_default();

            set_provider_status(PROVIDER_STEAM, "connecting");

            loop {
                if stop.load(Ordering::Relaxed) {
                    break;
                }

                // ── Fetch friend list ──
                let friends_url = format!(
                    "https://api.steampowered.com/ISteamUser/GetFriendList/v0001/\
                     ?key={}&steamid={}&relationship=friend&format=json",
                    api_key, steam_id
                );

                let friend_ids: Vec<String> = match rt.block_on(client.get(&friends_url).send()) {
                    Ok(resp) => match rt.block_on(resp.json::<SteamFriendListResponse>()) {
                        Ok(r) => r
                            .friendslist
                            .friends
                            .into_iter()
                            .map(|f| f.steamid)
                            .collect(),
                        Err(e) => {
                            set_provider_status(PROVIDER_STEAM, &format!("error: {}", e));
                            std::thread::sleep(Duration::from_secs(60));
                            continue;
                        }
                    },
                    Err(e) => {
                        set_provider_status(PROVIDER_STEAM, &format!("error: {}", e));
                        std::thread::sleep(Duration::from_secs(60));
                        continue;
                    }
                };

                if friend_ids.is_empty() {
                    submit_peers(PROVIDER_STEAM, vec![]);
                    std::thread::sleep(Duration::from_secs(60));
                    continue;
                }

                // ── Fetch player summaries (max 100 at once) ──
                let ids_str = friend_ids
                    .iter()
                    .take(100)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(",");

                let summaries_url = format!(
                    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/\
                     ?key={}&steamids={}&format=json",
                    api_key, ids_str
                );

                let records = match rt.block_on(client.get(&summaries_url).send()) {
                    Ok(resp) => {
                        match rt.block_on(resp.json::<SteamPlayerSummariesResponse>()) {
                            Ok(r) => {
                                let now = now_secs();
                                r.response
                                    .players
                                    .into_iter()
                                    .filter(|p| p.personastate > 0) // 0 = offline
                                    .map(|p| {
                                        let activity =
                                            p.gameextrainfo.as_ref().map(|game| SocialActivity {
                                                title: game.clone(),
                                                cover_url: None,
                                                session_start: None,
                                                status_text: Some("Playing via Steam".to_owned()),
                                            });
                                        SocialPeerRecord {
                                            provider_id: PROVIDER_STEAM.to_owned(),
                                            provider_peer_id: p.steamid,
                                            display_name: p.personaname,
                                            avatar_url: p.avatarfull,
                                            activity,
                                            last_seen: now,
                                            online: true,
                                        }
                                    })
                                    .collect::<Vec<_>>()
                            }
                            Err(e) => {
                                set_provider_status(PROVIDER_STEAM, &format!("error: {}", e));
                                std::thread::sleep(Duration::from_secs(60));
                                continue;
                            }
                        }
                    }
                    Err(e) => {
                        set_provider_status(PROVIDER_STEAM, &format!("error: {}", e));
                        std::thread::sleep(Duration::from_secs(60));
                        continue;
                    }
                };

                submit_peers(PROVIDER_STEAM, records);
                std::thread::sleep(Duration::from_secs(60));
            }

            // Clean up on exit
            submit_peers(PROVIDER_STEAM, vec![]);
            set_provider_status(PROVIDER_STEAM, "disconnected");
        })
        .ok();
}

pub fn stop_steam_provider() {
    if let Some(flag) = steam_stop_cell().lock().unwrap().as_ref() {
        flag.store(true, Ordering::SeqCst);
    }
    submit_peers(PROVIDER_STEAM, vec![]);
    set_provider_status(PROVIDER_STEAM, "disconnected");
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn social_get_unified_peers() -> Vec<UnifiedPeer> {
    registry().lock().unwrap().unified_peers()
}

#[tauri::command]
pub fn social_get_provider_configs() -> Vec<SocialProviderConfig> {
    registry().lock().unwrap().configs.clone()
}

#[tauri::command]
pub fn social_save_provider_config(config: SocialProviderConfig) -> Result<(), String> {
    let mut reg = registry().lock().unwrap();
    if let Some(existing) = reg
        .configs
        .iter_mut()
        .find(|c| c.provider_id == config.provider_id)
    {
        *existing = config;
    } else {
        reg.configs.push(config);
    }
    save_all_configs(&reg.configs)
}

#[tauri::command]
pub fn social_get_provider_statuses() -> Vec<SocialProviderStatus> {
    let reg = registry().lock().unwrap();
    let mut ids: std::collections::HashSet<String> = reg.statuses.keys().cloned().collect();
    for c in &reg.configs {
        ids.insert(c.provider_id.clone());
    }
    let mut out: Vec<SocialProviderStatus> = ids
        .into_iter()
        .map(|id| {
            let status = reg
                .statuses
                .get(&id)
                .cloned()
                .unwrap_or_else(|| "disconnected".to_owned());
            let peer_count = reg.records.get(&id).map(|v| v.len()).unwrap_or(0);
            SocialProviderStatus {
                provider_id: id,
                status,
                peer_count,
            }
        })
        .collect();
    // Stable order: builtin first, then alphabetical
    let order = |id: &str| match id {
        PROVIDER_PULSE => 0u8,
        PROVIDER_DISCORD => 1,
        PROVIDER_STEAM => 2,
        _ => 3,
    };
    out.sort_by(|a, b| {
        order(&a.provider_id)
            .cmp(&order(&b.provider_id))
            .then(a.provider_id.cmp(&b.provider_id))
    });
    out
}

/// Assert that two provider identities belong to the same real person.
/// Replaces any existing link for either identity.
#[tauri::command]
pub fn social_link_identities(
    provider_a: String,
    peer_id_a: String,
    provider_b: String,
    peer_id_b: String,
) -> Result<(), String> {
    let mut reg = registry().lock().unwrap();
    // Remove any link that already involves either endpoint
    reg.links.retain(|l| {
        !((l.provider_a == provider_a && l.peer_id_a == peer_id_a)
            || (l.provider_b == provider_a && l.peer_id_b == peer_id_a)
            || (l.provider_a == provider_b && l.peer_id_a == peer_id_b)
            || (l.provider_b == provider_b && l.peer_id_b == peer_id_b))
    });
    reg.links.push(SocialIdentityLink {
        provider_a,
        peer_id_a,
        provider_b,
        peer_id_b,
    });
    let links = reg.links.clone();
    save_links(&links)?;
    reg.emit_update();
    Ok(())
}

/// Remove any link involving the given identity endpoint.
#[tauri::command]
pub fn social_unlink_identities(provider_a: String, peer_id_a: String) -> Result<(), String> {
    let mut reg = registry().lock().unwrap();
    reg.links.retain(|l| {
        !((l.provider_a == provider_a && l.peer_id_a == peer_id_a)
            || (l.provider_b == provider_a && l.peer_id_b == peer_id_a))
    });
    let links = reg.links.clone();
    save_links(&links)?;
    reg.emit_update();
    Ok(())
}

/// Return currently stored identity links.
#[tauri::command]
pub fn social_get_identity_links() -> Vec<SocialIdentityLink> {
    registry().lock().unwrap().links.clone()
}

/// Suggest identity links where two records from different providers share
/// the same display name.  Returns suggestions only — nothing is auto-merged.
#[tauri::command]
pub fn social_get_link_suggestions() -> Vec<IdentityLinkSuggestion> {
    registry().lock().unwrap().suggest_links()
}

/// Start the Steam polling thread.
/// Returns an error if credentials are missing or the thread fails to spawn.
#[tauri::command]
pub fn social_steam_start(api_key: String, steam_id: String) -> Result<(), String> {
    let api_key = api_key.trim().to_owned();
    let steam_id = steam_id.trim().to_owned();
    if api_key.is_empty() || steam_id.is_empty() {
        return Err("Steam API key and Steam64 ID are both required.".into());
    }
    start_steam_provider(api_key, steam_id);
    Ok(())
}

/// Stop the Steam polling thread and clear its peer list.
#[tauri::command]
pub fn social_steam_stop() {
    stop_steam_provider();
}

// ── Unified activity feed ─────────────────────────────────────────────────────

/// A single item in the combined cross-provider activity feed.
///
/// Each item represents one person as seen by one specific provider.
/// Items from the same person across providers are NOT merged here; use
/// `social_get_unified_peers` for the merged view.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FeedItem {
    /// The provider that reported this item.
    pub provider_id: String,
    /// Provider-specific display name.
    pub display_name: String,
    /// Avatar URL (if available).
    pub avatar_url: Option<String>,
    /// Game / activity title (if the person is playing something).
    pub game_title: Option<String>,
    /// Optional cover art URL for the current game.
    pub cover_url: Option<String>,
    /// Unix seconds when the gaming session started (if known).
    pub session_start: Option<u64>,
    /// Human-readable sub-status from the provider (e.g. "Playing via Steam").
    pub status_text: Option<String>,
    /// Unix seconds of the most recent update from this provider.
    pub last_seen: u64,
    /// Whether the person appears to be online right now.
    pub is_online: bool,
}

/// Return a flat chronological activity feed from ALL providers.
///
/// The list is sorted by last_seen descending (most recent first).
/// Only online peers with or without a current game are included.
#[tauri::command]
pub fn social_get_activity_feed() -> Vec<FeedItem> {
    let reg = registry().lock().unwrap();
    let mut items: Vec<FeedItem> = reg
        .records
        .values()
        .flat_map(|v| v.iter())
        .filter(|r| r.online)
        .map(|r| FeedItem {
            provider_id: r.provider_id.clone(),
            display_name: r.display_name.clone(),
            avatar_url: r.avatar_url.clone(),
            game_title: r.activity.as_ref().map(|a| a.title.clone()),
            cover_url: r.activity.as_ref().and_then(|a| a.cover_url.clone()),
            session_start: r.activity.as_ref().and_then(|a| a.session_start),
            status_text: r.activity.as_ref().and_then(|a| a.status_text.clone()),
            last_seen: r.last_seen,
            is_online: r.online,
        })
        .collect();

    items.sort_by(|a, b| {
        // Playing a game first, then by last_seen desc
        b.game_title
            .is_some()
            .cmp(&a.game_title.is_some())
            .then(b.last_seen.cmp(&a.last_seen))
    });
    items
}
