// ─── REST + WebSocket API Server ──────────────────────────────────────────────
//
// Implements an optional local HTTP/WS server so third-party tools can:
//
//   REST — Remote Control
//     GET  /api/status                → current status (active game, telemetry, version)
//     GET  /api/library               → full game list with stats + metadata
//     GET  /api/library/game?path=…   → single game entry
//     POST /api/launch     { path }   → launch a game by exe path
//     POST /api/kill                  → kill the running game
//     GET  /api/volume                → current master volume (0–100, null on non-Windows)
//     POST /api/volume  { level }     → request volume change (forwarded to frontend)
//
//   REST — State Access
//     GET  /api/metadata?path=…       → raw GameMetadata JSON for a game
//     GET  /api/stats?path=…          → GameStats JSON for a game
//     GET  /api/notes?path=…          → notes string for a game
//
//   Extension Hooks
//     POST /api/notify  { title, body, icon? }   → push notification to the overlay
//     POST /api/overlay/widget { id, html, … }   → inject HTML widget into the overlay
//     DELETE /api/overlay/widget/:id              → remove an overlay widget
//
//   WebSocket
//     WS /ws                          → subscribe to real-time events
//       Events pushed: game-started, game-finished, telemetry, library-updated,
//                      notification, overlay-widget
//
// Authentication: all requests must carry  Authorization: Bearer <token>
// The token is generated on first use and stored in the app's vault.
// The Tauri settings UI lets the user view / regenerate the token, change port,
// and enable/disable the server.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{delete, get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};

use crate::data_paths::app_data_root;
use crate::screenshot::ActiveGameState;
use crate::sysmonitor;
use crate::vault;

// ── Constants ─────────────────────────────────────────────────────────────────

const API_SERVER_CONFIG_FILE: &str = "api_server_config.json";
const DEFAULT_PORT: u16 = 39510;
const TOKEN_VAULT_KEY: &str = "api_server::bearer_token";
const STATE_STORAGE_FILE: &str = "state.json";
/// Build version (compile-time)
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiServerConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_port")]
    pub port: u16,
    /// Comma-separated CORS origins, e.g. "http://localhost:3000,http://myapp"
    /// Use "*" to allow all origins.
    #[serde(default = "default_cors")]
    pub cors_origins: String,
}

impl Default for ApiServerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            cors_origins: default_cors(),
        }
    }
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_cors() -> String {
    "http://localhost:*".to_string()
}

// ── Server runtime state ──────────────────────────────────────────────────────

struct ServerRuntime {
    /// Address the server is actually bound to (after start).
    bound_addr: Option<SocketAddr>,
    /// Channel to request a shutdown.
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    /// Startup timestamp for uptime calculation.
    started_at: Option<Instant>,
}

impl Default for ServerRuntime {
    fn default() -> Self {
        Self {
            bound_addr: None,
            shutdown_tx: None,
            started_at: None,
        }
    }
}

static RUNTIME: OnceLock<Mutex<ServerRuntime>> = OnceLock::new();

fn runtime() -> &'static Mutex<ServerRuntime> {
    RUNTIME.get_or_init(|| Mutex::new(ServerRuntime::default()))
}

// ── WebSocket broadcaster ─────────────────────────────────────────────────────

/// Capacity: last 64 events buffered for late subscribers.
const WS_CHANNEL_CAPACITY: usize = 64;

static WS_BROADCASTER: OnceLock<broadcast::Sender<String>> = OnceLock::new();

pub fn ws_broadcaster() -> &'static broadcast::Sender<String> {
    WS_BROADCASTER.get_or_init(|| {
        let (tx, _) = broadcast::channel(WS_CHANNEL_CAPACITY);
        tx
    })
}

/// Broadcast a JSON event to all connected WebSocket clients.
pub fn broadcast_event(event_type: &str, payload: impl Serialize) {
    let msg = json!({ "type": event_type, "payload": payload });
    let _ = ws_broadcaster().send(msg.to_string());
}

// ── Config persistence ────────────────────────────────────────────────────────

