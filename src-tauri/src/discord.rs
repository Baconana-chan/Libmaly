use libloading::Library;
use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const DISCORD_APPLICATION_ID: u64 = 1489308020411465738;

#[repr(C)]
#[derive(Clone, Copy)]
struct Discord_String {
    ptr: *mut u8,
    size: usize,
}

#[repr(C)]
struct Discord_Client {
    opaque: *mut c_void,
}

unsafe impl Send for Discord_Client {}

#[repr(C)]
struct Discord_Activity {
    opaque: *mut c_void,
}

#[repr(C)]
struct Discord_ActivityAssets {
    opaque: *mut c_void,
}

#[repr(C)]
struct Discord_ActivityTimestamps {
    opaque: *mut c_void,
}

#[repr(C)]
struct Discord_ActivitySecrets {
    opaque: *mut c_void,
}

#[repr(C)]
struct Discord_UserHandle {
    opaque: *mut c_void,
}

unsafe impl Send for Discord_UserHandle {}

#[repr(C)]
struct Discord_RelationshipHandle;

#[repr(C)]
struct Discord_RelationshipHandleSpan {
    ptr: *mut Discord_RelationshipHandle,
    size: usize,
}

#[repr(C)]
#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Discord_Client_Status {
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Ready = 3,
    Reconnecting = 4,
    Disconnecting = 5,
    HttpWait = 6,
}

#[repr(C)]
#[allow(dead_code)]
#[derive(Clone, Copy)]
enum Discord_Client_Error {
    None = 0,
    ConnectionFailed = 1,
    UnexpectedClose = 2,
    ConnectionCanceled = 3,
}

#[repr(C)]
#[derive(Clone, Copy)]
enum Discord_ActivityTypes {
    Playing = 0,
}

#[repr(C)]
#[derive(Clone, Copy)]
enum Discord_ActivityGamePlatforms {
    Desktop = 1,
}

#[repr(C)]
#[derive(Clone, Copy)]
enum Discord_RelationshipGroupType {
    OnlinePlayingGame = 0,
    OnlineElsewhere = 1,
    Offline = 2,
}

#[repr(C)]
#[derive(Clone, Copy)]
enum Discord_UserHandle_AvatarType {
    Png = 2,
}

#[repr(C)]
#[allow(dead_code)]
#[derive(Clone, Copy)]
enum Discord_StatusType {
    Online = 0,
    Offline = 1,
    Blocked = 2,
    Idle = 3,
    Dnd = 4,
    Invisible = 5,
    Streaming = 6,
    Unknown = 7,
}

