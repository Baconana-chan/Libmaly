//! Peer-to-Peer Activity "Pulse"
//!
//! Broadcasts the user's current gaming activity to:
//!   • Local network via UDP broadcast (port 39511 by default, zero-config)
//!   • Optional HTTP relay (user-configurable URL, no central server required)
//!
//! # Protocol
//! Every BROADCAST_INTERVAL seconds (+ on game start/stop), each peer sends a
//! `PulseBeacon` JSON to 255.255.255.255 and, if configured, POSTs to the relay.
//! A companion receive loop processes incoming beacons from others on the LAN.
//! The relay is a simple REST API that any fan can self-host:
//!   POST /pulse/{room}/beacon           – submit your beacon
//!   GET  /pulse/{room}/peers?since=…    – fetch recent beacons from others
//!
//! # Authentication / Privacy
//! All peers must share the same "room key".  Only beacons carrying the same key
//! are shown.  For LAN this is transmitted in plaintext (local network).
//! For relay traffic the room key also acts as the URL path segment, so the URL
//! itself is the shared secret — only people who know it can participate.
//! Set a long random room key in settings to keep a private circle.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::data_paths::app_data_root;

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_FILE: &str = "pulse_config.json";
const PEER_ID_FILE: &str = "pulse_peer_id.txt";

const DEFAULT_LAN_PORT: u16 = 39511;
const BROADCAST_INTERVAL: Duration = Duration::from_secs(30);
/// Peer not seen for this many seconds → removed from list
const PEER_EXPIRY_LAN: u64 = 180;
const PEER_EXPIRY_RELAY: u64 = 120;
/// Maximum beacon size accepted from the network
const MAX_BEACON_BYTES: usize = 8_192;

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PulseConfig {
    /// Whether the service is active.
    #[serde(default)]
    pub enabled: bool,

    /// Overrides the display name. Falls back to "Anonymous" when None.
    #[serde(default)]
    pub display_name: Option<String>,

    /// Include the current game title in outgoing beacons.
    #[serde(default = "def_true")]
    pub share_game: bool,

    /// Include the game cover URL in outgoing beacons.
    #[serde(default = "def_true")]
    pub share_cover: bool,

    /// Shared secret — only peers with the same key are shown.
    /// Empty string = open room (all Libmaly instances on the LAN).
    #[serde(default)]
    pub room_key: String,

    /// UDP broadcast port for LAN discovery.
    #[serde(default = "def_port")]
    pub lan_port: u16,

    /// Enable LAN UDP broadcast/discovery.
    #[serde(default = "def_true")]
    pub lan_enabled: bool,

    /// Optional HTTP relay base URL, e.g. "https://my-relay.example.com".
    /// When set, beacons are also POSTed to the relay and peers are polled from it.
    #[serde(default)]
    pub relay_url: Option<String>,
}

fn def_true() -> bool {
    true
}
fn def_port() -> u16 {
    DEFAULT_LAN_PORT
}

impl Default for PulseConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            display_name: None,
            share_game: true,
            share_cover: true,
            room_key: String::new(),
            lan_port: DEFAULT_LAN_PORT,
            lan_enabled: true,
            relay_url: None,
        }
    }
}

// ── Wire format ───────────────────────────────────────────────────────────────

/// A beacon transmitted over the wire (LAN UDP or relay HTTP body).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PulseBeacon {
    /// Protocol version — currently 1.
    pub v: u8,
    /// Stable peer identifier (random, generated once per installation).
    pub peer_id: String,
    /// Human-readable display name.
    pub display_name: String,
    /// Optional avatar image URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    /// Room key — used for filtering.
    pub room: String,
    /// Current gaming activity (None = online but not in a game).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<GameActivity>,
    /// True in the final beacon sent when going offline (clean disconnect).
    #[serde(default)]
    pub offline: bool,
    /// Unix timestamp (seconds) when this beacon was built.
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameActivity {
    /// Game title or executable stem.
    pub title: String,
    /// Cover art URL (optional, honoured only when share_cover is true).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    /// Unix timestamp (seconds) of when the session started.
    pub session_start: u64,
}