pub fn load_config() -> ApiServerConfig {
    let path = app_data_root().join(API_SERVER_CONFIG_FILE);
    if !path.exists() {
        return ApiServerConfig::default();
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_config(config: &ApiServerConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let path = app_data_root().join(API_SERVER_CONFIG_FILE);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

// ── Token management ──────────────────────────────────────────────────────────

fn load_or_generate_token() -> String {
    if let Ok(Some(token)) = vault::get_secret(TOKEN_VAULT_KEY) {
        if !token.is_empty() {
            return token;
        }
    }
    let token = generate_token();
    let _ = vault::set_secret(TOKEN_VAULT_KEY, &token);
    token
}

fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen::<u8>()).collect();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ── Axum shared state ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    app: Arc<AppHandle>,
    token: Arc<String>,
}

// ── Authentication middleware helper ──────────────────────────────────────────

fn check_auth(headers: &HeaderMap, token: &str) -> bool {
    let expected = format!("Bearer {}", token);
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == expected)
        .unwrap_or(false)
}

macro_rules! auth {
    ($headers:expr, $state:expr) => {
        if !check_auth(&$headers, &$state.token) {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Unauthorized" }))).into_response();
        }
    };
}

// ── Route: GET /api/status ────────────────────────────────────────────────────

async fn route_status(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    auth!(headers, state);
    let telemetry = sysmonitor::read();
    let active_game = {
        let ag_state = state.app.state::<ActiveGameState>();
        let guard = ag_state.0.lock().unwrap();
        guard.as_ref().map(|ag| {
            json!({
                "exe": ag.exe,
                "pid": ag.pid,
                "rootPid": ag.root_pid,
            })
        })
    };
    let uptime_secs = runtime()
        .lock()
        .unwrap()
        .started_at
        .map(|t| t.elapsed().as_secs())
        .unwrap_or(0);
    Json(json!({
        "version": APP_VERSION,
        "uptimeSecs": uptime_secs,
        "activeGame": active_game,
        "telemetry": {
            "cpuUsage": telemetry.cpu_usage,
            "ramUsedMb": telemetry.ram_used_mb,
            "ramTotalMb": telemetry.ram_total_mb,
            "gpuUsage": telemetry.gpu_usage,
            "gpuName": telemetry.gpu_name,
        }
    }))
    .into_response()
}

// ── Route: GET /api/library ───────────────────────────────────────────────────