#[allow(non_camel_case_types)]
type Discord_FreeFn = unsafe extern "C" fn(*mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_OnStatusChanged =
    unsafe extern "C" fn(Discord_Client_Status, Discord_Client_Error, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_ActivityJoinCallback = unsafe extern "C" fn(Discord_String, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_RelationshipGroupsUpdatedCallback = unsafe extern "C" fn(u64, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_UserUpdatedCallback = unsafe extern "C" fn(u64, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_IsDiscordAppInstalledCallback = unsafe extern "C" fn(bool, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_UpdateRichPresenceCallback =
    unsafe extern "C" fn(*mut c_void, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_UpdateStatusCallback = unsafe extern "C" fn(*mut c_void, *mut c_void);
#[allow(non_camel_case_types)]
type Discord_Client_OpenConnectedGamesSettingsInDiscordCallback =
    unsafe extern "C" fn(*mut c_void, *mut c_void);

#[derive(Clone, Copy)]
struct DiscordApi {
    run_callbacks: unsafe extern "C" fn(),
    client_init: unsafe extern "C" fn(*mut Discord_Client),
    client_drop: unsafe extern "C" fn(*mut Discord_Client),
    client_set_application_id: unsafe extern "C" fn(*mut Discord_Client, u64),
    client_connect: unsafe extern "C" fn(*mut Discord_Client),
    client_disconnect: unsafe extern "C" fn(*mut Discord_Client),
    client_get_status: unsafe extern "C" fn(*mut Discord_Client) -> Discord_Client_Status,
    client_set_status_changed_callback: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_Client_OnStatusChanged,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_set_activity_join_callback: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_Client_ActivityJoinCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_set_relationship_groups_updated_callback: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_Client_RelationshipGroupsUpdatedCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_set_user_updated_callback: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_Client_UserUpdatedCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_is_discord_app_installed: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_Client_IsDiscordAppInstalledCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_set_game_window_pid: unsafe extern "C" fn(*mut Discord_Client, i32),
    client_register_launch_command:
        unsafe extern "C" fn(*mut Discord_Client, u64, Discord_String) -> bool,
    client_update_rich_presence: unsafe extern "C" fn(
        *mut Discord_Client,
        *mut Discord_Activity,
        Discord_Client_UpdateRichPresenceCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_clear_rich_presence: unsafe extern "C" fn(*mut Discord_Client),
    client_set_online_status: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_StatusType,
        Discord_Client_UpdateStatusCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_open_connected_games_settings: unsafe extern "C" fn(
        *mut Discord_Client,
        Discord_Client_OpenConnectedGamesSettingsInDiscordCallback,
        Option<Discord_FreeFn>,
        *mut c_void,
    ),
    client_get_current_user_v2: unsafe extern "C" fn(*mut Discord_Client, *mut Discord_UserHandle) -> bool,
    client_get_relationships_by_group:
        unsafe extern "C" fn(*mut Discord_Client, Discord_RelationshipGroupType, *mut Discord_RelationshipHandleSpan),
    activity_init: unsafe extern "C" fn(*mut Discord_Activity),
    activity_drop: unsafe extern "C" fn(*mut Discord_Activity),
    activity_set_name: unsafe extern "C" fn(*mut Discord_Activity, Discord_String),
    activity_set_type: unsafe extern "C" fn(*mut Discord_Activity, Discord_ActivityTypes),
    activity_set_state: unsafe extern "C" fn(*mut Discord_Activity, *mut Discord_String),
    activity_set_details: unsafe extern "C" fn(*mut Discord_Activity, *mut Discord_String),
    activity_set_assets: unsafe extern "C" fn(*mut Discord_Activity, *mut Discord_ActivityAssets),
    activity_set_timestamps:
        unsafe extern "C" fn(*mut Discord_Activity, *mut Discord_ActivityTimestamps),
    activity_set_secrets: unsafe extern "C" fn(*mut Discord_Activity, *mut Discord_ActivitySecrets),
    activity_set_supported_platforms:
        unsafe extern "C" fn(*mut Discord_Activity, Discord_ActivityGamePlatforms),
    activity_assets_init: unsafe extern "C" fn(*mut Discord_ActivityAssets),
    activity_assets_drop: unsafe extern "C" fn(*mut Discord_ActivityAssets),
    activity_assets_set_large_image:
        unsafe extern "C" fn(*mut Discord_ActivityAssets, *mut Discord_String),
    activity_assets_set_large_text:
        unsafe extern "C" fn(*mut Discord_ActivityAssets, *mut Discord_String),
    activity_assets_set_large_url:
        unsafe extern "C" fn(*mut Discord_ActivityAssets, *mut Discord_String),
    activity_assets_set_small_image:
        unsafe extern "C" fn(*mut Discord_ActivityAssets, *mut Discord_String),
    activity_assets_set_small_text:
        unsafe extern "C" fn(*mut Discord_ActivityAssets, *mut Discord_String),
    activity_timestamps_init: unsafe extern "C" fn(*mut Discord_ActivityTimestamps),
    activity_timestamps_drop: unsafe extern "C" fn(*mut Discord_ActivityTimestamps),
    activity_timestamps_set_start: unsafe extern "C" fn(*mut Discord_ActivityTimestamps, u64),
    activity_secrets_init: unsafe extern "C" fn(*mut Discord_ActivitySecrets),
    activity_secrets_drop: unsafe extern "C" fn(*mut Discord_ActivitySecrets),
    activity_secrets_set_join: unsafe extern "C" fn(*mut Discord_ActivitySecrets, Discord_String),
    user_handle_drop: unsafe extern "C" fn(*mut Discord_UserHandle),
    user_handle_username: unsafe extern "C" fn(*mut Discord_UserHandle, *mut Discord_String),
    user_handle_display_name: unsafe extern "C" fn(*mut Discord_UserHandle, *mut Discord_String),
    user_handle_global_name: unsafe extern "C" fn(*mut Discord_UserHandle, *mut Discord_String) -> bool,
    user_handle_avatar_url: unsafe extern "C" fn(
        *mut Discord_UserHandle,
        Discord_UserHandle_AvatarType,
        Discord_UserHandle_AvatarType,
        *mut Discord_String,
    ),
    user_handle_id: unsafe extern "C" fn(*mut Discord_UserHandle) -> u64,
    user_handle_status: unsafe extern "C" fn(*mut Discord_UserHandle) -> Discord_StatusType,
}

struct DiscordRuntime {
    _library: Library,
    api: DiscordApi,
    client: Discord_Client,
    sdk_path: String,
    callback_running: AtomicBool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscordUserSnapshot {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub global_name: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscordRelationshipCounts {
    pub online_playing_game: usize,
    pub online_elsewhere: usize,
    pub offline: usize,
    pub total: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscordSdkSnapshot {
    pub available: bool,
    pub initialized: bool,
    pub connected: bool,
    pub ready: bool,
    pub app_installed: Option<bool>,
    pub client_status: String,
    pub launch_registered: bool,
    pub rich_presence_active: bool,
    pub sdk_path: Option<String>,
    pub current_user: Option<DiscordUserSnapshot>,
    pub relationship_counts: DiscordRelationshipCounts,
    pub last_join_secret: Option<String>,
    pub last_error: Option<String>,
}

impl Default for DiscordSdkSnapshot {
    fn default() -> Self {
        Self {
            available: false,
            initialized: false,
            connected: false,
            ready: false,
            app_installed: None,
            client_status: "disconnected".to_string(),
            launch_registered: false,
            rich_presence_active: false,
            sdk_path: None,
            current_user: None,
            relationship_counts: DiscordRelationshipCounts::default(),
            last_join_secret: None,
            last_error: None,
        }
    }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresenceInput {
    pub title: String,
    pub details: Option<String>,
    pub state: Option<String>,
    pub start_timestamp_ms: Option<u64>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub large_url: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
    pub join_secret: Option<String>,
}

static DISCORD_RUNTIME: OnceLock<Mutex<Option<DiscordRuntime>>> = OnceLock::new();
static DISCORD_SNAPSHOT: OnceLock<Mutex<DiscordSdkSnapshot>> = OnceLock::new();
static DISCORD_APP: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
static DISCORD_DIRTY: OnceLock<AtomicBool> = OnceLock::new();

fn runtime_slot() -> &'static Mutex<Option<DiscordRuntime>> {
    DISCORD_RUNTIME.get_or_init(|| Mutex::new(None))
}

fn snapshot_slot() -> &'static Mutex<DiscordSdkSnapshot> {
    DISCORD_SNAPSHOT.get_or_init(|| Mutex::new(DiscordSdkSnapshot::default()))
}

fn app_slot() -> &'static Mutex<Option<AppHandle>> {
    DISCORD_APP.get_or_init(|| Mutex::new(None))
}

fn dirty_flag() -> &'static AtomicBool {
    DISCORD_DIRTY.get_or_init(|| AtomicBool::new(false))
}

fn snapshot_clone() -> DiscordSdkSnapshot {
    snapshot_slot().lock().unwrap().clone()
}

fn set_last_error(message: impl Into<String>) {
    snapshot_slot().lock().unwrap().last_error = Some(message.into());
}

fn clear_last_error() {
    snapshot_slot().lock().unwrap().last_error = None;
}

fn push_discord_log(level: &str, message: impl Into<String>) {
    let message = format!("[Discord] {}", message.into());
    let app = app_slot().lock().unwrap().clone();
    crate::push_rust_log(app.as_ref(), level, message);
}

fn discord_string(value: &str) -> Discord_String {
    Discord_String {
        ptr: value.as_ptr() as *mut u8,
        size: value.len(),
    }
}

fn discord_string_to_rust(value: Discord_String) -> String {
    if value.ptr.is_null() || value.size == 0 {
        return String::new();
    }
    let bytes = unsafe { std::slice::from_raw_parts(value.ptr as *const u8, value.size) };
    String::from_utf8_lossy(bytes).into_owned()
}

fn client_status_label(status: Discord_Client_Status) -> &'static str {
    match status {
        Discord_Client_Status::Disconnected => "disconnected",
        Discord_Client_Status::Connecting => "connecting",
        Discord_Client_Status::Connected => "connected",
        Discord_Client_Status::Ready => "ready",
        Discord_Client_Status::Reconnecting => "reconnecting",
        Discord_Client_Status::Disconnecting => "disconnecting",
        Discord_Client_Status::HttpWait => "http_wait",
    }
}

fn client_error_label(error: Discord_Client_Error) -> &'static str {
    match error {
        Discord_Client_Error::None => "none",
        Discord_Client_Error::ConnectionFailed => "connection_failed",
        Discord_Client_Error::UnexpectedClose => "unexpected_close",
        Discord_Client_Error::ConnectionCanceled => "connection_canceled",
    }
}

fn user_status_label(status: Discord_StatusType) -> &'static str {
    match status {
        Discord_StatusType::Online => "online",
        Discord_StatusType::Offline => "offline",
        Discord_StatusType::Blocked => "blocked",
        Discord_StatusType::Idle => "idle",
        Discord_StatusType::Dnd => "dnd",
        Discord_StatusType::Invisible => "invisible",
        Discord_StatusType::Streaming => "streaming",
        Discord_StatusType::Unknown => "unknown",
    }
}

unsafe extern "C" fn discord_noop_presence_callback(_: *mut c_void, _: *mut c_void) {}
unsafe extern "C" fn discord_noop_status_callback(_: *mut c_void, _: *mut c_void) {}
unsafe extern "C" fn discord_noop_open_settings_callback(_: *mut c_void, _: *mut c_void) {}

unsafe extern "C" fn discord_installed_callback(installed: bool, _: *mut c_void) {
    snapshot_slot().lock().unwrap().app_installed = Some(installed);
}

unsafe extern "C" fn discord_status_changed_callback(
    status: Discord_Client_Status,
    error: Discord_Client_Error,
    _: *mut c_void,
) {
    let status_label = client_status_label(status).to_string();
    let error_label = client_error_label(error).to_string();
    let mut status_log = None::<String>;
    let mut error_log = None::<String>;
    let mut cleared_error_log = false;
    let mut snapshot = snapshot_slot().lock().unwrap();
    let previous_status = snapshot.client_status.clone();
    let previous_error = snapshot.last_error.clone();
    snapshot.client_status = status_label;
    snapshot.connected = matches!(
        status,
        Discord_Client_Status::Connecting
            | Discord_Client_Status::Connected
            | Discord_Client_Status::Ready
            | Discord_Client_Status::Reconnecting
            | Discord_Client_Status::HttpWait
    );
    snapshot.ready = matches!(status, Discord_Client_Status::Ready);
    if snapshot.connected || snapshot.ready || matches!(error, Discord_Client_Error::None) {
        snapshot.last_error = None;
    } else {
        snapshot.last_error = Some(format!("Discord client error: {}", error_label));
    }
    if previous_status != snapshot.client_status {
        status_log = Some(snapshot.client_status.clone());
    }
    if previous_error != snapshot.last_error {
        if let Some(message) = snapshot.last_error.clone() {
            error_log = Some(message);
        } else if previous_error.is_some() {
            cleared_error_log = true;
        }
    }
    dirty_flag().store(true, Ordering::Relaxed);
    drop(snapshot);
    if let Some(next_status) = status_log {
        push_discord_log("info", format!("client status -> {}", next_status));
    }
    if let Some(message) = error_log {
        push_discord_log("warn", message);
    } else if cleared_error_log {
        push_discord_log("info", "client error cleared after reconnect");
    }
}

unsafe extern "C" fn discord_relationship_groups_updated_callback(_: u64, _: *mut c_void) {
    dirty_flag().store(true, Ordering::Relaxed);
}

unsafe extern "C" fn discord_user_updated_callback(_: u64, _: *mut c_void) {
    dirty_flag().store(true, Ordering::Relaxed);
}

unsafe extern "C" fn discord_activity_join_callback(join_secret: Discord_String, _: *mut c_void) {
    let secret = discord_string_to_rust(join_secret);
    {
        let mut snapshot = snapshot_slot().lock().unwrap();
        snapshot.last_join_secret = Some(secret.clone());
    }
    push_discord_log("info", format!("received activity join secret: {}", secret));
    if let Some(app) = app_slot().lock().unwrap().clone() {
        let _ = app.emit("discord-activity-join", &secret);
    }
}

fn load_symbol<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    unsafe {
        lib.get::<T>(name)
            .map(|sym| *sym)
            .map_err(|e| format!("Missing Discord SDK symbol {}: {}", String::from_utf8_lossy(name), e))
    }
}

fn load_api(lib: &Library) -> Result<DiscordApi, String> {
    Ok(DiscordApi {
        run_callbacks: load_symbol(lib, b"Discord_RunCallbacks\0")?,
        client_init: load_symbol(lib, b"Discord_Client_Init\0")?,
        client_drop: load_symbol(lib, b"Discord_Client_Drop\0")?,
        client_set_application_id: load_symbol(lib, b"Discord_Client_SetApplicationId\0")?,
        client_connect: load_symbol(lib, b"Discord_Client_Connect\0")?,
        client_disconnect: load_symbol(lib, b"Discord_Client_Disconnect\0")?,
        client_get_status: load_symbol(lib, b"Discord_Client_GetStatus\0")?,
        client_set_status_changed_callback: load_symbol(lib, b"Discord_Client_SetStatusChangedCallback\0")?,
        client_set_activity_join_callback: load_symbol(lib, b"Discord_Client_SetActivityJoinCallback\0")?,
        client_set_relationship_groups_updated_callback: load_symbol(
            lib,
            b"Discord_Client_SetRelationshipGroupsUpdatedCallback\0",
        )?,
        client_set_user_updated_callback: load_symbol(lib, b"Discord_Client_SetUserUpdatedCallback\0")?,
        client_is_discord_app_installed: load_symbol(lib, b"Discord_Client_IsDiscordAppInstalled\0")?,
        client_set_game_window_pid: load_symbol(lib, b"Discord_Client_SetGameWindowPid\0")?,
        client_register_launch_command: load_symbol(lib, b"Discord_Client_RegisterLaunchCommand\0")?,
        client_update_rich_presence: load_symbol(lib, b"Discord_Client_UpdateRichPresence\0")?,
        client_clear_rich_presence: load_symbol(lib, b"Discord_Client_ClearRichPresence\0")?,
        client_set_online_status: load_symbol(lib, b"Discord_Client_SetOnlineStatus\0")?,
        client_open_connected_games_settings: load_symbol(
            lib,
            b"Discord_Client_OpenConnectedGamesSettingsInDiscord\0",
        )?,
        client_get_current_user_v2: load_symbol(lib, b"Discord_Client_GetCurrentUserV2\0")?,
        client_get_relationships_by_group: load_symbol(lib, b"Discord_Client_GetRelationshipsByGroup\0")?,
        activity_init: load_symbol(lib, b"Discord_Activity_Init\0")?,
        activity_drop: load_symbol(lib, b"Discord_Activity_Drop\0")?,
        activity_set_name: load_symbol(lib, b"Discord_Activity_SetName\0")?,
        activity_set_type: load_symbol(lib, b"Discord_Activity_SetType\0")?,
        activity_set_state: load_symbol(lib, b"Discord_Activity_SetState\0")?,
        activity_set_details: load_symbol(lib, b"Discord_Activity_SetDetails\0")?,
        activity_set_assets: load_symbol(lib, b"Discord_Activity_SetAssets\0")?,
        activity_set_timestamps: load_symbol(lib, b"Discord_Activity_SetTimestamps\0")?,
        activity_set_secrets: load_symbol(lib, b"Discord_Activity_SetSecrets\0")?,
        activity_set_supported_platforms: load_symbol(lib, b"Discord_Activity_SetSupportedPlatforms\0")?,
        activity_assets_init: load_symbol(lib, b"Discord_ActivityAssets_Init\0")?,
        activity_assets_drop: load_symbol(lib, b"Discord_ActivityAssets_Drop\0")?,
        activity_assets_set_large_image: load_symbol(lib, b"Discord_ActivityAssets_SetLargeImage\0")?,
        activity_assets_set_large_text: load_symbol(lib, b"Discord_ActivityAssets_SetLargeText\0")?,
        activity_assets_set_large_url: load_symbol(lib, b"Discord_ActivityAssets_SetLargeUrl\0")?,
        activity_assets_set_small_image: load_symbol(lib, b"Discord_ActivityAssets_SetSmallImage\0")?,
        activity_assets_set_small_text: load_symbol(lib, b"Discord_ActivityAssets_SetSmallText\0")?,
        activity_timestamps_init: load_symbol(lib, b"Discord_ActivityTimestamps_Init\0")?,
        activity_timestamps_drop: load_symbol(lib, b"Discord_ActivityTimestamps_Drop\0")?,
        activity_timestamps_set_start: load_symbol(lib, b"Discord_ActivityTimestamps_SetStart\0")?,
        activity_secrets_init: load_symbol(lib, b"Discord_ActivitySecrets_Init\0")?,
        activity_secrets_drop: load_symbol(lib, b"Discord_ActivitySecrets_Drop\0")?,
        activity_secrets_set_join: load_symbol(lib, b"Discord_ActivitySecrets_SetJoin\0")?,
        user_handle_drop: load_symbol(lib, b"Discord_UserHandle_Drop\0")?,
        user_handle_username: load_symbol(lib, b"Discord_UserHandle_Username\0")?,
        user_handle_display_name: load_symbol(lib, b"Discord_UserHandle_DisplayName\0")?,
        user_handle_global_name: load_symbol(lib, b"Discord_UserHandle_GlobalName\0")?,
        user_handle_avatar_url: load_symbol(lib, b"Discord_UserHandle_AvatarUrl\0")?,
        user_handle_id: load_symbol(lib, b"Discord_UserHandle_Id\0")?,
        user_handle_status: load_symbol(lib, b"Discord_UserHandle_Status\0")?,
    })
}

fn expected_sdk_filename() -> &'static str {
    #[cfg(windows)]
    {
        "discord_partner_sdk.dll"
    }
    #[cfg(target_os = "linux")]
    {
        "libdiscord_partner_sdk.so"
    }
    #[cfg(target_os = "macos")]
    {
        "libdiscord_partner_sdk.dylib"
    }
}

fn fallback_sdk_path() -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from("third_party/discord_social_sdk/bin/release/discord_partner_sdk.dll")
    }
    #[cfg(target_os = "linux")]
    {
        PathBuf::from("third_party/discord_social_sdk/lib/release/libdiscord_partner_sdk.so")
    }
    #[cfg(target_os = "macos")]
    {
        PathBuf::from("third_party/discord_social_sdk/lib/release/libdiscord_partner_sdk.dylib")
    }
}

fn find_in_dir(root: &Path, filename: &str) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }
    WalkDir::new(root)
        .max_depth(6)
        .into_iter()
        .filter_map(|e| e.ok())
        .find(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .file_name()
                    .map(|name| name.to_string_lossy().eq_ignore_ascii_case(filename))
                    .unwrap_or(false)
        })
        .map(|entry| entry.path().to_path_buf())
}