// ── Frontend-facing peer record ────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub peer_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub activity: Option<GameActivity>,
    /// Unix timestamp (seconds) of the last received beacon.
    pub last_seen: u64,
    /// Whether this record came from the relay (vs. LAN).
    pub via_relay: bool,
}

// ── Global mutable state ───────────────────────────────────────────────────────

/// Current game activity set by the launch lifecycle hooks.
static ACTIVITY: OnceLock<Arc<Mutex<Option<GameActivity>>>> = OnceLock::new();
fn activity() -> &'static Arc<Mutex<Option<GameActivity>>> {
    ACTIVITY.get_or_init(|| Arc::new(Mutex::new(None)))
}

/// Live peer map: peer_id → PeerInfo.
static PEERS: OnceLock<Arc<Mutex<HashMap<String, PeerInfo>>>> = OnceLock::new();
fn peers() -> &'static Arc<Mutex<HashMap<String, PeerInfo>>> {
    PEERS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// Stop flag for the current Pulse session.  Threads check this before looping.
static STOP_FLAG: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
fn stop_flag_cell() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    STOP_FLAG.get_or_init(|| Mutex::new(None))
}

/// Condvar used to wake broadcast/relay threads for an early broadcast
/// (game start/stop) or for shutdown.
static WAKE_MUTEX: OnceLock<Arc<Mutex<bool>>> = OnceLock::new();
static WAKE_CV: OnceLock<Arc<std::sync::Condvar>> = OnceLock::new();

fn wake() -> (&'static Arc<Mutex<bool>>, &'static Arc<std::sync::Condvar>) {
    let m = WAKE_MUTEX.get_or_init(|| Arc::new(Mutex::new(false)));
    let cv = WAKE_CV.get_or_init(|| Arc::new(std::sync::Condvar::new()));
    (m, cv)
}

fn signal_wake() {
    let (m, cv) = wake();
    *m.lock().unwrap() = true;
    cv.notify_all();
}

/// Block until `timeout` elapses, the condvar is signalled, or `stop` is set.
/// Returns `false` if the caller should exit (stop requested).
fn wait_or_timeout(stop: &AtomicBool, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    let (m, cv) = wake();
    let mut flag = m.lock().unwrap();
    loop {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        if *flag {
            *flag = false;
            return true;
        } // triggered early
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return true;
        } // timed out normally
        let (new_flag, _) = cv.wait_timeout(flag, remaining).unwrap();
        flag = new_flag;
    }
}

// ── Config & peer-ID persistence ──────────────────────────────────────────────

pub fn load_config() -> PulseConfig {
    let path = app_data_root().join(CONFIG_FILE);
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn persist_config(cfg: &PulseConfig) -> Result<(), String> {
    let dir = app_data_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(CONFIG_FILE), raw).map_err(|e| e.to_string())
}

pub fn load_or_create_peer_id() -> String {
    let path = app_data_root().join(PEER_ID_FILE);
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim().to_owned();
        if !id.is_empty() {
            return id;
        }
    }
    use rand::Rng;
    let id: String = rand::thread_rng()
        .sample_iter(rand::distributions::Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    let _ = std::fs::create_dir_all(app_data_root());
    let _ = std::fs::write(&path, &id);
    id
}

// ── Beacon construction ───────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn build_beacon(cfg: &PulseConfig, peer_id: &str, offline: bool) -> PulseBeacon {
    let activity = if offline || !cfg.share_game {
        None
    } else {
        let mut act = activity().lock().unwrap().clone();
        if let Some(ref mut a) = act {
            if !cfg.share_cover {
                a.cover_url = None;
            }
        }
        act
    };
    PulseBeacon {
        v: 1,
        peer_id: peer_id.to_owned(),
        display_name: cfg
            .display_name
            .clone()
            .unwrap_or_else(|| "Anonymous".into()),
        avatar_url: None, // future: read from profile storage
        room: cfg.room_key.clone(),
        activity,
        offline,
        ts: now_secs(),
    }
}

// ── Beacon processing ──────────────────────────────────────────────────────────