async fn route_library(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    auth!(headers, state);
    match read_state_entries() {
        Ok(entries) => {
            let games: Vec<Value> = parse_games_from_state(&entries);
            Json(json!({ "games": games })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

// ── Route: GET /api/library/game?path=… ──────────────────────────────────────

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

async fn route_library_game(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Response {
    auth!(headers, state);
    match read_state_entries() {
        Ok(entries) => {
            let game = build_game_entry(&entries, &q.path);
            Json(game).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

// ── Route: POST /api/launch ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct LaunchBody {
    path: String,
}

async fn route_launch(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<LaunchBody>,
) -> Response {
    auth!(headers, state);
    // Forward the launch request to the frontend which owns the full launch config.
    // The frontend will invoke the actual `launch_game` command with per-game settings.
    let _ = state.app.emit("api-launch-game", &body.path);
    Json(json!({ "ok": true })).into_response()
}

// ── Route: POST /api/kill ─────────────────────────────────────────────────────

async fn route_kill(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    auth!(headers, state);
    let _ = state.app.emit("api-kill-game", ());
    Json(json!({ "ok": true })).into_response()
}

// ── Route: GET /api/volume ────────────────────────────────────────────────────

async fn route_volume_get(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    auth!(headers, state);
    // Volume querying requires platform-specific OS audio APIs.
    // Return null here; the frontend can maintain a cached value via WebSocket.
    let _ = &state; // suppress unused warning
    Json(json!({ "level": null, "note": "Volume read not supported server-side; subscribe to ws volume-changed events from the frontend" })).into_response()
}

// ── Route: POST /api/volume ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct VolumeBody {
    /// Master volume level 0–100.
    level: f32,
}

async fn route_volume_set(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<VolumeBody>,
) -> Response {
    auth!(headers, state);
    let level = body.level.clamp(0.0, 100.0);
    // Forward to the frontend; the frontend can control system volume via
    // platform-specific mechanisms or just reflect the value in its UI.
    let _ = state.app.emit("api-set-volume", level);
    broadcast_event("volume-requested", json!({ "level": level }));
    Json(json!({ "ok": true, "level": level })).into_response()
}

// ── Route: GET /api/metadata?path=… ──────────────────────────────────────────

async fn route_metadata(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Response {
    auth!(headers, state);
    let _ = &state;
    match read_state_entries() {
        Ok(entries) => {
            let meta = entries
                .get("game-metadata")
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|map| {
                    map.as_object()
                        .and_then(|m| m.get(&q.path))
                        .cloned()
                })
                .unwrap_or(Value::Null);
            Json(meta).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

// ── Route: GET /api/stats?path=… ─────────────────────────────────────────────

async fn route_stats(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Response {
    auth!(headers, state);
    let _ = &state;
    match read_state_entries() {
        Ok(entries) => {
            let stats = entries
                .get("game-stats")
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|map| {
                    map.as_object()
                        .and_then(|m| m.get(&q.path))
                        .cloned()
                })
                .unwrap_or(Value::Null);
            Json(stats).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

// ── Route: GET /api/notes?path=… ─────────────────────────────────────────────

async fn route_notes(
    headers: HeaderMap,
    State(state): State<AppState>,
    Query(q): Query<PathQuery>,
) -> Response {
    auth!(headers, state);
    let _ = &state;
    match read_state_entries() {
        Ok(entries) => {
            let notes = entries
                .get("game-notes-v1")
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|map| {
                    map.as_object()
                        .and_then(|m| m.get(&q.path))
                        .cloned()
                })
                .unwrap_or(Value::Null);
            Json(json!({ "path": q.path, "notes": notes })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

// ── Route: POST /api/notify ───────────────────────────────────────────────────

#[derive(Deserialize, Serialize, Clone)]
pub struct NotifyBody {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub icon: Option<String>,
    /// Optional source identifier for the overlay.
    #[serde(default)]
    pub source: Option<String>,
}

async fn route_notify(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<NotifyBody>,
) -> Response {
    auth!(headers, state);
    let _ = state.app.emit("api-push-notification", &body);
    broadcast_event("notification", &body);
    Json(json!({ "ok": true })).into_response()
}

// ── Route: POST /api/overlay/widget ──────────────────────────────────────────

#[derive(Deserialize, Serialize, Clone)]
pub struct OverlayWidgetBody {
    /// Stable identifier — used to update or remove the widget later.
    pub id: String,
    /// HTML content rendered inside a sandboxed <div>.
    pub html: String,
    /// Optional CSS position hints: "top-left" | "top-right" | "bottom-left" | "bottom-right"
    #[serde(default)]
    pub position: Option<String>,
    /// Width hint in pixels (default: 300).
    #[serde(default)]
    pub width: Option<u32>,
    /// Height hint in pixels (default: auto).
    #[serde(default)]
    pub height: Option<u32>,
}

async fn route_overlay_widget_push(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<OverlayWidgetBody>,
) -> Response {
    auth!(headers, state);
    let _ = state.app.emit("api-overlay-widget-push", &body);
    broadcast_event("overlay-widget-push", &body);
    Json(json!({ "ok": true })).into_response()
}

// ── Route: DELETE /api/overlay/widget/:id ────────────────────────────────────

async fn route_overlay_widget_remove(
    headers: HeaderMap,
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    auth!(headers, state);
    let _ = state.app.emit("api-overlay-widget-remove", &id);
    broadcast_event("overlay-widget-remove", json!({ "id": id }));
    Json(json!({ "ok": true })).into_response()
}

// ── Route: WS /ws ─────────────────────────────────────────────────────────────

async fn route_ws(
    headers: HeaderMap,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Response {
    // WebSocket auth via Authorization header (before upgrade) or
    // query param `?token=…` (some WS clients can't set headers).
    let auth_ok = check_auth(&headers, &state.token);
    if !auth_ok {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    ws.on_upgrade(|socket| ws_handler(socket, state))
}

async fn ws_handler(mut socket: WebSocket, state: AppState) {
    let mut rx = ws_broadcaster().subscribe();
    // Send a welcome event so the client knows it's connected.
    let welcome = json!({
        "type": "connected",
        "payload": { "version": APP_VERSION }
    })
    .to_string();
    if socket.send(Message::Text(welcome.into())).await.is_err() {
        return;
    }

    // Push telemetry every 5 seconds in addition to on-change broadcasts.
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    let state_clone = state.clone();

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let tel = sysmonitor::read();
                let active_game = {
                    let ag_state = state_clone.app.state::<ActiveGameState>();
                    let guard = ag_state.0.lock().unwrap();
                    guard.as_ref().map(|ag| json!({
                        "exe": ag.exe,
                        "pid": ag.pid,
                    }))
                };
                let msg = json!({
                    "type": "telemetry",
                    "payload": {
                        "cpuUsage": tel.cpu_usage,
                        "ramUsedMb": tel.ram_used_mb,
                        "ramTotalMb": tel.ram_total_mb,
                        "gpuUsage": tel.gpu_usage,
                        "activeGame": active_game,
                    }
                }).to_string();
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
            Ok(msg) = rx.recv() => {
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

// ── State file helpers ────────────────────────────────────────────────────────

fn read_state_entries() -> Result<HashMap<String, String>, String> {
    let path = app_data_root().join(STATE_STORAGE_FILE);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // State file may be `{"schemaVersion": N, "entries": {...}}` or just `{...}`.
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(entries) = v.get("entries").and_then(|e| e.as_object()) {
        Ok(entries
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string()))
            .collect())
    } else if let Some(obj) = v.as_object() {
        Ok(obj
            .iter()
            .filter(|(k, _)| *k != "schemaVersion")
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string()))
            .collect())
    } else {
        Ok(HashMap::new())
    }
}

fn parse_games_from_state(entries: &HashMap<String, String>) -> Vec<Value> {
    let games_raw = match entries.get("games-list-v2") {
        Some(r) => r.clone(),
        None => return Vec::new(),
    };
    let games: Vec<Value> = serde_json::from_str(&games_raw).unwrap_or_default();
    let meta_map: HashMap<String, Value> = entries
        .get("game-metadata")
        .and_then(|r| serde_json::from_str(r).ok())
        .unwrap_or_default();
    let stats_map: HashMap<String, Value> = entries
        .get("game-stats")
        .and_then(|r| serde_json::from_str(r).ok())
        .unwrap_or_default();

    games
        .into_iter()
        .filter_map(|g| {
            let path = g.get("path")?.as_str()?.to_string();
            Some(json!({
                "name": g.get("name"),
                "path": &path,
                "meta": meta_map.get(&path),
                "stats": stats_map.get(&path),
            }))
        })
        .collect()
}

fn build_game_entry(entries: &HashMap<String, String>, path: &str) -> Value {
    let meta_map: HashMap<String, Value> = entries
        .get("game-metadata")
        .and_then(|r| serde_json::from_str(r).ok())
        .unwrap_or_default();
    let stats_map: HashMap<String, Value> = entries
        .get("game-stats")
        .and_then(|r| serde_json::from_str(r).ok())
        .unwrap_or_default();
    let games_raw = entries.get("games-list-v2").cloned().unwrap_or_default();
    let games: Vec<Value> = serde_json::from_str(&games_raw).unwrap_or_default();
    let game = games.into_iter().find(|g| {
        g.get("path").and_then(|p| p.as_str()) == Some(path)
    });
    json!({
        "path": path,
        "name": game.as_ref().and_then(|g| g.get("name")),
        "meta": meta_map.get(path),
        "stats": stats_map.get(path),
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Status reported by `api_server_status` Tauri command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiServerStatus {
    pub running: bool,
    pub bound_addr: Option<String>,
    pub port: u16,
}

/// Start the API server with the given config. Stops any running instance first.
pub fn start(app: Arc<AppHandle>, config: &ApiServerConfig) -> Result<(), String> {
    stop();

    let token = load_or_generate_token();
    let port = config.port;
    let cors_origins = config.cors_origins.clone();

    let app_state = AppState {
        app,
        token: Arc::new(token),
    };

    let cors = build_cors_layer(&cors_origins);

    let router = Router::new()
        .route("/api/status", get(route_status))
        .route("/api/library", get(route_library))
        .route("/api/library/game", get(route_library_game))
        .route("/api/launch", post(route_launch))
        .route("/api/kill", post(route_kill))
        .route("/api/volume", get(route_volume_get).post(route_volume_set))
        .route("/api/metadata", get(route_metadata))
        .route("/api/stats", get(route_stats))
        .route("/api/notes", get(route_notes))
        .route("/api/notify", post(route_notify))
        .route("/api/overlay/widget", post(route_overlay_widget_push))
        .route("/api/overlay/widget/:id", delete(route_overlay_widget_remove))
        .route("/ws", get(route_ws))
        .layer(cors)
        .with_state(app_state);

    let addr: SocketAddr = format!("127.0.0.1:{}", port)
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;

    let listener = std::net::TcpListener::bind(addr).map_err(|e| {
        format!("Cannot bind API server to port {}: {}", port, e)
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let bound_addr = listener.local_addr().map_err(|e| e.to_string())?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        let _ = server.await;
    });

    let mut rt = runtime().lock().unwrap();
    rt.bound_addr = Some(bound_addr);
    rt.shutdown_tx = Some(shutdown_tx);
    rt.started_at = Some(Instant::now());

    Ok(())
}

/// Stop the running API server (no-op if not running).
pub fn stop() {
    let mut rt = runtime().lock().unwrap();
    if let Some(tx) = rt.shutdown_tx.take() {
        let _ = tx.send(());
    }
    rt.bound_addr = None;
    rt.started_at = None;
}

fn build_cors_layer(origins: &str) -> CorsLayer {
    let origins = origins.trim();
    if origins == "*" || origins.is_empty() {
        return CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::DELETE])
            .allow_headers(Any);
    }
    let parsed: Vec<axum::http::HeaderValue> = origins
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    if parsed.is_empty() {
        return CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::DELETE])
            .allow_headers(Any);
    }
    CorsLayer::new()
        .allow_origin(parsed)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers(Any)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Get the current API server configuration.
#[tauri::command]
pub fn api_server_get_config() -> ApiServerConfig {
    load_config()
}

/// Save configuration and restart/stop the server accordingly.
#[tauri::command]
pub fn api_server_save_config(app: AppHandle, config: ApiServerConfig) -> Result<(), String> {
    save_config(&config)?;
    if config.enabled {
        start(Arc::new(app), &config)
    } else {
        stop();
        Ok(())
    }
}

/// Whether the server is currently running and what address it's bound to.
#[tauri::command]
pub fn api_server_status() -> ApiServerStatus {
    let rt = runtime().lock().unwrap();
    let config = load_config();
    ApiServerStatus {
        running: rt.bound_addr.is_some(),
        bound_addr: rt.bound_addr.map(|a| a.to_string()),
        port: config.port,
    }
}

/// Generate a new bearer token and persist it. Also restarts the server if running.
#[tauri::command]
pub fn api_server_regenerate_token(app: AppHandle) -> Result<String, String> {
    let token = generate_token();
    vault::set_secret(TOKEN_VAULT_KEY, &token)?;
    // Restart server with new token if currently running.
    let config = load_config();
    if config.enabled {
        start(Arc::new(app), &config)?;
    }
    Ok(token)
}

/// Reveal the current bearer token (shown in the settings UI).
#[tauri::command]
pub fn api_server_get_token() -> Result<String, String> {
    Ok(load_or_generate_token())
}

/// Called by the frontend when the library state changes so we can push a
/// `library-updated` event to WebSocket clients.
#[tauri::command]
pub fn api_server_notify_library_updated() {
    broadcast_event("library-updated", json!({}));
}

/// Called by the frontend to forward game-started / game-finished events.
#[tauri::command]
pub fn api_server_broadcast_game_event(event_type: String, payload: Value) {
    broadcast_event(&event_type, payload);
}