fn locate_sdk_library(app: &AppHandle) -> Option<PathBuf> {
    let filename = expected_sdk_filename();
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(found) = find_in_dir(&resource_dir, filename) {
            return Some(found);
        }
    }
    let fallback = fallback_sdk_path();
    if fallback.exists() {
        return Some(fallback);
    }
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(found) = find_in_dir(&cwd.join("third_party/discord_social_sdk"), filename) {
            return Some(found);
        }
    }
    None
}

fn refresh_snapshot_from_runtime(runtime: &DiscordRuntime) {
    let api = runtime.api;
    let client = &runtime.client as *const Discord_Client as *mut Discord_Client;
    let status = unsafe { (api.client_get_status)(client) };
    let mut snapshot = snapshot_slot().lock().unwrap();
    snapshot.available = true;
    snapshot.initialized = true;
    snapshot.sdk_path = Some(runtime.sdk_path.clone());
    snapshot.client_status = client_status_label(status).to_string();
    snapshot.connected = matches!(
        status,
        Discord_Client_Status::Connecting
            | Discord_Client_Status::Connected
            | Discord_Client_Status::Ready
            | Discord_Client_Status::Reconnecting
            | Discord_Client_Status::HttpWait
    );
    snapshot.ready = matches!(status, Discord_Client_Status::Ready);
    if snapshot.connected || snapshot.ready {
        snapshot.last_error = None;
    }

    if snapshot.ready {
        let mut user = Discord_UserHandle { opaque: null_mut() };
        if unsafe { (api.client_get_current_user_v2)(client, &mut user) } {
            let mut username = Discord_String { ptr: null_mut(), size: 0 };
            let mut display_name = Discord_String { ptr: null_mut(), size: 0 };
            let mut global_name = Discord_String { ptr: null_mut(), size: 0 };
            let mut avatar_url = Discord_String { ptr: null_mut(), size: 0 };
            unsafe {
                (api.user_handle_username)(&mut user, &mut username);
                (api.user_handle_display_name)(&mut user, &mut display_name);
            }
            let has_global = unsafe { (api.user_handle_global_name)(&mut user, &mut global_name) };
            unsafe {
                (api.user_handle_avatar_url)(
                    &mut user,
                    Discord_UserHandle_AvatarType::Png,
                    Discord_UserHandle_AvatarType::Png,
                    &mut avatar_url,
                );
            }
            snapshot.current_user = Some(DiscordUserSnapshot {
                id: unsafe { (api.user_handle_id)(&mut user) }.to_string(),
                username: discord_string_to_rust(username),
                display_name: discord_string_to_rust(display_name),
                global_name: if has_global {
                    let value = discord_string_to_rust(global_name);
                    if value.is_empty() { None } else { Some(value) }
                } else {
                    None
                },
                avatar_url: {
                    let value = discord_string_to_rust(avatar_url);
                    if value.is_empty() { None } else { Some(value) }
                },
                status: user_status_label(unsafe { (api.user_handle_status)(&mut user) }).to_string(),
            });
            unsafe { (api.user_handle_drop)(&mut user) };
        } else {
            snapshot.current_user = None;
        }

        let mut playing = Discord_RelationshipHandleSpan { ptr: null_mut(), size: 0 };
        let mut elsewhere = Discord_RelationshipHandleSpan { ptr: null_mut(), size: 0 };
        let mut offline = Discord_RelationshipHandleSpan { ptr: null_mut(), size: 0 };
        unsafe {
            (api.client_get_relationships_by_group)(
                client,
                Discord_RelationshipGroupType::OnlinePlayingGame,
                &mut playing,
            );
            (api.client_get_relationships_by_group)(
                client,
                Discord_RelationshipGroupType::OnlineElsewhere,
                &mut elsewhere,
            );
            (api.client_get_relationships_by_group)(
                client,
                Discord_RelationshipGroupType::Offline,
                &mut offline,
            );
        }
        snapshot.relationship_counts = DiscordRelationshipCounts {
            online_playing_game: playing.size,
            online_elsewhere: elsewhere.size,
            offline: offline.size,
            total: playing.size + elsewhere.size + offline.size,
        };
    } else {
        snapshot.current_user = None;
        snapshot.relationship_counts = DiscordRelationshipCounts::default();
    }
}