fn process_beacon(beacon: PulseBeacon, via_relay: bool, app: &AppHandle, my_id: &str, room: &str) {
    // Drop beacons from ourselves or a different room
    if beacon.peer_id == my_id || beacon.room != room {
        return;
    }
    let mut map = peers().lock().unwrap();
    if beacon.offline {
        map.remove(&beacon.peer_id);
    } else {
        map.insert(
            beacon.peer_id.clone(),
            PeerInfo {
                peer_id: beacon.peer_id,
                display_name: beacon.display_name,
                avatar_url: beacon.avatar_url,
                activity: beacon.activity,
                last_seen: now_secs(),
                via_relay,
            },
        );
    }
    let snapshot: Vec<PeerInfo> = map.values().cloned().collect();
    drop(map);
    let _ = app.emit("pulse-peers-updated", &snapshot);

    // Feed into the social provider registry so the unified peer list stays in sync
    let social_records: Vec<crate::social_providers::SocialPeerRecord> = snapshot
        .iter()
        .map(|p| crate::social_providers::SocialPeerRecord {
            provider_id: crate::social_providers::PROVIDER_PULSE.to_owned(),
            provider_peer_id: p.peer_id.clone(),
            display_name: p.display_name.clone(),
            avatar_url: p.avatar_url.clone(),
            activity: p
                .activity
                .as_ref()
                .map(|a| crate::social_providers::SocialActivity {
                    title: a.title.clone(),
                    cover_url: a.cover_url.clone(),
                    session_start: Some(a.session_start),
                    status_text: None,
                }),
            last_seen: p.last_seen,
            online: true,
        })
        .collect();
    crate::social_providers::submit_peers(crate::social_providers::PROVIDER_PULSE, social_records);
}

// ── URL encoding helper ────────────────────────────────────────────────────────

fn url_encode(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') {
                vec![c]
            } else {
                format!("%{:02X}", c as u32).chars().collect::<Vec<_>>()
            }
        })
        .collect()
}

// ── LAN broadcast thread ──────────────────────────────────────────────────────

fn lan_broadcast_thread(cfg: PulseConfig, peer_id: String, stop: Arc<AtomicBool>) {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[pulse] broadcast bind failed: {e}");
            return;
        }
    };
    let _ = socket.set_broadcast(true);
    let addr = format!("255.255.255.255:{}", cfg.lan_port);

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        send_lan_beacon(&socket, &addr, &cfg, &peer_id, false);
        if !wait_or_timeout(&stop, BROADCAST_INTERVAL) {
            break;
        }
    }
    // Offline beacon on clean exit
    send_lan_beacon(&socket, &addr, &cfg, &peer_id, true);
}

fn send_lan_beacon(
    socket: &UdpSocket,
    addr: &str,
    cfg: &PulseConfig,
    peer_id: &str,
    offline: bool,
) {
    let beacon = build_beacon(cfg, peer_id, offline);
    if let Ok(json) = serde_json::to_string(&beacon) {
        let _ = socket.send_to(json.as_bytes(), addr);
    }
}

// ── LAN receive thread ─────────────────────────────────────────────────────────

fn lan_receive_thread(
    port: u16,
    peer_id: String,
    room_key: String,
    stop: Arc<AtomicBool>,
    app: AppHandle,
) {
    let socket = match UdpSocket::bind(format!("0.0.0.0:{}", port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[pulse] receive bind on port {port} failed: {e}");
            return;
        }
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));

    let mut buf = vec![0u8; MAX_BEACON_BYTES];
    while !stop.load(Ordering::Relaxed) {
        match socket.recv_from(&mut buf) {
            Ok((len, _src)) => {
                if let Ok(beacon) = serde_json::from_slice::<PulseBeacon>(&buf[..len]) {
                    process_beacon(beacon, false, &app, &peer_id, &room_key);
                }
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => eprintln!("[pulse] receive error: {e}"),
        }
    }
}

// ── Relay thread ───────────────────────────────────────────────────────────────
// Uses a per-thread tokio current-thread runtime so we can use async reqwest
// without needing the reqwest/blocking feature.

