//! Friend Activity
//!
//! Lets users maintain a persistent "friends" list (identified by Pulse peer IDs
//! or Portable Identity public key fingerprints) and query what those friends are
//! currently playing, sourcing data from the live Pulse peer map.
//!
//! # Design
//! - **Relay-agnostic**: works with any self-hosted relay that supports the Pulse
//!   protocol.  No platform-specific friend service is required.
//! - **Privacy-first**: the friends list is stored locally only.  No list of who
//!   you have friended is ever transmitted to the relay.
//! - **Opt-in**: users add friends explicitly by peer ID (copied from the Pulse
//!   tab or shared out-of-band).  There is no automatic discovery.
//!
//! # Data flow
//! ```
//! pulse peer map (live, in-memory) ──► friends_get_activity()
//!                                         cross-refs with friends_config.json
//!                                         ► Vec<FriendActivityEntry>
//! ```

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::data_paths::app_data_root;
use crate::pulse::{pulse_get_peers, PeerInfo};

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_FILE: &str = "friends_config.json";

/// Peers not seen within this window are considered offline even if they're
/// still in the pulse peer map (beacon TTL may keep them in the map briefly).
const ONLINE_WINDOW_SECS: u64 = 300; // 5 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

/// One saved friend.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FriendEntry {
    /// Pulse peer ID used to match against live beacons.
    pub peer_id: String,
    /// Optional local nickname — overrides the display name from their beacon.
    #[serde(default)]
    pub nickname: Option<String>,
    /// Unix seconds when this friend was added.
    #[serde(default)]
    pub added_at: u64,
    /// Optional note (e.g., "met on F95 thread").
    #[serde(default)]
    pub note: Option<String>,
}

/// Full persisted friends configuration.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct FriendsConfig {
    #[serde(default)]
    friends: Vec<FriendEntry>,
}

/// Activity status for one friend, merged from saved record + live beacon.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FriendActivityEntry {
    /// Peer ID from the saved friend record.
    pub peer_id: String,
    /// Display name: nickname override if set, otherwise from beacon, else peer_id.
    pub display_name: String,
    /// Avatar URL from the most recent beacon (if any).
    pub avatar_url: Option<String>,
    /// Game title from the current beacon (None = online but idle / no game shared).
    pub game_title: Option<String>,
    /// Cover URL for the current game (from beacon, optional).
    pub cover_url: Option<String>,
    /// Unix seconds when the current gaming session started.
    pub session_start: Option<u64>,
    /// True when the friend is currently online (beacon received recently).
    pub is_online: bool,
    /// Unix seconds of the last received beacon (None = never seen online).
    pub last_seen: Option<u64>,
    /// Whether the last beacon came via relay vs. LAN.
    pub via_relay: bool,
    /// Local note saved by the user for this friend.
    pub note: Option<String>,
    /// Unix seconds when this friend was added.
    pub added_at: u64,
}

// ── Persistence ───────────────────────────────────────────────────────────────

fn config_path() -> std::path::PathBuf {
    app_data_root().join(CONFIG_FILE)
}

fn load_config() -> FriendsConfig {
    let path = config_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_config(cfg: &FriendsConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Merge a `FriendEntry` with an optional live `PeerInfo` into a `FriendActivityEntry`.
fn merge(entry: &FriendEntry, peer: Option<&PeerInfo>) -> FriendActivityEntry {
    let now = now_secs();

    let (
        display_name,
        avatar_url,
        game_title,
        cover_url,
        session_start,
        is_online,
        last_seen,
        via_relay,
    ) = match peer {
        Some(p) => {
            let online = now.saturating_sub(p.last_seen) < ONLINE_WINDOW_SECS;
            (
                entry
                    .nickname
                    .clone()
                    .unwrap_or_else(|| p.display_name.clone()),
                p.avatar_url.clone(),
                p.activity.as_ref().map(|a| a.title.clone()),
                p.activity.as_ref().and_then(|a| a.cover_url.clone()),
                p.activity.as_ref().map(|a| a.session_start),
                online,
                Some(p.last_seen),
                p.via_relay,
            )
        }
        None => (
            entry
                .nickname
                .clone()
                .unwrap_or_else(|| entry.peer_id.clone()),
            None,
            None,
            None,
            None,
            false,
            None,
            false,
        ),
    };

    FriendActivityEntry {
        peer_id: entry.peer_id.clone(),
        display_name,
        avatar_url,
        game_title,
        cover_url,
        session_start,
        is_online,
        last_seen,
        via_relay,
        note: entry.note.clone(),
        added_at: entry.added_at,
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// List all saved friends (without live activity data).
#[tauri::command]
pub fn friends_list() -> Vec<FriendEntry> {
    load_config().friends
}

/// Add a friend by peer ID.  If a friend with that peer ID already exists the
/// nickname / note are updated in-place; no duplicate is created.
#[tauri::command]
pub fn friends_add(
    peer_id: String,
    nickname: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let peer_id = peer_id.trim().to_string();
    if peer_id.is_empty() {
        return Err("Peer ID must not be empty.".into());
    }
    let mut cfg = load_config();
    if let Some(existing) = cfg.friends.iter_mut().find(|f| f.peer_id == peer_id) {
        // Update existing
        existing.nickname = nickname;
        existing.note = note;
    } else {
        cfg.friends.push(FriendEntry {
            peer_id,
            nickname,
            added_at: now_secs(),
            note,
        });
    }
    persist_config(&cfg)
}

/// Remove a friend by peer ID.  No-op if the peer ID is not in the list.
#[tauri::command]
pub fn friends_remove(peer_id: String) -> Result<(), String> {
    let mut cfg = load_config();
    let before = cfg.friends.len();
    cfg.friends.retain(|f| f.peer_id != peer_id);
    if cfg.friends.len() == before {
        return Ok(()); // already gone — not an error
    }
    persist_config(&cfg)
}

/// Update the nickname or note for an existing friend.
#[tauri::command]
pub fn friends_update(
    peer_id: String,
    nickname: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let mut cfg = load_config();
    let entry = cfg
        .friends
        .iter_mut()
        .find(|f| f.peer_id == peer_id)
        .ok_or_else(|| format!("Friend '{}' not found.", peer_id))?;
    entry.nickname = nickname;
    entry.note = note;
    persist_config(&cfg)
}

/// Return activity for ALL saved friends, cross-referenced with live Pulse data.
///
/// Friends currently online come first; offline friends are sorted by
/// last_seen descending (most recently seen first).
#[tauri::command]
pub fn friends_get_activity() -> Vec<FriendActivityEntry> {
    let cfg = load_config();
    if cfg.friends.is_empty() {
        return Vec::new();
    }

    // Snapshot the live peer map once.
    let live_peers: Vec<PeerInfo> = pulse_get_peers();
    let peer_map: std::collections::HashMap<&str, &PeerInfo> =
        live_peers.iter().map(|p| (p.peer_id.as_str(), p)).collect();

    let mut entries: Vec<FriendActivityEntry> = cfg
        .friends
        .iter()
        .map(|f| merge(f, peer_map.get(f.peer_id.as_str()).copied()))
        .collect();

    // Sort: online first, then by last_seen desc.
    entries.sort_by(|a, b| match (a.is_online, b.is_online) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => b.last_seen.cmp(&a.last_seen),
    });

    entries
}

/// Convenience command: returns only friends who are currently online and
/// playing something (for compact HomeView widgets).
#[tauri::command]
pub fn friends_get_now_playing() -> Vec<FriendActivityEntry> {
    friends_get_activity()
        .into_iter()
        .filter(|e| e.is_online && e.game_title.is_some())
        .collect()
}