fn start_callback_thread() {
    thread::spawn(move || loop {
        {
            let mut guard = runtime_slot().lock().unwrap();
            let Some(runtime) = guard.as_mut() else {
                break;
            };
            if !runtime.callback_running.load(Ordering::Relaxed) {
                break;
            }
            unsafe { (runtime.api.run_callbacks)() };
            if dirty_flag().swap(false, Ordering::Relaxed) {
                refresh_snapshot_from_runtime(runtime);
            }
        }
        thread::sleep(Duration::from_millis(120));
    });
}

#[tauri::command]
pub fn discord_initialize(app: AppHandle) -> Result<DiscordSdkSnapshot, String> {
    {
        let guard = runtime_slot().lock().unwrap();
        if guard.is_some() {
            return Ok(snapshot_clone());
        }
    }

    *app_slot().lock().unwrap() = Some(app.clone());
    let sdk_path = locate_sdk_library(&app).ok_or_else(|| {
        let message = "Discord Social SDK library was not found in resources or third_party";
        set_last_error(message);
        push_discord_log("error", message);
        message.to_string()
    })?;
    push_discord_log(
        "info",
        format!("initializing Discord Social SDK from {}", sdk_path.to_string_lossy()),
    );

    let library = unsafe { Library::new(&sdk_path) }.map_err(|e| {
        let message = format!("Failed to load Discord Social SDK: {}", e);
        set_last_error(message.clone());
        push_discord_log("error", &message);
        message
    })?;
    let api = load_api(&library).inspect_err(|message| {
        set_last_error(message.clone());
        push_discord_log("error", message);
    })?;
    let mut client = Discord_Client { opaque: null_mut() };
    unsafe {
        (api.client_init)(&mut client);
        (api.client_set_application_id)(&mut client, DISCORD_APPLICATION_ID);
        (api.client_set_game_window_pid)(&mut client, std::process::id() as i32);
        (api.client_set_status_changed_callback)(
            &mut client,
            discord_status_changed_callback,
            None,
            null_mut(),
        );
        (api.client_set_activity_join_callback)(
            &mut client,
            discord_activity_join_callback,
            None,
            null_mut(),
        );
        (api.client_set_relationship_groups_updated_callback)(
            &mut client,
            discord_relationship_groups_updated_callback,
            None,
            null_mut(),
        );
        (api.client_set_user_updated_callback)(
            &mut client,
            discord_user_updated_callback,
            None,
            null_mut(),
        );
        (api.client_connect)(&mut client);
        (api.client_set_online_status)(
            &mut client,
            Discord_StatusType::Online,
            discord_noop_status_callback,
            None,
            null_mut(),
        );
        (api.client_is_discord_app_installed)(
            &mut client,
            discord_installed_callback,
            None,
            null_mut(),
        );
    }

    let launch_registered = std::env::current_exe()
        .ok()
        .and_then(|path| path.to_str().map(|s| s.to_string()))
        .map(|command| unsafe {
            (api.client_register_launch_command)(
                &mut client,
                DISCORD_APPLICATION_ID,
                discord_string(&command),
            )
        })
        .unwrap_or(false);

    {
        let mut snapshot = snapshot_slot().lock().unwrap();
        *snapshot = DiscordSdkSnapshot {
            available: true,
            initialized: true,
            connected: true,
            ready: false,
            app_installed: None,
            client_status: "connecting".to_string(),
            launch_registered,
            rich_presence_active: false,
            sdk_path: Some(sdk_path.to_string_lossy().into_owned()),
            current_user: None,
            relationship_counts: DiscordRelationshipCounts::default(),
            last_join_secret: None,
            last_error: None,
        };
    }
    clear_last_error();

    {
        let mut guard = runtime_slot().lock().unwrap();
        *guard = Some(DiscordRuntime {
            _library: library,
            api,
            client,
            sdk_path: sdk_path.to_string_lossy().into_owned(),
            callback_running: AtomicBool::new(true),
        });
        if let Some(runtime) = guard.as_ref() {
            refresh_snapshot_from_runtime(runtime);
        }
    }
    push_discord_log(
        "info",
        format!("Discord Social SDK initialised (launch_registered={})", launch_registered),
    );
    start_callback_thread();
    Ok(snapshot_clone())
}