fn relay_thread(cfg: PulseConfig, peer_id: String, stop: Arc<AtomicBool>, app: AppHandle) {
    let relay_url = match &cfg.relay_url {
        Some(u) => u.trim_end_matches('/').to_owned(),
        None => return,
    };

    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[pulse] relay runtime init failed: {e}");
            return;
        }
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap_or_default();

    let room_seg = url_encode(&cfg.room_key);

    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }

        // POST our beacon
        let beacon = build_beacon(&cfg, &peer_id, false);
        if let Ok(json) = serde_json::to_string(&beacon) {
            let post_url = format!("{}/pulse/{}/beacon", relay_url, room_seg);
            let fut = client
                .post(&post_url)
                .header("Content-Type", "application/json")
                .body(json)
                .send();
            let _ = rt.block_on(fut);
        }

        // GET peers
        let since = now_secs().saturating_sub(BROADCAST_INTERVAL.as_secs() * 3);
        let get_url = format!(
            "{}/pulse/{}/peers?since={}&me={}",
            relay_url, room_seg, since, peer_id
        );
        if let Ok(resp) = rt.block_on(client.get(&get_url).send()) {
            if let Ok(body) = rt.block_on(resp.text()) {
                if let Ok(beacons) = serde_json::from_str::<Vec<PulseBeacon>>(&body) {
                    for b in beacons {
                        process_beacon(b, true, &app, &peer_id, &cfg.room_key);
                    }
                }
            }
        }

        if !wait_or_timeout(&stop, BROADCAST_INTERVAL) {
            break;
        }
    }

    // Send offline beacon to relay on clean exit
    let offline_beacon = build_beacon(&cfg, &peer_id, true);
    if let Ok(json) = serde_json::to_string(&offline_beacon) {
        let post_url = format!("{}/pulse/{}/beacon", relay_url, room_seg);
        let fut = client
            .post(&post_url)
            .header("Content-Type", "application/json")
            .body(json)
            .send();
        let _ = rt.block_on(fut);
    }
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

/// Start the Pulse service.  If already running, stops the previous session first.
pub fn start(app: AppHandle, cfg: &PulseConfig) -> Result<(), String> {
    // Signal old session threads to exit
    {
        let mut guard = stop_flag_cell().lock().unwrap();
        if let Some(old) = guard.take() {
            old.store(true, Ordering::SeqCst);
            signal_wake(); // wake sleeping threads immediately
        }
    }

    // Small yield to let old threads see the stop signal before we rebind the port
    std::thread::sleep(Duration::from_millis(50));

    let stop = Arc::new(AtomicBool::new(false));
    *stop_flag_cell().lock().unwrap() = Some(stop.clone());

    let peer_id = load_or_create_peer_id();
    let cfg = cfg.clone();

    // LAN broadcast thread
    if cfg.lan_enabled {
        let c = cfg.clone();
        let id = peer_id.clone();
        let s = stop.clone();
        std::thread::Builder::new()
            .name("pulse-broadcast".into())
            .spawn(move || lan_broadcast_thread(c, id, s))
            .map_err(|e| e.to_string())?;

        // LAN receive thread
        let id2 = peer_id.clone();
        let room = cfg.room_key.clone();
        let port = cfg.lan_port;
        let s2 = stop.clone();
        let a = app.clone();
        std::thread::Builder::new()
            .name("pulse-receive".into())
            .spawn(move || lan_receive_thread(port, id2, room, s2, a))
            .map_err(|e| e.to_string())?;
    }

    // Relay thread (only when relay_url is configured)
    if cfg.relay_url.is_some() {
        let c = cfg.clone();
        let id = peer_id.clone();
        let s = stop.clone();
        let a = app.clone();
        std::thread::Builder::new()
            .name("pulse-relay".into())
            .spawn(move || relay_thread(c, id, s, a))
            .map_err(|e| e.to_string())?;
    }

    // Auto-probe relay capabilities in the background so the UI can adjust
    // feature availability immediately after the service starts.
    if let Some(ref relay_url) = cfg.relay_url {
        probe_relay_and_emit(app.clone(), relay_url.clone());
    }

    Ok(())
}

/// Stop the Pulse service gracefully.
pub fn stop() {
    if let Some(flag) = stop_flag_cell().lock().unwrap().as_ref() {
        flag.store(true, Ordering::SeqCst);
    }
    signal_wake();
    // Clear peer list
    peers().lock().unwrap().clear();
}

// ── Game lifecycle hooks (called from lib.rs) ─────────────────────────────────

/// Call when a game session starts.
pub fn on_game_started(exe: &str, title: Option<String>) {
    let game_title = title.unwrap_or_else(|| {
        std::path::Path::new(exe)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| exe.to_owned())
    });
    *activity().lock().unwrap() = Some(GameActivity {
        title: game_title,
        cover_url: None,
        session_start: now_secs(),
    });
    signal_wake();
}

/// Call when the game session ends.
pub fn on_game_stopped() {
    *activity().lock().unwrap() = None;
    signal_wake();
}

/// Update the cover URL once it is known (called from the frontend via command).
pub fn set_cover_url(url: Option<String>) {
    let mut act = activity().lock().unwrap();
    if let Some(ref mut a) = *act {
        a.cover_url = url;
    }
}

// ── Relay capability negotiation ──────────────────────────────────────────────
//
// Any relay — official or fan-made — can optionally expose:
//
//   GET /pulse/capabilities
//
// which returns a `RelayCapabilities` JSON object (see struct below).
// If the endpoint is absent (HTTP 404) or the relay is unreachable, Libmaly
// gracefully falls back to the baseline protocol (POST beacon + GET peers)
// with NO features withheld.  There is intentionally no whitelist of "allowed"
// relay URLs.  Every relay that implements the protocol is treated as a
// first-class participant.
//
// Baseline features (always assumed regardless of capabilities response):
//   "beacon"  → POST /pulse/{room}/beacon
//   "peers"   → GET  /pulse/{room}/peers?since=…

/// Capabilities that a relay may advertise.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RelayCapabilities {
    /// Human-readable relay name (e.g. "My Community Relay").
    #[serde(default)]
    pub name: Option<String>,

    /// Relay software version string (e.g. "1.2.0").
    #[serde(default)]
    pub version: Option<String>,

    /// Feature tokens supported by this relay.
    ///
    /// Baseline (always included after probing): `["beacon", "peers"]`.
    ///
    /// Optional tokens a relay may add:
    ///   - `"chat"`             — POST/GET /pulse/{room}/chat
    ///   - `"profiles"`         — GET /pulse/profile/{peer_id}
    ///   - `"trending"`         — GET /pulse/trending
    ///   - `"presence_events"`  — Server-Sent Events / WebSocket push
    ///   - `"avatar_upload"`    — POST /pulse/profile/avatar
    ///
    /// Libmaly uses these tokens to show available features in the UI.
    /// A missing token NEVER hides or disables existing functionality.
    #[serde(default)]
    pub features: Vec<String>,

    /// Seconds after which the relay expires an unseen beacon (informational).
    #[serde(default)]
    pub beacon_ttl_secs: Option<u64>,

    /// Max peers per room supported by this relay (informational, None = unknown).
    #[serde(default)]
    pub max_room_peers: Option<u64>,

    /// Human-readable relay description or motd.
    #[serde(default)]
    pub description: Option<String>,

    /// URL of the relay's source code or documentation.
    #[serde(default)]
    pub source_url: Option<String>,

    /// HTTP status code returned during the last probe.
    ///   200 → replied with capabilities JSON
    ///   404 → no /capabilities endpoint (baseline-only relay, fully supported)
    ///   0   → unreachable / timeout
    ///   other → relay replied with unexpected status
    #[serde(default)]
    pub probe_status: u16,
}

impl Default for RelayCapabilities {
    fn default() -> Self {
        Self {
            name: None,
            version: None,
            features: vec!["beacon".into(), "peers".into()],
            beacon_ttl_secs: None,
            max_room_peers: None,
            description: None,
            source_url: None,
            probe_status: 0,
        }
    }
}

/// In-memory cache: relay URL → last probed RelayCapabilities.
static RELAY_CAPS_CACHE: OnceLock<Arc<Mutex<HashMap<String, RelayCapabilities>>>> = OnceLock::new();
fn relay_caps_cache() -> &'static Arc<Mutex<HashMap<String, RelayCapabilities>>> {
    RELAY_CAPS_CACHE.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn ensure_baseline(caps: &mut RelayCapabilities) {
    for feature in &["beacon", "peers"] {
        if !caps.features.iter().any(|f| f == feature) {
            caps.features.push(feature.to_string());
        }
    }
}