#[tauri::command]
pub fn discord_shutdown() -> Result<(), String> {
    let mut guard = runtime_slot().lock().unwrap();
    if let Some(mut runtime) = guard.take() {
        runtime.callback_running.store(false, Ordering::Relaxed);
        unsafe {
            (runtime.api.client_clear_rich_presence)(&mut runtime.client);
            (runtime.api.client_disconnect)(&mut runtime.client);
            (runtime.api.client_drop)(&mut runtime.client);
        }
    }
    *snapshot_slot().lock().unwrap() = DiscordSdkSnapshot::default();
    push_discord_log("info", "Discord Social SDK shut down");
    Ok(())
}

#[tauri::command]
pub fn discord_get_snapshot() -> DiscordSdkSnapshot {
    snapshot_clone()
}

#[tauri::command]
pub fn discord_open_connected_games_settings() -> Result<(), String> {
    let mut guard = runtime_slot().lock().unwrap();
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "Discord Social SDK is not initialized".to_string())?;
    unsafe {
        (runtime.api.client_open_connected_games_settings)(
            &mut runtime.client,
            discord_noop_open_settings_callback,
            None,
            null_mut(),
        );
    }
    push_discord_log("info", "opened Discord Connected Games settings");
    Ok(())
}

#[tauri::command]
pub fn discord_set_presence(input: DiscordPresenceInput) -> Result<(), String> {
    let mut guard = runtime_slot().lock().unwrap();
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "Discord Social SDK is not initialized".to_string())?;

    let mut activity = Discord_Activity { opaque: null_mut() };
    unsafe { (runtime.api.activity_init)(&mut activity) };
    unsafe {
        (runtime.api.activity_set_name)(&mut activity, discord_string(&input.title));
        (runtime.api.activity_set_type)(&mut activity, Discord_ActivityTypes::Playing);
        (runtime.api.activity_set_supported_platforms)(
            &mut activity,
            Discord_ActivityGamePlatforms::Desktop,
        );
    }

    let mut state_value = input.state.as_ref().map(|x| discord_string(x));
    let mut details_value = input.details.as_ref().map(|x| discord_string(x));
    if let Some(ref mut state) = state_value {
        unsafe { (runtime.api.activity_set_state)(&mut activity, state) };
    }
    if let Some(ref mut details) = details_value {
        unsafe { (runtime.api.activity_set_details)(&mut activity, details) };
    }

    let use_assets = !input.large_image.as_deref().unwrap_or("").trim().is_empty()
        || !input.small_image.as_deref().unwrap_or("").trim().is_empty()
        || !input.large_text.as_deref().unwrap_or("").trim().is_empty()
        || !input.large_url.as_deref().unwrap_or("").trim().is_empty()
        || !input.small_text.as_deref().unwrap_or("").trim().is_empty();
    if use_assets {
        let mut assets = Discord_ActivityAssets { opaque: null_mut() };
        unsafe { (runtime.api.activity_assets_init)(&mut assets) };
        let mut large_image = input.large_image.as_ref().map(|x| discord_string(x));
        let mut large_text = input.large_text.as_ref().map(|x| discord_string(x));
        let mut large_url = input.large_url.as_ref().map(|x| discord_string(x));
        let mut small_image = input.small_image.as_ref().map(|x| discord_string(x));
        let mut small_text = input.small_text.as_ref().map(|x| discord_string(x));
        if let Some(ref mut value) = large_image {
            unsafe { (runtime.api.activity_assets_set_large_image)(&mut assets, value) };
        }
        if let Some(ref mut value) = large_text {
            unsafe { (runtime.api.activity_assets_set_large_text)(&mut assets, value) };
        }
        if let Some(ref mut value) = large_url {
            unsafe { (runtime.api.activity_assets_set_large_url)(&mut assets, value) };
        }
        if let Some(ref mut value) = small_image {
            unsafe { (runtime.api.activity_assets_set_small_image)(&mut assets, value) };
        }
        if let Some(ref mut value) = small_text {
            unsafe { (runtime.api.activity_assets_set_small_text)(&mut assets, value) };
        }
        unsafe {
            (runtime.api.activity_set_assets)(&mut activity, &mut assets);
            (runtime.api.activity_assets_drop)(&mut assets);
        }
    }

    if let Some(start_ms) = input.start_timestamp_ms {
        let mut timestamps = Discord_ActivityTimestamps { opaque: null_mut() };
        unsafe {
            (runtime.api.activity_timestamps_init)(&mut timestamps);
            (runtime.api.activity_timestamps_set_start)(&mut timestamps, start_ms / 1000);
            (runtime.api.activity_set_timestamps)(&mut activity, &mut timestamps);
            (runtime.api.activity_timestamps_drop)(&mut timestamps);
        }
    }

    if let Some(secret) = input.join_secret.as_ref().filter(|s| !s.trim().is_empty()) {
        let mut secrets = Discord_ActivitySecrets { opaque: null_mut() };
        unsafe {
            (runtime.api.activity_secrets_init)(&mut secrets);
            (runtime.api.activity_secrets_set_join)(&mut secrets, discord_string(secret));
            (runtime.api.activity_set_secrets)(&mut activity, &mut secrets);
            (runtime.api.activity_secrets_drop)(&mut secrets);
        }
    }

    unsafe {
        (runtime.api.client_update_rich_presence)(
            &mut runtime.client,
            &mut activity,
            discord_noop_presence_callback,
            None,
            null_mut(),
        );
        (runtime.api.activity_drop)(&mut activity);
    }
    snapshot_slot().lock().unwrap().rich_presence_active = true;
    push_discord_log("info", format!("rich presence updated for {}", input.title));
    Ok(())
}

#[tauri::command]
pub fn discord_clear_presence() -> Result<(), String> {
    let mut guard = runtime_slot().lock().unwrap();
    let runtime = guard
        .as_mut()
        .ok_or_else(|| "Discord Social SDK is not initialized".to_string())?;
    unsafe {
        (runtime.api.client_clear_rich_presence)(&mut runtime.client);
    }
    snapshot_slot().lock().unwrap().rich_presence_active = false;
    push_discord_log("info", "rich presence cleared");
    Ok(())
}

pub fn set_game_window_pid(pid: i32) {
    let mut guard = runtime_slot().lock().unwrap();
    if let Some(runtime) = guard.as_mut() {
        unsafe {
            (runtime.api.client_set_game_window_pid)(&mut runtime.client, pid);
        }
    }
}