/// Core async probe — shared by the Tauri command and the background auto-probe.
/// Returns a valid `RelayCapabilities` regardless of reachability.
async fn probe_relay_url(url: &str) -> RelayCapabilities {
    let caps_url = format!("{}/pulse/capabilities", url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return RelayCapabilities::default(),
    };
    match client.get(&caps_url).send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if resp.status().is_success() {
                match resp.json::<RelayCapabilities>().await {
                    Ok(mut caps) => {
                        caps.probe_status = status;
                        ensure_baseline(&mut caps);
                        caps
                    }
                    Err(_) => RelayCapabilities {
                        probe_status: status,
                        ..Default::default()
                    },
                }
            } else {
                RelayCapabilities {
                    probe_status: status,
                    ..Default::default()
                }
            }
        }
        Err(_) => RelayCapabilities {
            probe_status: 0,
            ..Default::default()
        },
    }
}

/// Probe a relay in a background thread, cache the result, and emit
/// `"relay-caps-updated"` so the frontend can react immediately.
/// Safe to call from sync contexts (spawns its own thread + mini-runtime).
pub fn probe_relay_and_emit(app: AppHandle, url: String) {
    std::thread::Builder::new()
        .name("pulse-caps-probe".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("pulse caps probe rt");
            let caps = rt.block_on(probe_relay_url(&url));
            relay_caps_cache().lock().unwrap().insert(url, caps.clone());
            let _ = app.emit("relay-caps-updated", caps);
        })
        .ok();
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Probe a relay's `/pulse/capabilities` endpoint.
///
/// Always returns a valid `RelayCapabilities` — if the relay is unreachable or
/// doesn't implement the endpoint, the baseline is returned with `probe_status`
/// reflecting what happened.  No features are withheld based on the relay URL.
/// Emits `"relay-caps-updated"` so the UI updates reactively.
#[tauri::command]
pub async fn pulse_probe_relay(app: tauri::AppHandle, url: String) -> RelayCapabilities {
    let caps = probe_relay_url(&url).await;
    relay_caps_cache().lock().unwrap().insert(url, caps.clone());
    let _ = app.emit("relay-caps-updated", caps.clone());
    caps
}

/// Return the last cached capabilities for the **currently configured** relay.
/// Returns `None` when no relay is configured or when it has not been probed yet.
#[tauri::command]
pub fn pulse_get_active_relay_caps() -> Option<RelayCapabilities> {
    let cfg = load_config();
    cfg.relay_url
        .as_deref()
        .and_then(|url| relay_caps_cache().lock().unwrap().get(url).cloned())
}

/// Return the last cached capabilities for a relay URL without re-probing.
/// Returns `None` if the relay has never been probed in this session.
#[tauri::command]
pub fn pulse_get_relay_caps(url: String) -> Option<RelayCapabilities> {
    relay_caps_cache().lock().unwrap().get(&url).cloned()
}

#[tauri::command]
pub fn pulse_get_config() -> PulseConfig {
    load_config()
}

#[tauri::command]
pub fn pulse_save_config(config: PulseConfig) -> Result<(), String> {
    persist_config(&config)
}

#[tauri::command]
pub fn pulse_get_peers() -> Vec<PeerInfo> {
    let mut map = peers().lock().unwrap();
    let now = now_secs();
    map.retain(|_, p| {
        let expiry = if p.via_relay {
            PEER_EXPIRY_RELAY
        } else {
            PEER_EXPIRY_LAN
        };
        now.saturating_sub(p.last_seen) < expiry
    });
    map.values().cloned().collect()
}

#[tauri::command]
pub fn pulse_start_service(app: tauri::AppHandle) -> Result<(), String> {
    let cfg = load_config();
    if !cfg.enabled {
        return Err("Pulse is disabled in settings.".into());
    }
    start(app, &cfg)
}

#[tauri::command]
pub fn pulse_stop_service() {
    stop();
}

#[tauri::command]
pub fn pulse_get_peer_id() -> String {
    load_or_create_peer_id()
}

/// Update the cover URL for the active session from the frontend.
/// Call this after `game-started` once metadata is resolved.
#[tauri::command]
pub fn pulse_set_cover(cover_url: Option<String>) {
    set_cover_url(cover_url);
}
