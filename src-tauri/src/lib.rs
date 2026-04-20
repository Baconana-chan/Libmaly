use serde::{Deserialize, Serialize};
use serde_json::Value;
use scraper::{Html, Selector};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use walkdir::WalkDir;
#[cfg(windows)]
use rusqlite::Connection;
#[cfg(windows)]
use rusqlite::types::ValueRef;
#[cfg(windows)]
use std::fs::OpenOptions;
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use winapi::um::winnt::{FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE};
#[cfg(windows)]
use winreg::RegKey;
#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};

mod metadata;
use metadata::{
    dlsite_is_logged_in, dlsite_login, dlsite_logout, f95_is_logged_in, f95_login, f95_logout,
    fetch_dlsite_metadata, fetch_f95_metadata, fetch_fakku_metadata, fetch_johren_metadata,
    fetch_mangagamer_metadata, fetch_vndb_metadata, fakku_is_logged_in, fakku_login,
    fakku_logout, get_scraper_health_snapshot, search_suggest_links,
    fetch_igdb_metadata, fetch_rawg_metadata, fetch_mobygames_metadata,
    set_api_key, get_api_key,
};

mod custom_metadata;
use custom_metadata::{
    custom_metadata_delete_template, custom_metadata_export_templates,
    custom_metadata_export_templates_to_path, custom_metadata_import_templates,
    custom_metadata_import_templates_from_path, custom_metadata_list_templates,
    custom_metadata_match_source, fetch_custom_metadata, fetch_custom_metadata_command,
    find_matching_template, find_template_by_source,
};

mod vault;
use vault::{delete_secret as vault_delete_secret, get_secret as vault_get_secret, legacy_global_file_path, profile_file_path};

mod updater;
use updater::{preview_update, update_game};

mod itch;
use itch::{
    itch_butler_apply_update, itch_butler_check_updates, itch_butler_install_game,
    itch_butler_list_owned_games, itch_butler_status,
};

mod screenshot;
use screenshot::{
    delete_screenshot_file, export_screenshots_zip, get_screenshots, open_screenshots_folder,
    overwrite_screenshot_png, save_screenshot_tags, take_screenshot_manual,
    get_screenshot_data_url,
};
mod discord;
mod data_paths;
mod sync;
mod save_transfer;
use data_paths::{app_data_root, crash_report_path, is_portable_mode};
use save_transfer::{is_valid_save_directory as check_valid_save_directory, SavePathInfo, TransferResult};
use discord::{
    discord_clear_presence, discord_get_snapshot, discord_initialize, discord_open_connected_games_settings,
    discord_set_presence, discord_shutdown,
};

#[derive(Serialize, Deserialize, Clone)]
struct Game {
    name: String,
    path: String,
}

/// A recently-launched game entry (stored for tray quick-launch).
#[derive(Serialize, Deserialize, Clone)]
struct RecentGame {
    name: String,
    path: String,
}

struct RecentGamesState(std::sync::Mutex<Vec<RecentGame>>);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryProfile {
    id: String,
    display_name: String,
    handle: Option<String>,
    tagline: Option<String>,
    avatar_url: Option<String>,
    banner_url: Option<String>,
    accent_color: Option<String>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryProfileRegistry {
    active_profile_id: String,
    profiles: Vec<LibraryProfile>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryProfileInput {
    id: Option<String>,
    display_name: String,
    handle: Option<String>,
    tagline: Option<String>,
    avatar_url: Option<String>,
    banner_url: Option<String>,
    accent_color: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedMetadataSource {
    source: String,
    source_label: String,
    is_custom: bool,
}

fn detect_builtin_metadata_source(url: &str) -> Option<ResolvedMetadataSource> {
    let lower = url.trim().to_ascii_lowercase();
    if lower.contains("f95zone.to") {
        return Some(ResolvedMetadataSource { source: "f95".into(), source_label: "F95zone".into(), is_custom: false });
    }
    if lower.contains("dlsite.com") {
        return Some(ResolvedMetadataSource { source: "dlsite".into(), source_label: "DLsite".into(), is_custom: false });
    }
    if lower.contains("vndb.org/v") {
        return Some(ResolvedMetadataSource { source: "vndb".into(), source_label: "VNDB".into(), is_custom: false });
    }
    if lower.contains("mangagamer.com") {
        return Some(ResolvedMetadataSource { source: "mangagamer".into(), source_label: "MangaGamer".into(), is_custom: false });
    }
    if lower.contains("johren.net") {
        return Some(ResolvedMetadataSource { source: "johren".into(), source_label: "Johren".into(), is_custom: false });
    }
    if lower.contains("fakku.net") {
        return Some(ResolvedMetadataSource { source: "fakku".into(), source_label: "FAKKU".into(), is_custom: false });
    }
    if lower.contains("igdb.com") {
        return Some(ResolvedMetadataSource { source: "igdb".into(), source_label: "IGDB".into(), is_custom: false });
    }
    if lower.contains("rawg.io") {
        return Some(ResolvedMetadataSource { source: "rawg".into(), source_label: "RAWG".into(), is_custom: false });
    }
    if lower.contains("mobygames.com") {
        return Some(ResolvedMetadataSource { source: "mobygames".into(), source_label: "MobyGames".into(), is_custom: false });
    }
    None
}

async fn fetch_builtin_metadata_by_source(source: &str, url: &str) -> Result<metadata::GameMetadata, String> {
    match source {
        "f95" => fetch_f95_metadata(url.to_string()).await,
        "dlsite" => fetch_dlsite_metadata(url.to_string()).await,
        "vndb" => fetch_vndb_metadata(url.to_string()).await,
        "mangagamer" => fetch_mangagamer_metadata(url.to_string()).await,
        "johren" => fetch_johren_metadata(url.to_string()).await,
        "fakku" => fetch_fakku_metadata(url.to_string()).await,
        "igdb" => fetch_igdb_metadata(url.to_string()).await,
        "rawg" => fetch_rawg_metadata(url.to_string()).await,
        "mobygames" => fetch_mobygames_metadata(url.to_string()).await,
        _ => Err(format!("Unsupported metadata source: {}", source)),
    }
}

#[tauri::command]
async fn resolve_metadata_source(url: String) -> Result<Option<ResolvedMetadataSource>, String> {
    if let Some(template) = find_matching_template(&url, Some(true))? {
        return Ok(Some(ResolvedMetadataSource {
            source: format!("custom:{}", template.id),
            source_label: template.name,
            is_custom: true,
        }));
    }
    if let Some(source) = detect_builtin_metadata_source(&url) {
        return Ok(Some(source));
    }
    if let Some(template) = find_matching_template(&url, Some(false))? {
        return Ok(Some(ResolvedMetadataSource {
            source: format!("custom:{}", template.id),
            source_label: template.name,
            is_custom: true,
        }));
    }
    Ok(None)
}

#[tauri::command]
async fn fetch_metadata_for_url(url: String) -> Result<metadata::GameMetadata, String> {
    if let Some(template) = find_matching_template(&url, Some(true))? {
        return fetch_custom_metadata(&url, &template).await;
    }
    if let Some(source) = detect_builtin_metadata_source(&url) {
        return fetch_builtin_metadata_by_source(&source.source, &url).await;
    }
    if let Some(template) = find_matching_template(&url, Some(false))? {
        return fetch_custom_metadata(&url, &template).await;
    }
    Err("No built-in or custom metadata source matched this URL".to_string())
}

#[tauri::command]
async fn fetch_metadata_by_source(source: String, url: String) -> Result<metadata::GameMetadata, String> {
    if source.starts_with("custom:") {
        let template = find_template_by_source(&source)?
            .ok_or_else(|| format!("Custom metadata source '{}' is unavailable", source))?;
        return fetch_custom_metadata(&url, &template).await;
    }
    fetch_builtin_metadata_by_source(&source, &url).await
}

struct LibraryProfilesState(std::sync::Mutex<LibraryProfileRegistry>);

#[derive(Serialize, Deserialize, Clone)]
struct RustLogEntry {
    ts: u64,
    level: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct CrashReport {
    ts: u64,
    thread: String,
    message: String,
    location: String,
    backtrace: String,
}

#[derive(Serialize)]
struct SaveBackupResult {
    zip_path: String,
    files: usize,
    directories: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncSaveBackupResult {
    zip_path: String,
    files: usize,
    directories: Vec<String>,
    remote_path: String,
    provider_type: sync::SyncProviderType,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupRetentionPolicy {
    daily_keep: usize,
    weekly_keep: usize,
    monthly_keep: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BackupRetentionApplyResult {
    snapshots_deleted: usize,
    save_backups_deleted: usize,
    snapshots_kept: usize,
    save_backups_kept: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VacuumReport {
    /// Number of orphaned temp files removed from the app data directory.
    temp_files_removed: usize,
    /// Bytes reclaimed from orphaned temp files.
    temp_bytes_freed: u64,
    /// Log entries pruned from the in-memory ring-buffer.
    log_entries_pruned: usize,
    /// File-ops journal entries pruned from the persisted journal.
    journal_entries_pruned: usize,
    /// Total milliseconds the vacuum took.
    duration_ms: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IntegrityLibraryFolderInput {
    path: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IntegrityGameInput {
    name: String,
    path: String,
    uninstalled: Option<bool>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct IntegrityCustomizationInput {
    exe_override: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IntegrityIssue {
    severity: String,
    code: String,
    message: String,
    path: Option<String>,
    game_path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IntegrityCheckReport {
    scanned_at: u64,
    total_games: usize,
    total_library_folders: usize,
    error_count: usize,
    warning_count: usize,
    issues: Vec<IntegrityIssue>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutoHealSuggestion {
    game_name: String,
    old_path: String,
    new_path: String,
    confidence: u8,
    reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutoHealReport {
    scanned_at: u64,
    total_broken_games: usize,
    suggestion_count: usize,
    unresolved_paths: Vec<String>,
    suggestions: Vec<AutoHealSuggestion>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PermissionDiagnostic {
    operation: String,
    raw_error: String,
    target_path: Option<String>,
    app_data_root: String,
    portable_mode: bool,
    summary: String,
    probable_cause: String,
    actionable_fixes: Vec<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnapshotRequest {
    label: Option<String>,
    reason: Option<String>,
    entries: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnapshotResult {
    id: String,
    path: String,
    created_at: u64,
    entry_count: usize,
    label: Option<String>,
    reason: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnapshotContents {
    id: String,
    path: String,
    created_at: u64,
    entry_count: usize,
    label: Option<String>,
    reason: Option<String>,
    entries: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnapshotPreviewItem {
    key: String,
    label: String,
    status: String,
    current_count: usize,
    snapshot_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SnapshotRestoreReport {
    snapshot: SnapshotContents,
    items: Vec<SnapshotPreviewItem>,
    changed_count: usize,
    current_games: usize,
    snapshot_games: usize,
    current_folders: usize,
    snapshot_folders: usize,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncConflictRequest {
    local_entries: HashMap<String, String>,
    remote_entries: HashMap<String, String>,
    base_entries: Option<HashMap<String, String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncConflictItem {
    key: String,
    label: String,
    resolution: String,
    reason: String,
    local_count: usize,
    remote_count: usize,
    base_count: usize,
    local_value: Option<String>,
    remote_value: Option<String>,
    base_value: Option<String>,
    requires_manual: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncConflictResolutionReport {
    resolved_entries: HashMap<String, String>,
    items: Vec<SyncConflictItem>,
    conflict_count: usize,
    changed_keys: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReliabilityScenarioResult {
    key: String,
    passed: bool,
    message: String,
    details: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReliabilityScenarioReport {
    completed_at: u64,
    platform: String,
    scenarios: Vec<ReliabilityScenarioResult>,
}

const TEST_STORAGE_KEY_GAMES: &str = "games-list-v2";
const TEST_STORAGE_KEY_FOLDERS: &str = "library-folders-v1";
const TEST_STORAGE_KEY_STATS: &str = "game-stats";
const TEST_STORAGE_KEY_NOTES: &str = "game-notes-v1";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcessLifecycleDiagnostic {
    root_pid: u32,
    tracked_pid: u32,
    related_pids: Vec<u32>,
    duration_secs: u64,
    cleanup_attempted: bool,
    cleanup_succeeded: bool,
    exit_reason: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecentFileOp {
    ts: u64,
    operation: String,
    path: String,
    strategy: String,
    success: bool,
    error: Option<String>,
}

static RUST_LOG_BUFFER: OnceLock<Mutex<Vec<RustLogEntry>>> = OnceLock::new();
const MAX_RUST_LOGS: usize = 500;
const CRASH_REPORT_FILE: &str = "libmaly_last_crash.json";
const RECENT_FILE_OPS_FILE: &str = "recent_file_ops.json";
const MAX_RECENT_FILE_OPS: usize = 40;

fn rust_log_buffer() -> &'static Mutex<Vec<RustLogEntry>> {
    RUST_LOG_BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

const LIBRARY_PROFILES_FILE: &str = "library_profiles.json";

fn normalize_optional_profile_field(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn sanitize_profile_slug(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn profiles_registry_path() -> PathBuf {
    app_data_root().join(LIBRARY_PROFILES_FILE)
}

fn default_library_profile() -> LibraryProfile {
    let now = now_ms();
    LibraryProfile {
        id: "default".to_string(),
        display_name: "Default Library".to_string(),
        handle: Some("main".to_string()),
        tagline: Some("Primary local profile".to_string()),
        avatar_url: None,
        banner_url: None,
        accent_color: Some("#66c0f4".to_string()),
        created_at: now,
        updated_at: now,
    }
}

fn ensure_profile_registry(mut registry: LibraryProfileRegistry) -> LibraryProfileRegistry {
    if registry.profiles.is_empty() {
        let profile = default_library_profile();
        registry.active_profile_id = profile.id.clone();
        registry.profiles.push(profile);
        return registry;
    }
    if registry
        .profiles
        .iter()
        .all(|profile| profile.id != registry.active_profile_id)
    {
        registry.active_profile_id = registry
            .profiles
            .first()
            .map(|profile| profile.id.clone())
            .unwrap_or_else(|| "default".to_string());
    }
    registry
}

fn load_library_profile_registry() -> LibraryProfileRegistry {
    let path = profiles_registry_path();
    if !path.exists() {
        return ensure_profile_registry(LibraryProfileRegistry {
            active_profile_id: "default".to_string(),
            profiles: vec![default_library_profile()],
        });
    }
    let raw = std::fs::read_to_string(path).ok();
    let parsed = raw
        .as_deref()
        .and_then(|contents| serde_json::from_str::<LibraryProfileRegistry>(contents).ok());
    ensure_profile_registry(parsed.unwrap_or(LibraryProfileRegistry {
        active_profile_id: "default".to_string(),
        profiles: vec![default_library_profile()],
    }))
}

fn save_library_profile_registry(registry: &LibraryProfileRegistry) -> Result<(), String> {
    let path = profiles_registry_path();
    let raw = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    atomic_write_string(&path, &raw, "save_library_profiles")
}

fn recent_file_ops_path() -> PathBuf {
    app_data_root().join(RECENT_FILE_OPS_FILE)
}

#[cfg(windows)]
fn atomic_replace_path(src: &Path, dst: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::winbase::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW};

    let mut src_w: Vec<u16> = src.as_os_str().encode_wide().collect();
    src_w.push(0);
    let mut dst_w: Vec<u16> = dst.as_os_str().encode_wide().collect();
    dst_w.push(0);
    let ok = unsafe {
        MoveFileExW(
            src_w.as_ptr(),
            dst_w.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace_path(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::rename(src, dst).map_err(|e| e.to_string())
}

fn append_recent_file_op(entry: RecentFileOp) {
    let path = recent_file_ops_path();
    let mut existing: Vec<RecentFileOp> = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    existing.push(entry);
    if existing.len() > MAX_RECENT_FILE_OPS {
        let overflow = existing.len() - MAX_RECENT_FILE_OPS;
        existing.drain(0..overflow);
    }
    if let Ok(raw) = serde_json::to_string_pretty(&existing) {
        let _ = atomic_write_string(&path, &raw, "recent_file_ops_journal");
    }
}

#[cfg(windows)]
fn read_text_file_with_shared_access(path: &Path) -> Result<String, String> {
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(not(windows))]
fn read_text_file_with_shared_access(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

fn read_text_file_resilient(path: &Path) -> Result<String, String> {
    let mut last_error = None;
    for attempt in 0..4 {
        match read_text_file_with_shared_access(path) {
            Ok(raw) if !raw.is_empty() || attempt == 3 => return Ok(raw),
            Ok(_) => {}
            Err(error) => last_error = Some(error),
        }
        thread::sleep(Duration::from_millis(35));
    }
    Err(last_error.unwrap_or_else(|| format!("Failed to read {}", path.display())))
}

fn atomic_write_string(path: &Path, contents: &str, operation: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_name = format!(
        ".{}.libmaly-tmp-{}-{}",
        path.file_name()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_else(|| "state".to_string()),
        now_ms(),
        std::process::id()
    );
    let tmp_path = path.with_file_name(tmp_name);

    let result = (|| -> Result<(), String> {
        let mut file = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        atomic_replace_path(&tmp_path, path)?;
        Ok(())
    })();

    if operation != "recent_file_ops_journal" {
        append_recent_file_op(RecentFileOp {
            ts: now_ms(),
            operation: operation.to_string(),
            path: path.to_string_lossy().to_string(),
            strategy: "temp_plus_rename".to_string(),
            success: result.is_ok(),
            error: result.as_ref().err().cloned(),
        });
    }

    if result.is_err() && tmp_path.exists() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

fn reliability_result(
    key: &str,
    passed: bool,
    message: impl Into<String>,
    details: Vec<String>,
) -> ReliabilityScenarioResult {
    ReliabilityScenarioResult {
        key: key.to_string(),
        passed,
        message: message.into(),
        details,
    }
}

fn release_test_temp_dir(name: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!(
        "libmaly-release-{}-{}-{}",
        name,
        now_ms(),
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn release_test_executable_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{}.exe", stem)
    } else {
        format!("{}.sh", stem)
    }
}

fn write_release_test_executable(path: &Path, minimum_size_bytes: usize) -> Result<(), String> {
    let seed = b"LIBMALY release reliability fixture\n";
    let mut payload = Vec::with_capacity(minimum_size_bytes.max(seed.len()));
    while payload.len() < minimum_size_bytes {
        payload.extend_from_slice(seed);
    }
    payload.truncate(minimum_size_bytes.max(seed.len()));
    std::fs::write(path, payload).map_err(|e| e.to_string())
}

fn create_release_test_game(root: &Path, game_name: &str, executable_stem: &str) -> Result<String, String> {
    let game_dir = root.join(game_name);
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    let executable_path = game_dir.join(release_test_executable_name(executable_stem));
    write_release_test_executable(&executable_path, 4096)?;
    Ok(executable_path.to_string_lossy().to_string())
}

fn create_release_test_scan_candidate(root: &Path, game_name: &str, executable_stem: &str) -> Result<String, String> {
    let game_dir = root.join(game_name);
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    let executable_path = game_dir.join(format!("{}.exe", executable_stem));
    write_release_test_executable(&executable_path, 128 * 1024)?;
    Ok(executable_path.to_string_lossy().to_string())
}

fn build_release_sample_entries(root: &Path) -> Result<HashMap<String, String>, String> {
    let game_path = create_release_test_game(root, "Crimson Echo", "CrimsonEcho")?;
    let mut entries = HashMap::<String, String>::new();
    entries.insert(
        TEST_STORAGE_KEY_FOLDERS.to_string(),
        serde_json::to_string(&vec![serde_json::json!({
            "path": root.to_string_lossy().to_string(),
        })])
        .map_err(|e| e.to_string())?,
    );
    entries.insert(
        TEST_STORAGE_KEY_GAMES.to_string(),
        serde_json::to_string(&vec![serde_json::json!({
            "name": "Crimson Echo",
            "path": game_path.clone(),
            "uninstalled": false,
        })])
        .map_err(|e| e.to_string())?,
    );
    entries.insert(
        TEST_STORAGE_KEY_STATS.to_string(),
        serde_json::to_string(&serde_json::json!({
            game_path.clone(): {
                "playtimeMinutes": 45,
                "launchCount": 3,
            }
        }))
        .map_err(|e| e.to_string())?,
    );
    entries.insert(
        TEST_STORAGE_KEY_NOTES.to_string(),
        serde_json::to_string(&serde_json::json!({
            game_path: "Recovery note survives snapshot restore",
        }))
        .map_err(|e| e.to_string())?,
    );
    Ok(entries)
}

fn run_release_crash_during_write_test() -> ReliabilityScenarioResult {
    let dir = match release_test_temp_dir("crash-write") {
        Ok(dir) => dir,
        Err(error) => {
            return reliability_result(
                "crash_during_write",
                false,
                "Failed to create isolated crash-recovery test directory",
                vec![error],
            )
        }
    };

    let outcome = (|| -> Result<Vec<String>, String> {
        let library_root = dir.join("library");
        std::fs::create_dir_all(&library_root).map_err(|e| e.to_string())?;
        let baseline_entries = build_release_sample_entries(&library_root)?;
        let state_path = dir.join(STATE_STORAGE_FILE);
        let baseline_raw = serde_json::to_string(&StateStore {
            schema_version: CURRENT_SCHEMA_VERSION,
            entries: baseline_entries.clone(),
        })
        .map_err(|e| e.to_string())?;
        atomic_write_string(&state_path, &baseline_raw, "release_test_crash_baseline")?;

        let interrupted_tmp = state_path.with_file_name(".state.json.libmaly-tmp-crash-test");
        std::fs::write(&interrupted_tmp, b"{\"schemaVersion\":1,\"entries\":")
            .map_err(|e| e.to_string())?;

        let recovered_raw = read_text_file_resilient(&state_path)?;
        let recovered_store = parse_state_store(&recovered_raw)?;
        if recovered_store.entries != baseline_entries {
            return Err("Committed state changed after leaving behind an interrupted temp file".to_string());
        }

        Ok(vec![
            format!("Recovered {} committed entries after simulating an interrupted temp write.", recovered_store.entries.len()),
            format!("Primary file remained readable at {}.", state_path.to_string_lossy()),
            format!("Interrupted payload stayed isolated in {}.", interrupted_tmp.to_string_lossy()),
        ])
    })();

    let result = match outcome {
        Ok(details) => reliability_result(
            "crash_during_write",
            true,
            "Interrupted writes leave the last committed state recoverable",
            details,
        ),
        Err(error) => reliability_result(
            "crash_during_write",
            false,
            "Interrupted write simulation lost the committed state",
            vec![error],
        ),
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn run_release_root_folder_rename_test() -> ReliabilityScenarioResult {
    let dir = match release_test_temp_dir("root-rename") {
        Ok(dir) => dir,
        Err(error) => {
            return reliability_result(
                "root_folder_rename",
                false,
                "Failed to create isolated auto-heal test directory",
                vec![error],
            )
        }
    };

    let outcome = (|| -> Result<Vec<String>, String> {
        let old_root = dir.join("LibraryRootOld");
        std::fs::create_dir_all(&old_root).map_err(|e| e.to_string())?;
        let first_old_path = create_release_test_scan_candidate(&old_root, "Moonlight Story", "MoonlightStory")?;
        let second_old_path = create_release_test_scan_candidate(&old_root, "Velvet Lesson", "VelvetLesson")?;
        let new_root = dir.join("LibraryRootRenamed");
        std::fs::rename(&old_root, &new_root).map_err(|e| e.to_string())?;

        let report = suggest_auto_heal_paths(
            vec![IntegrityLibraryFolderInput {
                path: new_root.to_string_lossy().to_string(),
            }],
            vec![
                IntegrityGameInput {
                    name: "Moonlight Story".to_string(),
                    path: first_old_path,
                    uninstalled: Some(false),
                },
                IntegrityGameInput {
                    name: "Velvet Lesson".to_string(),
                    path: second_old_path,
                    uninstalled: Some(false),
                },
            ],
        )?;

        if report.total_broken_games != 2 || report.suggestion_count != 2 || !report.unresolved_paths.is_empty() {
            return Err(format!(
                "Expected 2 healed paths but got {} suggestions and {} unresolved paths",
                report.suggestion_count,
                report.unresolved_paths.len()
            ));
        }

        let mut details = vec![format!(
            "Recovered {}/{} broken game paths after renaming the library root.",
            report.suggestion_count,
            report.total_broken_games
        )];
        for suggestion in report.suggestions.iter() {
            details.push(format!(
                "{} -> {} ({}% confidence, {})",
                suggestion.old_path,
                suggestion.new_path,
                suggestion.confidence,
                suggestion.reason
            ));
        }
        Ok(details)
    })();

    let result = match outcome {
        Ok(details) => reliability_result(
            "root_folder_rename",
            true,
            "Auto-heal successfully remapped games after a library root rename",
            details,
        ),
        Err(error) => reliability_result(
            "root_folder_rename",
            false,
            "Auto-heal did not recover renamed library paths reliably",
            vec![error],
        ),
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn run_release_local_vs_cloud_conflict_test() -> ReliabilityScenarioResult {
    let outcome = (|| -> Result<Vec<String>, String> {
        let base_entries = HashMap::from([
            (
                TEST_STORAGE_KEY_STATS.to_string(),
                serde_json::json!({ "playtimeMinutes": 10, "launchCount": 1 }).to_string(),
            ),
            (
                TEST_STORAGE_KEY_NOTES.to_string(),
                serde_json::json!({ "body": "Base note" }).to_string(),
            ),
        ]);
        let local_entries = HashMap::from([
            (
                TEST_STORAGE_KEY_STATS.to_string(),
                serde_json::json!({ "playtimeMinutes": 25, "launchCount": 2 }).to_string(),
            ),
            (
                TEST_STORAGE_KEY_NOTES.to_string(),
                serde_json::json!({ "body": "Base note" }).to_string(),
            ),
        ]);
        let remote_entries = HashMap::from([
            (
                TEST_STORAGE_KEY_STATS.to_string(),
                serde_json::json!({ "playtimeMinutes": 10, "launchCount": 1 }).to_string(),
            ),
            (
                TEST_STORAGE_KEY_NOTES.to_string(),
                serde_json::json!({ "body": "Remote note wins deterministically" }).to_string(),
            ),
        ]);

        let report = resolve_sync_conflicts(SyncConflictRequest {
            local_entries,
            remote_entries,
            base_entries: Some(base_entries),
        });
        if report.conflict_count != 0 {
            return Err(format!("Expected a conflict-free deterministic merge but found {} manual conflicts", report.conflict_count));
        }

        let merged_stats: Value = serde_json::from_str(
            report
                .resolved_entries
                .get(TEST_STORAGE_KEY_STATS)
                .ok_or_else(|| "Merged stats entry is missing".to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let merged_notes: Value = serde_json::from_str(
            report
                .resolved_entries
                .get(TEST_STORAGE_KEY_NOTES)
                .ok_or_else(|| "Merged notes entry is missing".to_string())?,
        )
        .map_err(|e| e.to_string())?;

        if merged_stats
            .get("playtimeMinutes")
            .and_then(|value| value.as_i64())
            != Some(25)
        {
            return Err("Merged playtime did not keep the local progress".to_string());
        }
        if merged_notes
            .get("body")
            .and_then(|value| value.as_str())
            != Some("Remote note wins deterministically")
        {
            return Err("Merged notes did not keep the remote note update".to_string());
        }

        Ok(vec![
            format!("Merged keys: {}.", report.changed_keys.join(", ")),
            "Playtime preserved the local delta while notes preserved the remote delta.".to_string(),
            "No manual conflict resolution was required for this mixed local/cloud update.".to_string(),
        ])
    })();

    match outcome {
        Ok(details) => reliability_result(
            "local_vs_cloud_conflict",
            true,
            "Three-way sync merge kept playtime and notes deterministically",
            details,
        ),
        Err(error) => reliability_result(
            "local_vs_cloud_conflict",
            false,
            "Three-way sync merge produced a non-deterministic result",
            vec![error],
        ),
    }
}

fn run_release_broken_metadata_source_test() -> ReliabilityScenarioResult {
    let outcome = (|| -> Result<Vec<String>, String> {
        let import_error = custom_metadata_import_templates(
            serde_json::json!([
                {
                    "id": "broken-source",
                    "name": "Broken Source",
                    "urlPatterns": ["("],
                    "fields": {
                        "title": [
                            { "type": "css", "selector": "h1" }
                        ]
                    }
                }
            ])
            .to_string(),
        )
        .err()
        .ok_or_else(|| "Invalid metadata template unexpectedly imported without validation errors".to_string())?;

        let templates = custom_metadata_list_templates()?;
        let health = get_scraper_health_snapshot();
        if !import_error.to_ascii_lowercase().contains("invalid url pattern") {
            return Err(format!("Unexpected metadata validation error: {}", import_error));
        }

        Ok(vec![
            format!("Broken source failed fast with validation error: {}", import_error),
            format!("Template registry remained readable with {} configured templates.", templates.len()),
            format!("Scraper diagnostics still returned {} source snapshots after the failure.", health.len()),
        ])
    })();

    match outcome {
        Ok(details) => reliability_result(
            "broken_metadata_source",
            true,
            "Broken metadata sources degrade cleanly without blocking diagnostics",
            details,
        ),
        Err(error) => reliability_result(
            "broken_metadata_source",
            false,
            "Broken metadata source handling was not graceful",
            vec![error],
        ),
    }
}

fn run_release_backup_restore_test() -> ReliabilityScenarioResult {
    let dir = match release_test_temp_dir("backup-restore") {
        Ok(dir) => dir,
        Err(error) => {
            return reliability_result(
                "cross_platform_backup_restore",
                false,
                "Failed to create isolated backup/restore test directory",
                vec![error],
            )
        }
    };

    let outcome = (|| -> Result<Vec<String>, String> {
        let library_root = dir.join("library");
        std::fs::create_dir_all(&library_root).map_err(|e| e.to_string())?;
        let entries = build_release_sample_entries(&library_root)?;
        let snapshot_path = dir.join("release-backup-restore.json");
        let snapshot_json = serde_json::json!({
            "id": "release-backup-restore",
            "createdAt": now_ms(),
            "label": "Release Reliability",
            "reason": "Cross-platform backup/restore dry run",
            "entries": entries,
        });
        std::fs::write(
            &snapshot_path,
            serde_json::to_string_pretty(&snapshot_json).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

        let preview = preview_restore_snapshot(
            snapshot_path.to_string_lossy().to_string(),
            HashMap::new(),
        )?;
        let restored = restore_snapshot(snapshot_path.to_string_lossy().to_string())?;
        let restored_folders: Vec<IntegrityLibraryFolderInput> = serde_json::from_str(
            restored
                .entries
                .get(TEST_STORAGE_KEY_FOLDERS)
                .ok_or_else(|| "Restored snapshot is missing library folders".to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let restored_games: Vec<IntegrityGameInput> = serde_json::from_str(
            restored
                .entries
                .get(TEST_STORAGE_KEY_GAMES)
                .ok_or_else(|| "Restored snapshot is missing games".to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let integrity = run_integrity_check(
            restored_folders,
            restored_games,
            HashMap::new(),
            HashMap::new(),
        );
        if preview.changed_count == 0 {
            return Err("Snapshot preview did not detect any restorable entries".to_string());
        }
        if integrity.error_count > 0 {
            return Err(format!("Integrity check found {} errors after restore", integrity.error_count));
        }

        Ok(vec![
            format!("Restored {} snapshot entries on {}.", restored.entry_count, std::env::consts::OS),
            format!("Preview detected {} changes before restore.", preview.changed_count),
            format!("Integrity check finished with {} warnings and {} errors.", integrity.warning_count, integrity.error_count),
        ])
    })();

    let result = match outcome {
        Ok(details) => reliability_result(
            "cross_platform_backup_restore",
            true,
            "Backup snapshot round-trip restored a clean library state on the current platform",
            details,
        ),
        Err(error) => reliability_result(
            "cross_platform_backup_restore",
            false,
            "Backup snapshot round-trip failed integrity verification",
            vec![error],
        ),
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[tauri::command]
fn run_release_reliability_checks() -> ReliabilityScenarioReport {
    ReliabilityScenarioReport {
        completed_at: now_ms(),
        platform: std::env::consts::OS.to_string(),
        scenarios: vec![
            run_release_crash_during_write_test(),
            run_release_root_folder_rename_test(),
            run_release_local_vs_cloud_conflict_test(),
            run_release_broken_metadata_source_test(),
            run_release_backup_restore_test(),
        ],
    }
}

#[cfg(test)]
mod reliability_tests {
    use super::*;

    #[test]
    fn auto_heal_detects_root_rename_for_release_fixture() {
        let dir = release_test_temp_dir("unit-root-rename").expect("temp dir");

        let outcome = (|| -> Result<(), String> {
            let old_root = dir.join("LibraryRootOld");
            std::fs::create_dir_all(&old_root).map_err(|e| e.to_string())?;
            let first_old_path = create_release_test_scan_candidate(&old_root, "Moonlight Story", "MoonlightStory")?;
            let second_old_path = create_release_test_scan_candidate(&old_root, "Velvet Lesson", "VelvetLesson")?;
            let new_root = dir.join("LibraryRootRenamed");
            std::fs::rename(&old_root, &new_root).map_err(|e| e.to_string())?;

            let report = suggest_auto_heal_paths(
                vec![IntegrityLibraryFolderInput {
                    path: new_root.to_string_lossy().to_string(),
                }],
                vec![
                    IntegrityGameInput {
                        name: "Moonlight Story".to_string(),
                        path: first_old_path,
                        uninstalled: Some(false),
                    },
                    IntegrityGameInput {
                        name: "Velvet Lesson".to_string(),
                        path: second_old_path,
                        uninstalled: Some(false),
                    },
                ],
            )?;

            if report.total_broken_games != 2 {
                return Err(format!("expected 2 broken games, got {}", report.total_broken_games));
            }
            if report.suggestion_count != 2 {
                return Err(format!("expected 2 suggestions, got {}", report.suggestion_count));
            }
            if !report.unresolved_paths.is_empty() {
                return Err(format!("expected no unresolved paths, got {}", report.unresolved_paths.len()));
            }
            Ok(())
        })();

        let _ = std::fs::remove_dir_all(&dir);
        if let Err(error) = outcome {
            panic!("{}", error);
        }
    }
}

#[tauri::command]
fn get_recent_file_ops(limit: Option<usize>) -> Vec<RecentFileOp> {
    let path = recent_file_ops_path();
    let mut ops: Vec<RecentFileOp> = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let take_n = limit.unwrap_or(20).min(MAX_RECENT_FILE_OPS);
    if ops.len() > take_n {
        ops = ops.split_off(ops.len() - take_n);
    }
    ops
}

fn sanitize_name_for_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else if c.is_whitespace() {
            out.push('_');
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        "game".to_string()
    } else {
        out
    }
}

fn name_variants_from_game_path(game_path: &Path) -> Vec<String> {
    let mut raw = Vec::<String>::new();
    if let Some(stem) = game_path.file_stem() {
        raw.push(stem.to_string_lossy().to_string());
    }
    if let Some(parent) = game_path.parent().and_then(|p| p.file_name()) {
        raw.push(parent.to_string_lossy().to_string());
    }

    let mut set = HashSet::<String>::new();
    let mut out = Vec::<String>::new();
    for item in raw {
        let trimmed = item.trim().to_string();
        if !trimmed.is_empty() && set.insert(trimmed.to_lowercase()) {
            out.push(trimmed.clone());
        }
        let compact: String = trimmed
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect();
        if !compact.is_empty() && set.insert(compact.to_lowercase()) {
            out.push(compact);
        }
    }
    out
}

fn push_dir_if_exists_unique(out: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }
    let key = dir.to_string_lossy().to_string().to_lowercase();
    if out
        .iter()
        .any(|d| d.to_string_lossy().to_string().to_lowercase() == key)
    {
        return;
    }
    out.push(dir);
}

fn dir_has_files(dir: &Path) -> bool {
    WalkDir::new(dir)
        .max_depth(8)
        .into_iter()
        .filter_map(|e| e.ok())
        .any(|e| e.file_type().is_file())
}

fn normalize_path_key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsProcessEntryRaw {
    process_id: u32,
    parent_process_id: Option<u32>,
    executable_path: Option<String>,
    command_line: Option<String>,
    name: Option<String>,
}

#[derive(Clone)]
struct ProcessEntry {
    pid: u32,
    parent_pid: Option<u32>,
    executable_path: Option<String>,
    command_line: String,
    name: String,
}

fn list_process_entries() -> Vec<ProcessEntry> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = cmd
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,Name | ConvertTo-Json -Compress",
            ])
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if raw.is_empty() {
            return Vec::new();
        }
        let parsed = serde_json::from_str::<serde_json::Value>(&raw).ok();
        let rows = match parsed {
            Some(serde_json::Value::Array(items)) => items,
            Some(value @ serde_json::Value::Object(_)) => vec![value],
            _ => Vec::new(),
        };
        rows.into_iter()
            .filter_map(|value| serde_json::from_value::<WindowsProcessEntryRaw>(value).ok())
            .map(|row| ProcessEntry {
                pid: row.process_id,
                parent_pid: row.parent_process_id,
                executable_path: row.executable_path.clone(),
                command_line: row.command_line.unwrap_or_default(),
                name: row.name.unwrap_or_default(),
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("ps")
            .args(["-eo", "pid=,ppid=,args="])
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }
                let mut parts = trimmed.split_whitespace();
                let pid = parts.next()?.parse::<u32>().ok()?;
                let ppid = parts.next()?.parse::<u32>().ok()?;
                let rest = trimmed
                    .splitn(3, char::is_whitespace)
                    .nth(2)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let exe = rest
                    .split_whitespace()
                    .next()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty());
                let name = exe
                    .as_deref()
                    .and_then(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()))
                    .unwrap_or_default();
                Some(ProcessEntry {
                    pid,
                    parent_pid: Some(ppid),
                    executable_path: exe,
                    command_line: rest,
                    name,
                })
            })
            .collect()
    }
}

fn collect_related_processes(root_pid: u32) -> Vec<ProcessEntry> {
    let entries = list_process_entries();
    let mut by_parent = HashMap::<u32, Vec<ProcessEntry>>::new();
    let mut root_entry: Option<ProcessEntry> = None;
    for entry in entries {
        if entry.pid == root_pid {
            root_entry = Some(entry.clone());
        }
        if let Some(parent_pid) = entry.parent_pid {
            by_parent.entry(parent_pid).or_default().push(entry);
        }
    }
    let mut out = Vec::<ProcessEntry>::new();
    let mut queue = vec![root_pid];
    let mut seen = HashSet::<u32>::new();
    if let Some(root) = root_entry {
        seen.insert(root.pid);
        out.push(root);
    }
    while let Some(pid) = queue.pop() {
        if let Some(children) = by_parent.remove(&pid) {
            for child in children {
                if seen.insert(child.pid) {
                    queue.push(child.pid);
                    out.push(child);
                }
            }
        }
    }
    out.sort_by_key(|entry| entry.pid);
    out
}

fn choose_tracked_process_pid(entries: &[ProcessEntry], root_pid: u32, game_path: &str) -> u32 {
    let game_key = normalize_path_key(game_path);
    let game_name = file_name_lower(game_path);
    let game_stem = file_stem_lower(game_path);
    entries
        .iter()
        .max_by_key(|entry| {
            let exe_key = entry
                .executable_path
                .as_deref()
                .map(normalize_path_key)
                .unwrap_or_default();
            let cmd_key = normalize_path_key(&entry.command_line);
            let name_key = entry.name.to_lowercase();
            let mut score = 0i32;
            if entry.pid != root_pid {
                score += 8;
            }
            if !exe_key.is_empty() && exe_key == game_key {
                score += 100;
            }
            if !game_name.is_empty() && (cmd_key.contains(&game_name) || name_key.contains(&game_name)) {
                score += 40;
            }
            if !game_stem.is_empty() && (cmd_key.contains(&game_stem) || name_key.contains(&game_stem)) {
                score += 25;
            }
            if entry.parent_pid == Some(root_pid) {
                score += 10;
            }
            score
        })
        .map(|entry| entry.pid)
        .unwrap_or(root_pid)
}

fn terminate_process_tree(root_pid: u32, related_pids: &[u32]) -> Result<(), String> {
    let mut pids: Vec<u32> = related_pids.iter().copied().filter(|pid| *pid > 0).collect();
    if !pids.contains(&root_pid) && root_pid > 0 {
        pids.push(root_pid);
    }
    pids.sort_unstable();
    pids.dedup();
    if pids.is_empty() {
        return Err("No running process was tracked for cleanup".to_string());
    }

    #[cfg(windows)]
    {
        let mut last_error: Option<String> = None;
        for pid in pids.iter().rev() {
            let mut cmd = Command::new("taskkill");
            #[cfg(windows)]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            let status = cmd
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status();
            match status {
                Ok(s) if s.success() => return Ok(()),
                Ok(_) => {
                    last_error = Some(format!("taskkill failed for PID {pid}"));
                }
                Err(e) => {
                    last_error = Some(e.to_string());
                }
            }
        }
        Err(last_error.unwrap_or_else(|| "Failed to terminate tracked process tree".to_string()))
    }
    #[cfg(not(windows))]
    {
        for pid in &pids {
            let _ = Command::new("kill").args(["-15", &pid.to_string()]).status();
        }
        thread::sleep(std::time::Duration::from_secs(3));
        for pid in &pids {
            let alive = Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if alive {
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
            }
        }
        Ok(())
    }
}

fn supported_executable_extension(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|x| x.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(ext.as_str(), "exe" | "sh" | "bin" | "app")
}

fn file_name_lower(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|x| x.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn file_stem_lower(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .map(|x| x.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn parent_name_lower(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(|p| p.file_name())
        .map(|x| x.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn normalize_name_key(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch.is_whitespace() || ch == '_' || ch == '-' {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn token_overlap_count(a: &str, b: &str) -> usize {
    let sa: HashSet<String> = normalize_name_key(a)
        .split_whitespace()
        .filter(|x| !x.is_empty())
        .map(|x| x.to_string())
        .collect();
    let sb: HashSet<String> = normalize_name_key(b)
        .split_whitespace()
        .filter(|x| !x.is_empty())
        .map(|x| x.to_string())
        .collect();
    sa.intersection(&sb).count()
}

fn shared_library_root<'a>(path: &str, roots: &'a [String]) -> Option<&'a String> {
    let norm = normalize_path_key(path);
    roots.iter()
        .find(|root| norm.starts_with(&format!("{}\\", normalize_path_key(root))) || norm == normalize_path_key(root))
}

fn score_auto_heal_candidate(
    game: &IntegrityGameInput,
    candidate: &Game,
    library_roots: &[String],
) -> Option<(i32, String)> {
    let old_file = file_name_lower(&game.path);
    let old_stem = file_stem_lower(&game.path);
    let old_parent = parent_name_lower(&game.path);
    let candidate_file = file_name_lower(&candidate.path);
    let candidate_stem = file_stem_lower(&candidate.path);
    let candidate_parent = parent_name_lower(&candidate.path);
    let game_name_key = normalize_name_key(&game.name);
    let candidate_name_key = normalize_name_key(&candidate.name);

    let mut score = 0i32;
    let mut reasons = Vec::<String>::new();

    if !old_stem.is_empty() && old_stem == candidate_stem {
        score += 60;
        reasons.push("same executable name".to_string());
    } else if !old_file.is_empty() && old_file == candidate_file {
        score += 48;
        reasons.push("same executable filename".to_string());
    } else if !old_stem.is_empty()
        && !candidate_stem.is_empty()
        && (old_stem.contains(&candidate_stem) || candidate_stem.contains(&old_stem))
    {
        score += 18;
        reasons.push("similar executable name".to_string());
    }

    if !old_parent.is_empty() && old_parent == candidate_parent {
        score += 28;
        reasons.push("same parent folder".to_string());
    } else if !old_parent.is_empty()
        && !candidate_parent.is_empty()
        && (old_parent.contains(&candidate_parent) || candidate_parent.contains(&old_parent))
    {
        score += 12;
        reasons.push("similar folder name".to_string());
    }

    if !game_name_key.is_empty() && game_name_key == candidate_name_key {
        score += 26;
        reasons.push("same detected game title".to_string());
    } else {
        let overlap = token_overlap_count(&game.name, &candidate.name);
        if overlap >= 2 {
            score += 14;
            reasons.push("title tokens overlap".to_string());
        }
    }

    let old_parent_overlap = token_overlap_count(&old_parent, &candidate_parent);
    if old_parent_overlap >= 2 {
        score += 10;
        reasons.push("folder tokens overlap".to_string());
    }

    if Path::new(&game.path)
        .extension()
        .map(|x| x.to_string_lossy().to_lowercase())
        == Path::new(&candidate.path)
            .extension()
            .map(|x| x.to_string_lossy().to_lowercase())
    {
        score += 4;
    }

    if let (Some(old_root), Some(new_root)) = (
        shared_library_root(&game.path, library_roots),
        shared_library_root(&candidate.path, library_roots),
    ) {
        if normalize_path_key(old_root) == normalize_path_key(new_root) {
            score += 8;
            reasons.push("same library root".to_string());
        }
    }

    if score < 45 {
        return None;
    }

    Some((score, reasons.into_iter().take(3).collect::<Vec<_>>().join(", ")))
}

fn path_starts_with_ci(path: &Path, prefix: &Path) -> bool {
    normalize_path_key(&path.to_string_lossy()) .starts_with(&normalize_path_key(&prefix.to_string_lossy()))
}

fn diagnose_permission_issue(
    operation: &str,
    target_path: Option<&str>,
    raw_error: &str,
) -> PermissionDiagnostic {
    let portable_mode = is_portable_mode();
    let app_root = app_data_root();
    let mut probable_cause = "filesystem_error".to_string();
    let mut actionable_fixes = Vec::<String>::new();
    let raw_lower = raw_error.to_lowercase();

    let target_buf = target_path
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty());
    let parent = target_buf
        .as_ref()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()));

    if raw_lower.contains("access is denied")
        || raw_lower.contains("permission denied")
        || raw_lower.contains("os error 5")
        || raw_lower.contains("operation not permitted")
    {
        probable_cause = "permission_denied".to_string();
        actionable_fixes.push("Try saving to a folder inside your user profile such as Documents, Desktop, or Downloads.".to_string());
        actionable_fixes.push("If the target is inside Program Files, the app install folder, or another protected location, pick a writable folder instead.".to_string());
        actionable_fixes.push("Close any app that may be locking the file or folder, then try again.".to_string());
    } else if raw_lower.contains("being used by another process")
        || raw_lower.contains("used by another process")
        || raw_lower.contains("sharing violation")
    {
        probable_cause = "file_locked".to_string();
        actionable_fixes.push("Close Explorer preview panes, archive tools, image editors, or backup software that may still have the file open.".to_string());
        actionable_fixes.push("Pick a new filename or destination and retry.".to_string());
    } else if raw_lower.contains("read-only") {
        probable_cause = "read_only_target".to_string();
        actionable_fixes.push("Remove the read-only attribute from the file or folder, or choose a different destination.".to_string());
    } else if raw_lower.contains("cannot find the path")
        || raw_lower.contains("no such file")
        || raw_lower.contains("could not find")
        || raw_lower.contains("not found")
    {
        probable_cause = "missing_path".to_string();
        actionable_fixes.push("Make sure the destination folder still exists before retrying.".to_string());
    }

    if let Some(path) = target_buf.as_ref() {
        if let Some(parent_dir) = parent.as_ref() {
            if !parent_dir.exists() {
                probable_cause = "missing_parent_folder".to_string();
                actionable_fixes.push(format!(
                    "Create the destination folder first: {}",
                    parent_dir.to_string_lossy()
                ));
            }
            if parent_dir.exists() && path_starts_with_ci(parent_dir, &app_root) {
                actionable_fixes.push("This path is inside LIBMALY app data. Check whether another tool, sync app, or antivirus is locking the folder.".to_string());
            }
        }

        let path_str = path.to_string_lossy().to_lowercase();
        if path_str.contains("\\program files\\")
            || path_str.contains("/program files/")
            || path_str.contains("\\windows\\")
            || path_str.contains("/windows/")
        {
            actionable_fixes.push("Protected system folders often block writes. Save to your user folders instead.".to_string());
        }

        if let Ok(meta) = std::fs::metadata(path) {
            if meta.permissions().readonly() {
                probable_cause = "read_only_target".to_string();
                actionable_fixes.push("The selected file is marked read-only. Clear the attribute or save to a different file.".to_string());
            }
        } else if let Some(parent_dir) = parent.as_ref() {
            if let Ok(meta) = std::fs::metadata(parent_dir) {
                if meta.permissions().readonly() {
                    probable_cause = "read_only_parent".to_string();
                    actionable_fixes.push("The destination folder is read-only. Clear the attribute or pick another folder.".to_string());
                }
            }
        }
    }

    if actionable_fixes.is_empty() {
        actionable_fixes.push("Retry with a different folder inside your user profile.".to_string());
        actionable_fixes.push("If the problem persists, check file permissions and whether another process is locking the path.".to_string());
    }

    let summary = match probable_cause.as_str() {
        "permission_denied" => format!("LIBMALY could not {} because the target location is not writable.", operation),
        "file_locked" => format!("LIBMALY could not {} because the target file appears to be locked by another process.", operation),
        "read_only_target" | "read_only_parent" => format!("LIBMALY could not {} because the target path is read-only.", operation),
        "missing_parent_folder" | "missing_path" => format!("LIBMALY could not {} because the destination path is missing.", operation),
        _ => format!("LIBMALY could not {} due to a filesystem error.", operation),
    };

    PermissionDiagnostic {
        operation: operation.to_string(),
        raw_error: raw_error.to_string(),
        target_path: target_path.map(|x| x.to_string()),
        app_data_root: app_root.to_string_lossy().to_string(),
        portable_mode,
        summary,
        probable_cause,
        actionable_fixes,
    }
}

fn snapshots_dir() -> PathBuf {
    app_data_root().join("snapshots")
}

fn save_backups_dir() -> PathBuf {
    app_data_root().join("save-backups")
}

fn sanitize_snapshot_label(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    for c in label.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else if c.is_whitespace() {
            out.push('_');
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        "snapshot".to_string()
    } else {
        out
    }
}

fn prune_old_snapshots(max_keep: usize) {
    let dir = snapshots_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut files = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();
    if files.len() <= max_keep {
        return;
    }
    files.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in files.into_iter().skip(max_keep) {
        let _ = std::fs::remove_file(path);
    }
}

fn week_bucket_from_days(days_since_epoch: i64) -> i64 {
    (days_since_epoch + 3).div_euclid(7)
}

fn retention_bucket_keys(ts: SystemTime) -> Option<(String, String, String)> {
    let secs = ts.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let day = format!("d:{}", days);
    let week = format!("w:{}", week_bucket_from_days(days));
    let month = format!("m:{}", days.div_euclid(30));
    Some((day, week, month))
}

fn prune_dir_with_retention(dir: &Path, policy: &BackupRetentionPolicy) -> (usize, usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (0, 0);
    };
    let mut files = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if !path.is_file() {
                return None;
            }
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| b.1.cmp(&a.1));

    let mut keep_paths = HashSet::<String>::new();
    let mut seen_days = HashSet::<String>::new();
    let mut seen_weeks = HashSet::<String>::new();
    let mut seen_months = HashSet::<String>::new();

    for (path, modified) in &files {
        let Some((day_key, week_key, month_key)) = retention_bucket_keys(*modified) else {
            continue;
        };
        let path_key = path.to_string_lossy().to_string();
        if seen_days.len() < policy.daily_keep && seen_days.insert(day_key) {
            keep_paths.insert(path_key.clone());
            continue;
        }
        if seen_weeks.len() < policy.weekly_keep && seen_weeks.insert(week_key) {
            keep_paths.insert(path_key.clone());
            continue;
        }
        if seen_months.len() < policy.monthly_keep && seen_months.insert(month_key) {
            keep_paths.insert(path_key.clone());
            continue;
        }
    }

    let mut deleted = 0usize;
    let mut kept = 0usize;
    for (path, _) in files {
        let key = path.to_string_lossy().to_string();
        if keep_paths.contains(&key) {
            kept += 1;
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    (deleted, kept)
}

// ── Database / storage vacuum ──────────────────────────────────────────────

/// Maximum number of log entries to keep in the in-memory buffer after a vacuum.
const VACUUM_LOG_KEEP: usize = 200;
/// Maximum number of recent-file-ops entries to keep after a vacuum.
const VACUUM_FILE_OPS_KEEP: usize = 20;
/// Age threshold (in milliseconds) for considering a tmp file "orphaned".
/// Files younger than this are skipped so we don't race with an in-flight write.
const VACUUM_TMP_MIN_AGE_MS: u64 = 60_000; // 1 minute

/// Prune the in-memory Rust log ring-buffer down to `VACUUM_LOG_KEEP` entries.
/// Returns the number of entries pruned.
fn vacuum_log_buffer() -> usize {
    let mut buf = rust_log_buffer().lock().unwrap();
    let len = buf.len();
    if len <= VACUUM_LOG_KEEP {
        return 0;
    }
    let remove = len - VACUUM_LOG_KEEP;
    buf.drain(0..remove);
    remove
}

/// Trim the recent_file_ops journal on disk down to `VACUUM_FILE_OPS_KEEP` entries.
/// Returns the number of entries removed.
fn vacuum_file_ops_journal() -> usize {
    let path = recent_file_ops_path();
    let mut ops: Vec<RecentFileOp> = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    } else {
        return 0;
    };
    let len = ops.len();
    if len <= VACUUM_FILE_OPS_KEEP {
        return 0;
    }
    let remove = len - VACUUM_FILE_OPS_KEEP;
    ops.drain(0..remove);
    if let Ok(raw) = serde_json::to_string_pretty(&ops) {
        // Use a direct write here (not atomic_write_string) to avoid recursive
        // journal appending inside the vacuum itself.
        let _ = std::fs::write(&path, raw.as_bytes());
    }
    remove
}

/// Remove orphaned `.libmaly-tmp-*` files from the app data root.
/// Only removes files older than `VACUUM_TMP_MIN_AGE_MS` milliseconds.
/// Returns (files_removed, bytes_freed).
fn vacuum_orphaned_tmp_files() -> (usize, u64) {
    let root = app_data_root();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return (0, 0);
    };
    let now = now_ms();
    let mut removed = 0usize;
    let mut bytes = 0u64;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !name.starts_with('.') || !name.contains(".libmaly-tmp-") {
            continue;
        }
        // Check age
        let age_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| now.saturating_sub(d.as_millis() as u64))
            .unwrap_or(u64::MAX);
        if age_ms < VACUUM_TMP_MIN_AGE_MS {
            continue;
        }
        let file_size = entry.metadata().ok().map(|m| m.len()).unwrap_or(0);
        if std::fs::remove_file(&path).is_ok() {
            removed += 1;
            bytes += file_size;
        }
    }
    (removed, bytes)
}

#[tauri::command]
fn run_db_vacuum() -> VacuumReport {
    let start = now_ms();
    let log_pruned = vacuum_log_buffer();
    let journal_pruned = vacuum_file_ops_journal();
    let (temp_removed, temp_bytes) = vacuum_orphaned_tmp_files();
    let duration = now_ms().saturating_sub(start);
    push_rust_log(
        None,
        "info",
        format!(
            "vacuum: pruned {} log entries, {} journal entries, removed {} tmp files ({} bytes) in {}ms",
            log_pruned, journal_pruned, temp_removed, temp_bytes, duration
        ),
    );
    VacuumReport {
        temp_files_removed: temp_removed,
        temp_bytes_freed: temp_bytes,
        log_entries_pruned: log_pruned,
        journal_entries_pruned: journal_pruned,
        duration_ms: duration,
    }
}

fn read_snapshot_file(path: &Path) -> Result<SnapshotContents, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let entries = parsed
        .get("entries")
        .and_then(|v| serde_json::from_value::<HashMap<String, String>>(v.clone()).ok())
        .unwrap_or_default();
    let id = parsed
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "snapshot".to_string())
        });
    Ok(SnapshotContents {
        id,
        path: path.to_string_lossy().to_string(),
        created_at: parsed.get("createdAt").and_then(|v| v.as_u64()).unwrap_or(0),
        entry_count: entries.len(),
        label: parsed.get("label").and_then(|v| v.as_str()).map(|s| s.to_string()),
        reason: parsed.get("reason").and_then(|v| v.as_str()).map(|s| s.to_string()),
        entries,
    })
}

fn snapshot_entry_label(key: &str) -> String {
    match key {
        "game-list-v2" => "Games".to_string(),
        "dir-mtimes-v2" => "Folder mtimes".to_string(),
        "library-folders-v1" => "Library folders".to_string(),
        "game-stats" => "Playtime and stats".to_string(),
        "game-metadata" => "Metadata cache".to_string(),
        "hidden-games-v1" => "Hidden flags".to_string(),
        "fav-games-v1" => "Favorites".to_string(),
        "game-custom-v4" => "Customizations".to_string(),
        "game-notes-v1" => "Notes".to_string(),
        "game-achievements-v1" => "Achievement tracker".to_string(),
        "collections-v1" => "Collections".to_string(),
        "launch-config-v1" => "Launch settings".to_string(),
        "recent-games-v1" => "Recent games".to_string(),
        "custom-order-v1" => "Custom order".to_string(),
        "session-log-v1" => "Session history".to_string(),
        "wishlist-v1" => "Wishlist".to_string(),
        "game-history-v1" => "Version history".to_string(),
        "libmaly_app_settings-v1" => "App settings".to_string(),
        _ => key.to_string(),
    }
}

fn count_snapshot_entry(raw: Option<&String>) -> usize {
    let Some(raw) = raw else {
        return 0;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return 1;
    };
    match parsed {
        serde_json::Value::Array(items) => items.len(),
        serde_json::Value::Object(map) => map.len(),
        serde_json::Value::Null => 0,
        _ => 1,
    }
}

fn build_snapshot_restore_report(
    current_entries: &HashMap<String, String>,
    snapshot: SnapshotContents,
) -> SnapshotRestoreReport {
    let snapshot_games = count_snapshot_entry(snapshot.entries.get("game-list-v2"));
    let snapshot_folders = count_snapshot_entry(snapshot.entries.get("library-folders-v1"));
    let mut keys = HashSet::<String>::new();
    for key in current_entries.keys() {
        keys.insert(key.clone());
    }
    for key in snapshot.entries.keys() {
        keys.insert(key.clone());
    }
    let mut sorted_keys: Vec<String> = keys.into_iter().collect();
    sorted_keys.sort();

    let mut items = Vec::<SnapshotPreviewItem>::new();
    let mut changed_count = 0usize;
    for key in sorted_keys {
        let current_raw = current_entries.get(&key);
        let snapshot_raw = snapshot.entries.get(&key);
        let status = if current_raw == snapshot_raw {
            "same"
        } else if snapshot_raw.is_none() {
            changed_count += 1;
            "missing_in_snapshot"
        } else if current_raw.is_none() {
            changed_count += 1;
            "new_in_snapshot"
        } else {
            changed_count += 1;
            "changed"
        };
        items.push(SnapshotPreviewItem {
            key: key.clone(),
            label: snapshot_entry_label(&key),
            status: status.to_string(),
            current_count: count_snapshot_entry(current_raw),
            snapshot_count: count_snapshot_entry(snapshot_raw),
        });
    }

    SnapshotRestoreReport {
        snapshot,
        items,
        changed_count,
        current_games: count_snapshot_entry(current_entries.get("game-list-v2")),
        snapshot_games,
        current_folders: count_snapshot_entry(current_entries.get("library-folders-v1")),
        snapshot_folders,
    }
}

fn detect_save_dirs(game_path: &str) -> Vec<PathBuf> {
    let game = PathBuf::from(game_path);
    let variants = name_variants_from_game_path(&game);

    let mut candidates = Vec::<PathBuf>::new();
    if let Some(parent) = game.parent() {
        for rel in [
            "save",
            "saves",
            "savedata",
            "save_data",
            "savegame",
            "savegames",
            "userdata",
            "www/save",
        ] {
            push_dir_if_exists_unique(&mut candidates, parent.join(rel));
        }
    }

    #[cfg(windows)]
    {
        let variants_lc: Vec<String> = variants.iter().map(|v| v.to_lowercase()).collect();
        if let Ok(appdata) = std::env::var("APPDATA") {
            let appdata = PathBuf::from(appdata);
            for v in &variants {
                push_dir_if_exists_unique(&mut candidates, appdata.join(v));
            }
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            for v in &variants {
                push_dir_if_exists_unique(&mut candidates, local.join(v));
            }
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let user = PathBuf::from(userprofile);
            for v in &variants {
                push_dir_if_exists_unique(&mut candidates, user.join("Documents").join("My Games").join(v));
                push_dir_if_exists_unique(&mut candidates, user.join("Documents").join(v));
                push_dir_if_exists_unique(&mut candidates, user.join("Saved Games").join(v));
            }
            let locallow = user.join("AppData").join("LocalLow");
            if locallow.exists() {
                if let Ok(companies) = std::fs::read_dir(&locallow) {
                    for company in companies.filter_map(|e| e.ok()) {
                        let company_path = company.path();
                        if !company_path.is_dir() {
                            continue;
                        }
                        if let Ok(games) = std::fs::read_dir(&company_path) {
                            for g in games.filter_map(|e| e.ok()) {
                                let gp = g.path();
                                if !gp.is_dir() {
                                    continue;
                                }
                                let leaf = gp
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string().to_lowercase())
                                    .unwrap_or_default();
                                if variants_lc.iter().any(|v| leaf.contains(v) || v.contains(&leaf)) {
                                    push_dir_if_exists_unique(&mut candidates, gp);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            for v in &variants {
                push_dir_if_exists_unique(&mut candidates, home.join(".local").join("share").join(v));
                push_dir_if_exists_unique(&mut candidates, home.join(".config").join(v));
                push_dir_if_exists_unique(&mut candidates, home.join(".renpy").join(v));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            for v in &variants {
                push_dir_if_exists_unique(
                    &mut candidates,
                    home.join("Library").join("Application Support").join(v),
                );
                push_dir_if_exists_unique(
                    &mut candidates,
                    home.join("Library").join("Preferences").join(v),
                );
                push_dir_if_exists_unique(&mut candidates, home.join("Library").join("RenPy").join(v));
            }
        }
    }

    candidates.into_iter().filter(|d| dir_has_files(d)).collect()
}

#[tauri::command]
fn backup_save_files(
    game_path: String,
    output_path: Option<String>,
) -> Result<SaveBackupResult, String> {
    build_save_backup_zip(&game_path, output_path.as_deref())
}

fn build_save_backup_zip(
    game_path: &str,
    output_path: Option<&str>,
) -> Result<SaveBackupResult, String> {
    let game = PathBuf::from(&game_path);
    let dirs = detect_save_dirs(game_path);
    if dirs.is_empty() {
        return Err("No common save directories were detected for this game.".to_string());
    }

    let zip_path = if let Some(out) = output_path {
        PathBuf::from(out)
    } else {
        let base = app_data_root().join("save-backups");
        std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        let label = game
            .file_stem()
            .map(|n| sanitize_name_for_filename(&n.to_string_lossy()))
            .unwrap_or_else(|| "game".to_string());
        base.join(format!("{}-{}.zip", label, now_ms()))
    };

    if let Some(parent) = zip_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut files_added = 0usize;
    for (idx, dir) in dirs.iter().enumerate() {
        let root_label = format!(
            "{:02}_{}",
            idx + 1,
            sanitize_name_for_filename(
                &dir.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "save".to_string())
            )
        );
        for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let rel = match entry.path().strip_prefix(dir) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let zip_name = format!(
                "{}/{}",
                root_label,
                rel.to_string_lossy().replace('\\', "/")
            );
            zip.start_file(zip_name, options).map_err(|e| e.to_string())?;
            let mut src = std::fs::File::open(entry.path()).map_err(|e| e.to_string())?;
            std::io::copy(&mut src, &mut zip).map_err(|e| e.to_string())?;
            files_added += 1;
        }
    }

    if files_added == 0 {
        return Err("Detected save folders contain no files to back up.".to_string());
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(SaveBackupResult {
        zip_path: zip_path.to_string_lossy().to_string(),
        files: files_added,
        directories: dirs
            .iter()
            .map(|d| d.to_string_lossy().to_string())
            .collect(),
    })
}

#[tauri::command]
fn detect_save_paths(
    game_path: String,
    engine: Option<String>,
    company_name: Option<String>,
    game_name: Option<String>,
) -> Vec<SavePathInfo> {
    save_transfer::detect_save_paths(&game_path, engine.as_deref(), company_name.as_deref(), game_name.as_deref())
}

#[tauri::command]
fn transfer_saves(
    source_path: String,
    target_path: String,
    create_backup: bool,
) -> Result<TransferResult, String> {
    save_transfer::transfer_saves(&source_path, &target_path, create_backup)
}

#[tauri::command]
fn is_valid_save_directory(path: String) -> bool {
    check_valid_save_directory(&path)
}

pub(crate) fn push_rust_log(app: Option<&AppHandle>, level: &str, message: impl Into<String>) {
    let entry = RustLogEntry {
        ts: now_ms(),
        level: level.to_string(),
        message: message.into(),
    };
    {
        let mut logs = rust_log_buffer().lock().unwrap();
        logs.push(entry.clone());
        if logs.len() > MAX_RUST_LOGS {
            let overflow = logs.len() - MAX_RUST_LOGS;
            logs.drain(0..overflow);
        }
    }
    if let Some(app_handle) = app {
        let _ = app_handle.emit("rust-log", &entry);
    }
}

fn parse_panic_payload(panic_info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "Unknown panic payload".to_string()
    }
}

fn write_crash_report(app: &AppHandle, report: &CrashReport) {
    let path = crash_report_path(app, CRASH_REPORT_FILE);
    if let Ok(json) = serde_json::to_string_pretty(report) {
        let _ = atomic_write_string(&path, &json, "crash_report");
    }
}

/// One entry in the directory-modification-time cache.
/// Stored by the frontend and passed back on next launch.
#[derive(Serialize, Deserialize, Clone)]
struct DirMtime {
    /// Absolute path of the directory
    path: String,
    /// Unix timestamp (seconds) of last known mtime
    mtime: u64,
}

fn is_blocked(name: &str, path_str: &str) -> bool {
    let n = name.to_lowercase();
    if n.contains("crashhandler")
        || n.contains("uninstall")
        || n.starts_with("unins")
        || n == "update"
        || n == "config"
        || n == "settings"
        || n.starts_with("dxsetup")
        || n.starts_with("vcredist")
        || n.starts_with("git-")
        || n.contains("setup")
        || n.contains("helper")
    {
        return true;
    }
    let p = path_str.to_lowercase();
    if p.contains("\\git\\")
        || p.contains("/git/")
        || p.contains("\\node_modules\\")
        || p.contains("/node_modules/")
    {
        return true;
    }
    false
}

fn dir_mtime(dir: &std::path::Path) -> u64 {
    dir.metadata()
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
        .unwrap_or(0)
}

/// Returns true when the exe stem is a generic engine/launcher name that gives
/// no useful info about the actual game (e.g. "Game", "nw", "app", "renpy").
/// In that case the scanner will prefer the parent folder name instead.
fn is_generic_name(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "game"
            | "start"
            | "play"
            | "launch"
            | "launcher"
            | "nw"
            | "nwjs"
            | "app"
            | "electron"
            | "main"
            | "run"
            | "exec"
            | "renpy"
            | "lib"
            | "engine"
            | "ux"
            | "client"
            | "project"
            | "visual_novel"
            | "vn"
    )
}

/// Collect every exe inside `dir` (non-recursive, single directory).
fn scan_dir_shallow(dir: &std::path::Path) -> Vec<Game> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        if p.extension().map(|e| e.to_string_lossy().to_lowercase()) != Some("exe".into()) {
            continue;
        }
        let name_raw = match p.file_stem() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        let path_str = p.to_string_lossy().into_owned();
        if is_blocked(&name_raw, &path_str) {
            continue;
        }
        if let Ok(meta) = p.metadata() {
            if meta.len() < 100 * 1024 {
                continue;
            }
        }
        // If the exe stem is a generic engine/launcher name (e.g. "Game", "nw",
        // "renpy"), prefer the parent folder name for a more descriptive title.
        // Example: D:\Games\072 project_Sonia\Game.exe  →  "072 project_Sonia"
        let name = if is_generic_name(&name_raw) {
            dir.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or(name_raw)
        } else {
            name_raw
        };
        out.push(Game {
            name,
            path: path_str,
        });
    }
    out
}

/// Full scan – walks the entire tree, returns games + directory mtime snapshot.
#[tauri::command]
fn scan_games(path: String) -> Result<(Vec<Game>, Vec<DirMtime>), String> {
    let root = std::path::Path::new(&path);
    let mut dir_mtimes: Vec<DirMtime> = Vec::new();
    let mut games: Vec<Game> = Vec::new();

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() {
            dir_mtimes.push(DirMtime {
                path: entry.path().to_string_lossy().into_owned(),
                mtime: dir_mtime(entry.path()),
            });
            let shallow = scan_dir_shallow(entry.path());
            games.extend(shallow);
        }
    }

    // Deduplicate by path
    games.sort_by(|a, b| a.path.cmp(&b.path));
    games.dedup_by(|a, b| a.path == b.path);

    Ok((games, dir_mtimes))
}

/// Incremental scan – only re-scans directories whose mtime changed or that are new.
/// Returns the merged, up-to-date games list plus a fresh mtime snapshot.
#[tauri::command]
fn scan_games_incremental(
    path: String,
    cached_games: Vec<Game>,
    cached_mtimes: Vec<DirMtime>,
) -> Result<(Vec<Game>, Vec<DirMtime>), String> {
    let root = std::path::Path::new(&path);

    // Build lookup: dir_path -> last known mtime
    let mtime_map: HashMap<String, u64> = cached_mtimes
        .into_iter()
        .map(|d| (d.path, d.mtime))
        .collect();

    // Build lookup: dir_path -> games that live in it (to evict stale ones)
    let mut cached_by_dir: HashMap<String, Vec<Game>> = HashMap::new();
    for g in cached_games {
        let dir = std::path::Path::new(&g.path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        cached_by_dir.entry(dir).or_default().push(g);
    }

    let mut new_mtimes: Vec<DirMtime> = Vec::new();
    let mut merged_games: Vec<Game> = Vec::new();

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() {
            continue;
        }
        let dir_path = entry.path();
        let dir_str = dir_path.to_string_lossy().into_owned();
        let current_mtime = dir_mtime(dir_path);

        new_mtimes.push(DirMtime {
            path: dir_str.clone(),
            mtime: current_mtime,
        });

        let known_mtime = mtime_map.get(&dir_str).copied().unwrap_or(0);
        if current_mtime != 0 && current_mtime == known_mtime {
            // Directory unchanged – reuse cached games for this dir
            if let Some(cached) = cached_by_dir.remove(&dir_str) {
                merged_games.extend(cached);
            }
        } else {
            // Directory is new or modified – re-scan it
            merged_games.extend(scan_dir_shallow(dir_path));
        }
    }

    merged_games.sort_by(|a, b| a.path.cmp(&b.path));
    merged_games.dedup_by(|a, b| a.path == b.path);

    Ok((merged_games, new_mtimes))
}

#[derive(Serialize, Clone)]
struct GameEndedPayload {
    path: String,
    duration_secs: u64,
    lifecycle: Option<ProcessLifecycleDiagnostic>,
}

#[tauri::command]
fn get_platform() -> &'static str {
    #[cfg(windows)]
    {
        "windows"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        "unknown"
    }
}

#[derive(Serialize)]
struct WineRunner {
    name: String,
    path: String,
    kind: String, // "wine" | "proton"
    flavor: Option<String>, // "official" | "ge"
}

#[tauri::command]
fn detect_wine_runners() -> Vec<WineRunner> {
    #[allow(unused_mut)]
    let mut runners: Vec<WineRunner> = Vec::new();
    #[cfg(not(windows))]
    let mut seen_paths: HashSet<String> = HashSet::new();

    #[cfg(not(windows))]
    {
        macro_rules! push_runner {
            ($name:expr, $path:expr, $kind:expr, $flavor:expr $(,)?) => {{
                let path: String = $path;
                if !path.is_empty() && seen_paths.insert(path.clone()) {
                    runners.push(WineRunner {
                        name: $name,
                        path,
                        kind: $kind.to_string(),
                        flavor: $flavor.map(|s: &str| s.to_string()),
                    });
                }
            }};
        }

        let home = std::env::var("HOME").unwrap_or_default();

        // ── Wine system binary ─────────────────────────────────────────────
        let wine_candidates = [
            "/usr/bin/wine",
            "/usr/local/bin/wine",
            "/opt/homebrew/bin/wine", // macOS Homebrew
            "/usr/bin/wine64",
        ];
        for c in &wine_candidates {
            if std::path::Path::new(c).exists() {
                push_runner!("Wine".to_string(), c.to_string(), "wine", None);
                break;
            }
        }
        // `which wine` fallback
        if runners.is_empty() {
            if let Ok(out) = Command::new("which").arg("wine").output() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    push_runner!("Wine (which)".to_string(), path, "wine", None);
                }
            }
        }

        // ── Steam Proton ───────────────────────────────────────────────────
        let steam_common_paths = [
            format!("{home}/.steam/steam/steamapps/common"),
            format!("{home}/.local/share/Steam/steamapps/common"),
            // macOS Steam
            format!("{home}/Library/Application Support/Steam/steamapps/common"),
        ];
        for steam_common in &steam_common_paths {
            let p = std::path::Path::new(steam_common);
            if !p.exists() {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(p) {
                let mut proton_dirs: Vec<_> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_name().to_string_lossy().starts_with("Proton"))
                    .collect();
                proton_dirs.sort_by_key(|e| e.file_name());
                proton_dirs.reverse(); // newest first
                for entry in proton_dirs {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let proton_bin = entry.path().join("proton");
                    if proton_bin.exists() {
                        let lower = name.to_lowercase();
                        let is_ge = lower.contains("ge-proton") || lower.contains("proton-ge");
                        push_runner!(
                            name.clone(),
                            proton_bin.to_string_lossy().to_string(),
                            "proton",
                            Some(if is_ge { "ge" } else { "official" }),
                        );
                    }
                }
            }
        }

        // ── Proton-GE via compatibilitytools.d ────────────────────────────
        let compat_tools_dirs = [
            format!("{home}/.steam/root/compatibilitytools.d"),
            format!("{home}/.steam/steam/compatibilitytools.d"),
            format!("{home}/.local/share/Steam/compatibilitytools.d"),
            format!("{home}/Library/Application Support/Steam/compatibilitytools.d"),
        ];
        for dir in &compat_tools_dirs {
            let root = std::path::Path::new(dir);
            if !root.exists() {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let proton_bin = path.join("proton");
                    if !proton_bin.exists() {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    let lower = name.to_lowercase();
                    let is_ge = lower.contains("ge-proton")
                        || lower.contains("proton-ge")
                        || lower.starts_with("ge-");
                    push_runner!(
                        name,
                        proton_bin.to_string_lossy().to_string(),
                        "proton",
                        Some(if is_ge { "ge" } else { "official" }),
                    );
                }
            }
        }
    }
    runners
}

#[derive(Serialize, Clone)]
struct PrefixMediaDiagnostics {
    has_media_foundation: bool,
    has_quartz: bool,
    has_wmp: bool,
    has_lavfilters: bool,
    has_wmv_decoder: bool,
    likely_video_playback_issue: bool,
    summary: String,
    notes: Vec<String>,
    recommended_verbs: Vec<String>,
}

#[derive(Serialize, Clone)]
struct PrefixInfo {
    name: String,
    path: String,
    kind: String, // "wine" | "proton"
    has_dxvk: bool,
    has_vkd3d: bool,
    media: PrefixMediaDiagnostics,
}

#[derive(Serialize, Clone)]
struct LutrisGameEntry {
    name: String,
    slug: String,
    exe: String,
    prefix: Option<String>,
    runner: Option<String>,
    args: Option<String>,
    config_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InteropGameEntry {
    name: String,
    game_id: String,
    exe: String,
    args: Option<String>,
    source: String, // "playnite" | "gog-galaxy"
    store_uri: Option<String>,
    source_url: Option<String>,
    cover_url: Option<String>,
    developer: Option<String>,
    version: Option<String>,
    overview: Option<String>,
}

#[cfg(windows)]
#[derive(Clone, Default)]
struct ProtocolStoreCandidate {
    name: String,
    game_id: String,
    exe: Option<String>,
    install_dir: Option<String>,
    args: Option<String>,
    source: String,
    store_uri: Option<String>,
}

#[cfg(windows)]
#[derive(Clone, Default)]
struct ExoticStoreCandidate {
    name: String,
    game_id: String,
    exe: Option<String>,
    install_dir: Option<String>,
    source: String,
    source_url: Option<String>,
    cover_url: Option<String>,
    developer: Option<String>,
    version: Option<String>,
    overview: Option<String>,
}

#[derive(Default)]
struct CloudPageMetadata {
    title: Option<String>,
    cover_url: Option<String>,
    overview: Option<String>,
    developer: Option<String>,
}

#[cfg(windows)]
fn normalize_windows_path(path: &str) -> String {
    path.trim().trim_matches('"').replace('/', "\\")
}

#[cfg(windows)]
fn path_exists_file(path: &str) -> bool {
    let p = std::path::Path::new(path);
    p.is_file()
}

#[cfg(windows)]
fn looks_executable(path: &std::path::Path) -> bool {
    path.extension()
        .map(|e| {
            matches!(
                e.to_string_lossy().to_lowercase().as_str(),
                "exe" | "bat" | "cmd" | "com" | "lnk"
            )
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn score_exe_candidate(path: &std::path::Path) -> i64 {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut score = 0i64;
    if !is_generic_name(&stem) {
        score += 30;
    }
    if let Ok(meta) = path.metadata() {
        score += (meta.len() / 1024) as i64;
    }
    let lower = path.to_string_lossy().to_lowercase();
    if lower.contains("unins") || lower.contains("crashhandler") || lower.contains("setup") {
        score -= 5000;
    }
    score
}

#[cfg(windows)]
fn find_best_exe_in_install_dir(install_dir: &str) -> Option<String> {
    let root = std::path::Path::new(install_dir);
    if !root.is_dir() {
        return None;
    }
    let mut best: Option<(i64, String)> = None;
    for entry in WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        if !looks_executable(p) {
            continue;
        }
        let score = score_exe_candidate(p);
        let s = p.to_string_lossy().to_string();
        match &best {
            Some((old, _)) if *old >= score => {}
            _ => best = Some((score, s)),
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(windows)]
fn candidate_from_paths(primary: Option<String>, install_dir: Option<String>) -> Option<String> {
    if let Some(raw) = primary {
        let p = normalize_windows_path(&raw);
        if !p.is_empty() {
            if path_exists_file(&p) {
                return Some(p);
            }
            if let Some(dir) = &install_dir {
                let joined = std::path::Path::new(dir).join(&p);
                if joined.is_file() {
                    return Some(joined.to_string_lossy().to_string());
                }
            }
        }
    }
    install_dir.and_then(|dir| find_best_exe_in_install_dir(&dir))
}

#[cfg(windows)]
fn clean_candidate_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }
    let without_icon_suffix = trimmed.split(',').next().unwrap_or(trimmed).trim();
    let normalized = normalize_windows_path(without_icon_suffix);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

#[cfg(windows)]
fn is_allowed_store_uri(uri: &str) -> bool {
    let lower = uri.trim().to_lowercase();
    [
        "origin://",
        "origin2://",
        "uplay://",
        "ubisoftconnect://",
        "rockstar-games-launcher://",
        "rockstargameslauncher://",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

fn open_uri_target(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", target])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        return Err("Opening launcher protocols is not supported on this platform".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn fallback_protocol_game_id(source: &str, name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            prev_dash = false;
            Some(ch.to_ascii_lowercase())
        } else if !prev_dash {
            prev_dash = true;
            Some('-')
        } else {
            None
        };
        if let Some(value) = mapped {
            out.push(value);
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        format!("{}-game", source)
    } else {
        out
    }
}

#[cfg(windows)]
fn extract_case_insensitive_segment<'a>(haystack: &'a str, needle: &str) -> Option<&'a str> {
    let lower = haystack.to_lowercase();
    let idx = lower.find(needle)?;
    Some(&haystack[idx + needle.len()..])
}

#[cfg(windows)]
fn take_token_while<F: Fn(char) -> bool>(text: &str, allow: F) -> String {
    text.chars().take_while(|ch| allow(*ch)).collect()
}

#[cfg(windows)]
fn build_protocol_store_uri(source: &str, game_id: &str) -> Option<String> {
    let game_id = game_id.trim();
    if game_id.is_empty() {
        return None;
    }
    match source {
        "ea-app" => Some(format!("origin2://game/launch?offerIds={}", game_id)),
        "ubisoft-connect" => Some(format!("uplay://launch/{}/0", game_id)),
        "rockstar" => Some(format!("rockstar-games-launcher://launch?gameId={}", game_id)),
        _ => None,
    }
}

#[cfg(windows)]
fn extract_ea_offer_id(text: &str) -> Option<String> {
    for needle in [
        "origin2://game/launch?offerids=",
        "origin2://launchgame/",
        "origin://launchgame/",
    ] {
        if let Some(rest) = extract_case_insensitive_segment(text, needle) {
            let token = take_token_while(rest, |ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, ':' | '-' | '_' | '.')
            });
            if !token.is_empty() {
                return Some(token);
            }
        }
    }
    None
}

#[cfg(windows)]
fn extract_uplay_game_id(text: &str) -> Option<String> {
    for needle in ["uplay://launch/", "uplay://install/"] {
        if let Some(rest) = extract_case_insensitive_segment(text, needle) {
            let token = take_token_while(rest, |ch| ch.is_ascii_digit());
            if !token.is_empty() {
                return Some(token);
            }
        }
    }
    None
}

#[cfg(windows)]
fn extract_rockstar_game_id(text: &str) -> Option<String> {
    for needle in [
        "rockstar-games-launcher://launch?gameid=",
        "rockstargameslauncher://launch?gameid=",
        "rockstar-games-launcher://launch/",
        "rockstargameslauncher://launch/",
    ] {
        if let Some(rest) = extract_case_insensitive_segment(text, needle) {
            let token = take_token_while(rest, |ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')
            });
            if !token.is_empty() {
                return Some(token);
            }
        }
    }
    None
}

#[cfg(windows)]
fn detect_protocol_store_source(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    if lower.contains("uplay://") || lower.contains("ubisoft") {
        return Some("ubisoft-connect");
    }
    if lower.contains("origin://")
        || lower.contains("origin2://")
        || lower.contains("electronic arts")
        || lower.contains("ea desktop")
    {
        return Some("ea-app");
    }
    if lower.contains("rockstar") {
        return Some("rockstar");
    }
    None
}

#[cfg(windows)]
fn extract_protocol_store_reference(text: &str) -> Option<(String, String, String)> {
    if let Some(game_id) = extract_uplay_game_id(text) {
        let uri = build_protocol_store_uri("ubisoft-connect", &game_id)?;
        return Some(("ubisoft-connect".to_string(), game_id, uri));
    }
    if let Some(game_id) = extract_ea_offer_id(text) {
        let uri = build_protocol_store_uri("ea-app", &game_id)?;
        return Some(("ea-app".to_string(), game_id, uri));
    }
    if let Some(game_id) = extract_rockstar_game_id(text) {
        let uri = build_protocol_store_uri("rockstar", &game_id)?;
        return Some(("rockstar".to_string(), game_id, uri));
    }
    None
}

#[cfg(windows)]
fn reg_value_string(key: &RegKey, value_name: &str) -> Option<String> {
    key.get_value::<String, _>(value_name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn insert_protocol_store_candidate(
    out: &mut HashMap<String, ProtocolStoreCandidate>,
    mut candidate: ProtocolStoreCandidate,
) {
    if candidate.source.is_empty() {
        return;
    }
    if candidate.game_id.trim().is_empty() {
        candidate.game_id = fallback_protocol_game_id(&candidate.source, &candidate.name);
    }
    let key = format!(
        "{}:{}",
        candidate.source,
        candidate.game_id.trim().to_lowercase()
    );
    let entry = out.entry(key).or_default();
    if entry.source.is_empty() {
        entry.source = candidate.source.clone();
    }
    if entry.name.is_empty() && !candidate.name.is_empty() {
        entry.name = candidate.name.clone();
    }
    if entry.game_id.is_empty() && !candidate.game_id.is_empty() {
        entry.game_id = candidate.game_id.clone();
    }
    if entry.exe.is_none() {
        entry.exe = candidate.exe.take();
    }
    if entry.install_dir.is_none() {
        entry.install_dir = candidate.install_dir.take();
    }
    if entry.args.is_none() {
        entry.args = candidate.args.take();
    }
    if entry.store_uri.is_none() {
        entry.store_uri = candidate.store_uri.take();
    }
}

#[cfg(windows)]
fn finalize_protocol_store_candidate(candidate: ProtocolStoreCandidate) -> Option<InteropGameEntry> {
    let exe = candidate_from_paths(candidate.exe, candidate.install_dir)?;
    let name = if candidate.name.trim().is_empty() {
        Path::new(&exe)
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| candidate.game_id.clone())
    } else {
        candidate.name
    };
    Some(InteropGameEntry {
        name,
        game_id: candidate.game_id,
        exe,
        args: candidate.args,
        source: candidate.source,
        store_uri: candidate.store_uri,
        source_url: None,
        cover_url: None,
        developer: None,
        version: None,
        overview: None,
    })
}

#[cfg(windows)]
fn extract_meta_content(document: &Html, attribute: &str, key: &str) -> Option<String> {
    let selector = Selector::parse("meta").ok()?;
    document.select(&selector).find_map(|node| {
        let value = node.value().attr(attribute)?;
        if !value.eq_ignore_ascii_case(key) {
            return None;
        }
        node.value()
            .attr("content")
            .map(str::trim)
            .filter(|content| !content.is_empty())
            .map(str::to_string)
    })
}

#[cfg(windows)]
fn extract_html_title(document: &Html) -> Option<String> {
    let selector = Selector::parse("title").ok()?;
    let text = document
        .select(&selector)
        .next()?
        .text()
        .collect::<String>()
        .trim()
        .to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(windows)]
fn normalize_lookup_token(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

#[cfg(windows)]
async fn fetch_cloud_page_metadata(url: &str) -> Result<CloudPageMetadata, String> {
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Metadata request failed for {url}: {}", response.status()));
    }
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read metadata body for {url}: {e}"))?;
    let document = Html::parse_document(&body);
    Ok(CloudPageMetadata {
        title: extract_meta_content(&document, "property", "og:title")
            .or_else(|| extract_meta_content(&document, "name", "twitter:title"))
            .or_else(|| extract_html_title(&document)),
        cover_url: extract_meta_content(&document, "property", "og:image")
            .or_else(|| extract_meta_content(&document, "name", "twitter:image")),
        overview: extract_meta_content(&document, "property", "og:description")
            .or_else(|| extract_meta_content(&document, "name", "description")),
        developer: extract_meta_content(&document, "name", "author"),
    })
}

#[cfg(windows)]
fn insert_exotic_store_candidate(
    out: &mut HashMap<String, ExoticStoreCandidate>,
    candidate: ExoticStoreCandidate,
) {
    let Some(exe) = candidate_from_paths(candidate.exe.clone(), candidate.install_dir.clone()) else {
        return;
    };
    let key = format!(
        "{}:{}",
        candidate.source.trim().to_lowercase(),
        normalize_windows_path(&exe).to_lowercase()
    );
    let entry = out.entry(key).or_default();
    if entry.source.is_empty() {
        entry.source = candidate.source.clone();
    }
    if entry.name.is_empty() && !candidate.name.trim().is_empty() {
        entry.name = candidate.name.clone();
    }
    if entry.game_id.is_empty() && !candidate.game_id.trim().is_empty() {
        entry.game_id = candidate.game_id.clone();
    }
    if entry.exe.is_none() {
        entry.exe = Some(exe);
    }
    if entry.install_dir.is_none() {
        entry.install_dir = candidate.install_dir.clone();
    }
    if entry.source_url.is_none() {
        entry.source_url = candidate.source_url.clone();
    }
    if entry.cover_url.is_none() {
        entry.cover_url = candidate.cover_url.clone();
    }
    if entry.developer.is_none() {
        entry.developer = candidate.developer.clone();
    }
    if entry.version.is_none() {
        entry.version = candidate.version.clone();
    }
    if entry.overview.is_none() {
        entry.overview = candidate.overview.clone();
    }
}

#[cfg(windows)]
fn finalize_exotic_store_candidate(candidate: ExoticStoreCandidate) -> Option<InteropGameEntry> {
    let exe = candidate_from_paths(candidate.exe, candidate.install_dir)?;
    let name = if candidate.name.trim().is_empty() {
        Path::new(&exe)
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| candidate.game_id.clone())
    } else {
        candidate.name
    };
    Some(InteropGameEntry {
        name,
        game_id: if candidate.game_id.trim().is_empty() {
            fallback_protocol_game_id(&candidate.source, &exe)
        } else {
            candidate.game_id
        },
        exe,
        args: None,
        source: candidate.source,
        store_uri: None,
        source_url: candidate.source_url,
        cover_url: candidate.cover_url,
        developer: candidate.developer,
        version: candidate.version,
        overview: candidate.overview,
    })
}

#[cfg(windows)]
fn battle_net_page_url_from_hint(game_id: &str, name: &str, install_dir: Option<&str>) -> Option<String> {
    let lookup = normalize_lookup_token(&format!("{} {} {}", game_id, name, install_dir.unwrap_or_default()));
    let known: &[(&[&str], &str)] = &[
        (&["overwatch", "pro"], "https://overwatch.blizzard.com/"),
        (&["diablo4", "diabloiv", "fen"], "https://diablo4.blizzard.com/"),
        (&["diablo3", "d3"], "https://diablo3.blizzard.com/"),
        (&["diablo2", "diabloii", "resurrected", "d2r", "rtro"], "https://diablo2.blizzard.com/"),
        (&["worldofwarcraft", "wow"], "https://worldofwarcraft.blizzard.com/"),
        (&["warcraft3", "warcraftiii", "w3"], "https://warcraft3.blizzard.com/"),
        (&["starcraft2", "starcraftii", "s2"], "https://starcraft2.blizzard.com/"),
        (&["starcraftremastered", "starcraft", "s1"], "https://starcraft.blizzard.com/"),
        (&["hearthstone", "wtcg"], "https://hearthstone.blizzard.com/"),
        (&["heroesofthestorm", "hero"], "https://heroesofthestorm.blizzard.com/"),
        (&["callofduty", "cod"], "https://www.callofduty.com/"),
    ];
    known.iter().find_map(|(aliases, url)| aliases.iter().any(|alias| lookup.contains(alias)).then(|| (*url).to_string()))
}

#[cfg(windows)]
fn guess_battle_net_game_id(name: &str, install_dir: Option<&str>, exe: Option<&str>) -> Option<String> {
    let lookup = normalize_lookup_token(&format!(
        "{} {} {}",
        name,
        install_dir.unwrap_or_default(),
        exe.unwrap_or_default()
    ));
    let known: &[(&[&str], &str)] = &[
        (&["overwatch"], "pro"),
        (&["diablo4", "diabloiv"], "fen"),
        (&["diablo3"], "d3"),
        (&["diablo2", "resurrected", "d2r"], "rtro"),
        (&["worldofwarcraft", "wow"], "wow"),
        (&["warcraft3", "warcraftiii"], "w3"),
        (&["starcraft2", "starcraftii"], "s2"),
        (&["starcraftremastered", "starcraft"], "s1"),
        (&["hearthstone"], "wtcg"),
        (&["heroesofthestorm"], "hero"),
        (&["callofduty"], "cod"),
    ];
    known.iter().find_map(|(aliases, code)| aliases.iter().any(|alias| lookup.contains(alias)).then(|| (*code).to_string()))
}

#[cfg(windows)]
fn find_build_info_near_install(install_dir: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(install_dir);
    let primary = dir.join(".build.info");
    if primary.is_file() {
        return Some(primary);
    }
    dir.parent()
        .map(|parent| parent.join(".build.info"))
        .filter(|path| path.is_file())
}

#[cfg(windows)]
fn parse_pipe_manifest_map(path: &Path) -> Option<HashMap<String, String>> {
    let raw = read_text_file_resilient(path).ok()?;
    let mut lines = raw.lines().filter(|line| line.contains('|'));
    let headers: Vec<String> = lines
        .next()?
        .split('|')
        .map(|value| value.trim().to_string())
        .collect();
    if headers.is_empty() {
        return None;
    }
    let values: Vec<String> = lines
        .find(|line| line.split('|').count() >= headers.len())?
        .split('|')
        .map(|value| value.trim().to_string())
        .collect();
    let mut out = HashMap::new();
    for (idx, header) in headers.iter().enumerate() {
        if let Some(value) = values.get(idx) {
            out.insert(header.clone(), value.clone());
        }
    }
    Some(out)
}

#[cfg(windows)]
fn manifest_value_ci(map: &HashMap<String, String>, key: &str) -> Option<String> {
    map.iter().find_map(|(candidate, value)| {
        candidate
            .eq_ignore_ascii_case(key)
            .then(|| value.trim().to_string())
            .filter(|text| !text.is_empty())
    })
}

#[cfg(windows)]
fn collect_battle_net_registry_candidates(out: &mut HashMap<String, ExoticStoreCandidate>) {
    let roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (root, path) in roots {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for subkey_name in key.enum_keys().flatten() {
            let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            let display_name = reg_value_string(&subkey, "DisplayName").unwrap_or_default();
            let publisher = reg_value_string(&subkey, "Publisher").unwrap_or_default();
            let name_lc = display_name.to_lowercase();
            let publisher_lc = publisher.to_lowercase();
            let matches_bnet = publisher_lc.contains("blizzard")
                || name_lc.contains("diablo")
                || name_lc.contains("warcraft")
                || name_lc.contains("starcraft")
                || name_lc.contains("overwatch")
                || name_lc.contains("hearthstone")
                || name_lc.contains("heroes of the storm")
                || name_lc.contains("call of duty");
            if !matches_bnet || (name_lc.contains("battle.net") && !name_lc.contains("call of duty")) {
                continue;
            }
            let install_dir = reg_value_string(&subkey, "InstallLocation")
                .map(|value| normalize_windows_path(&value))
                .filter(|value| !value.is_empty());
            let exe = reg_value_string(&subkey, "DisplayIcon").and_then(|value| clean_candidate_path(&value));
            let manifest = install_dir
                .as_deref()
                .and_then(find_build_info_near_install)
                .and_then(|path| parse_pipe_manifest_map(&path));
            let game_id = manifest
                .as_ref()
                .and_then(|map| manifest_value_ci(map, "Product"))
                .or_else(|| manifest.as_ref().and_then(|map| manifest_value_ci(map, "ProductCode")))
                .or_else(|| guess_battle_net_game_id(&display_name, install_dir.as_deref(), exe.as_deref()))
                .unwrap_or_else(|| fallback_protocol_game_id("battle-net", &display_name));
            let version = manifest
                .as_ref()
                .and_then(|map| manifest_value_ci(map, "Version"))
                .or_else(|| manifest.as_ref().and_then(|map| manifest_value_ci(map, "Build Key")));
            let source_url = battle_net_page_url_from_hint(&game_id, &display_name, install_dir.as_deref());
            insert_exotic_store_candidate(
                out,
                ExoticStoreCandidate {
                    name: display_name,
                    game_id: game_id.clone(),
                    exe,
                    install_dir: install_dir.clone(),
                    source: "battle-net".to_string(),
                    source_url,
                    cover_url: None,
                    developer: if publisher.trim().is_empty() { None } else { Some(publisher) },
                    version,
                    overview: None,
                },
            );
        }
    }
}

#[cfg(windows)]
fn gamejolt_manifest_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(&local).join("GameJolt"));
        roots.push(PathBuf::from(&local).join("gamejolt-client"));
    }
    if let Some(roaming) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(&roaming).join("GameJolt"));
        roots.push(PathBuf::from(&roaming).join("gamejolt-client"));
    }
    roots.into_iter().filter(|path| path.exists()).collect()
}

#[cfg(windows)]
fn looks_like_gamejolt_manifest_file(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    extension == "json"
        && ["game", "library", "install", "manifest", "package", "state"]
            .iter()
            .any(|needle| file_name.contains(needle))
}

#[cfg(windows)]
fn derive_gamejolt_source_url(value: &Value) -> Option<String> {
    let explicit = json_string_field(value, &["url", "web_url", "webUrl", "source_url", "sourceUrl"])
        .or_else(|| json_nested_string_field(value, &["game", "url"]));
    if let Some(url) = explicit {
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url);
        }
    }
    let slug = json_string_field(value, &["slug", "game_slug", "gameSlug"])
        .or_else(|| json_nested_string_field(value, &["game", "slug"]));
    let game_id = json_string_field(value, &["game_id", "gameId", "id"])
        .or_else(|| json_nested_string_field(value, &["game", "id"]));
    match (slug, game_id) {
        (Some(slug), Some(game_id)) => Some(format!("https://gamejolt.com/games/{}/{}", slug.trim(), game_id.trim())),
        (Some(slug), None) => Some(format!("https://gamejolt.com/games/{}", slug.trim())),
        _ => None,
    }
}

#[cfg(windows)]
fn parse_gamejolt_candidate(value: &Value) -> Option<ExoticStoreCandidate> {
    let title = json_string_field(value, &["title", "name", "gameTitle", "game_name"])
        .or_else(|| json_nested_string_field(value, &["game", "title"]))
        .or_else(|| json_nested_string_field(value, &["game", "name"]));
    let install_dir = json_string_field(value, &["install_dir", "installDir", "install_path", "installPath", "path", "installLocation"])
        .or_else(|| json_nested_string_field(value, &["install", "path"]))
        .or_else(|| json_nested_string_field(value, &["path", "absolute"]))
        .map(|value| normalize_windows_path(&value))
        .filter(|value| !value.is_empty());
    let exe_hint = json_string_field(value, &["exe", "executable", "launchExe", "launchExecutable", "executablePath"])
        .or_else(|| json_nested_string_field(value, &["install", "executable"]));
    let resolved_exe = candidate_from_paths(exe_hint, install_dir.clone());
    if resolved_exe.is_none() {
        return None;
    }
    let game_id = json_string_field(value, &["game_id", "gameId", "id"])
        .or_else(|| json_nested_string_field(value, &["game", "id"]))
        .or_else(|| json_string_field(value, &["slug", "game_slug", "gameSlug"]))
        .or_else(|| title.clone().map(|value| fallback_protocol_game_id("gamejolt", &value)))?;
    Some(ExoticStoreCandidate {
        name: title.unwrap_or_else(|| format!("GameJolt {}", game_id)),
        game_id,
        exe: resolved_exe,
        install_dir,
        source: "gamejolt".to_string(),
        source_url: derive_gamejolt_source_url(value),
        cover_url: json_string_field(value, &["cover_url", "coverUrl", "thumbnail", "image"])
            .or_else(|| json_nested_string_field(value, &["game", "thumbnail"])),
        developer: json_string_field(value, &["developer", "author", "studio"])
            .or_else(|| json_nested_string_field(value, &["game", "developer"])),
        version: json_string_field(value, &["version", "buildVersion", "build_version"]),
        overview: json_string_field(value, &["description", "summary", "overview"]),
    })
}

#[cfg(windows)]
fn collect_gamejolt_candidates_from_value(value: &Value, out: &mut HashMap<String, ExoticStoreCandidate>) {
    if let Some(candidate) = parse_gamejolt_candidate(value) {
        insert_exotic_store_candidate(out, candidate);
    }
    match value {
        Value::Array(items) => {
            for item in items {
                collect_gamejolt_candidates_from_value(item, out);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_gamejolt_candidates_from_value(item, out);
            }
        }
        _ => {}
    }
}

#[cfg(windows)]
fn collect_gamejolt_manifest_candidates(out: &mut HashMap<String, ExoticStoreCandidate>) {
    for root in gamejolt_manifest_roots() {
        for entry in WalkDir::new(root)
            .max_depth(6)
            .into_iter()
            .filter_map(|entry| entry.ok())
        {
            if !entry.file_type().is_file() || !looks_like_gamejolt_manifest_file(entry.path()) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.len() > 8 * 1024 * 1024 {
                continue;
            }
            let Ok(raw) = read_text_file_resilient(entry.path()) else {
                continue;
            };
            let trimmed = raw.trim_start();
            if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
                continue;
            }
            let Ok(json) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            collect_gamejolt_candidates_from_value(&json, out);
        }
    }
}

#[cfg(windows)]
fn collect_protocol_store_uninstall_candidates() -> HashMap<String, ProtocolStoreCandidate> {
    let mut out = HashMap::new();
    let roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (root, path) in roots {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for subkey_name in key.enum_keys().flatten() {
            let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            let display_name = reg_value_string(&subkey, "DisplayName").unwrap_or_default();
            let publisher = reg_value_string(&subkey, "Publisher").unwrap_or_default();
            let install_location = reg_value_string(&subkey, "InstallLocation");
            let display_icon = reg_value_string(&subkey, "DisplayIcon");
            let uninstall_string = reg_value_string(&subkey, "UninstallString").unwrap_or_default();
            let combined = format!(
                "{}\n{}\n{}\n{}\n{}",
                display_name,
                publisher,
                install_location.clone().unwrap_or_default(),
                display_icon.clone().unwrap_or_default(),
                uninstall_string
            );
            let source = extract_protocol_store_reference(&combined)
                .map(|(source, _, _)| source)
                .or_else(|| detect_protocol_store_source(&combined).map(str::to_string));
            let Some(source) = source else {
                continue;
            };
            let (game_id, store_uri) = match extract_protocol_store_reference(&combined) {
                Some((_, game_id, uri)) => (game_id, Some(uri)),
                None => (fallback_protocol_game_id(&source, &display_name), None),
            };
            let exe = display_icon.as_deref().and_then(clean_candidate_path);
            let install_dir = install_location.and_then(|value| {
                let cleaned = normalize_windows_path(&value);
                if cleaned.is_empty() {
                    None
                } else {
                    Some(cleaned)
                }
            });
            insert_protocol_store_candidate(
                &mut out,
                ProtocolStoreCandidate {
                    name: display_name,
                    game_id,
                    exe,
                    install_dir,
                    args: None,
                    source,
                    store_uri,
                },
            );
        }
    }
    out
}

#[cfg(windows)]
fn collect_ubisoft_registry_candidates(out: &mut HashMap<String, ProtocolStoreCandidate>) {
    let roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Ubisoft\Launcher\Installs"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Ubisoft\Launcher\Installs"),
    ];
    for (root, path) in roots {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for subkey_name in key.enum_keys().flatten() {
            let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            let install_dir = reg_value_string(&subkey, "InstallDir")
                .or_else(|| reg_value_string(&subkey, "InstallLocation"))
                .map(|value| normalize_windows_path(&value));
            let name = reg_value_string(&subkey, "DisplayName")
                .or_else(|| reg_value_string(&subkey, "GameName"))
                .unwrap_or_else(|| format!("Ubisoft {}", subkey_name));
            insert_protocol_store_candidate(
                out,
                ProtocolStoreCandidate {
                    name,
                    game_id: subkey_name.clone(),
                    exe: None,
                    install_dir,
                    args: None,
                    source: "ubisoft-connect".to_string(),
                    store_uri: build_protocol_store_uri("ubisoft-connect", &subkey_name),
                },
            );
        }
    }
}

#[cfg(windows)]
fn extract_xml_tag_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let lower = xml.to_lowercase();
    let start = lower.find(&open.to_lowercase())? + open.len();
    let end = lower[start..].find(&close.to_lowercase())? + start;
    let value = xml[start..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(windows)]
fn extract_xml_attribute_value(xml: &str, attribute: &str) -> Option<String> {
    let lower = xml.to_lowercase();
    for quote in ['"', '\''] {
        let needle = format!("{}=", attribute);
        let Some(idx) = lower.find(&needle.to_lowercase()) else {
            continue;
        };
        let tail = &xml[idx + needle.len()..].trim_start();
        if !tail.starts_with(quote) {
            continue;
        }
        let end = tail[1..].find(quote)? + 1;
        let value = tail[1..end].trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

#[cfg(windows)]
fn collect_origin_local_content_candidates(out: &mut HashMap<String, ProtocolStoreCandidate>) {
    let Some(program_data) = std::env::var_os("ProgramData") else {
        return;
    };
    let root = PathBuf::from(program_data).join("Origin").join("LocalContent");
    if !root.is_dir() {
        return;
    }
    for entry in WalkDir::new(&root)
        .max_depth(4)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        if !entry.file_type().is_file() || entry.file_name().to_string_lossy().to_lowercase() != "local.xml" {
            continue;
        }
        let Ok(xml) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        let game_id = extract_xml_tag_text(&xml, "contentid")
            .or_else(|| extract_xml_attribute_value(&xml, "offerId"))
            .or_else(|| extract_ea_offer_id(&xml));
        let Some(game_id) = game_id else {
            continue;
        };
        let name = extract_xml_tag_text(&xml, "displayname")
            .or_else(|| extract_xml_tag_text(&xml, "title"))
            .unwrap_or_else(|| {
                entry
                    .path()
                    .parent()
                    .and_then(|parent| parent.file_name())
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| game_id.clone())
            });
        let install_dir = extract_xml_tag_text(&xml, "installedpath")
            .or_else(|| extract_xml_tag_text(&xml, "installpath"))
            .map(|value| normalize_windows_path(&value));
        insert_protocol_store_candidate(
            out,
            ProtocolStoreCandidate {
                name,
                game_id: game_id.clone(),
                exe: None,
                install_dir,
                args: None,
                source: "ea-app".to_string(),
                store_uri: build_protocol_store_uri("ea-app", &game_id),
            },
        );
    }
}

#[cfg(windows)]
fn collect_rockstar_registry_candidates(out: &mut HashMap<String, ProtocolStoreCandidate>) {
    let roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Rockstar Games"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Rockstar Games"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Rockstar Games"),
    ];
    for (root, path) in roots {
        let Ok(key) = RegKey::predef(root).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for subkey_name in key.enum_keys().flatten() {
            let lower_name = subkey_name.to_lowercase();
            if lower_name.contains("launcher") || lower_name.contains("social club") {
                continue;
            }
            let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            let name = reg_value_string(&subkey, "Title")
                .or_else(|| reg_value_string(&subkey, "DisplayName"))
                .unwrap_or_else(|| subkey_name.clone());
            let exe = reg_value_string(&subkey, "Executable")
                .or_else(|| reg_value_string(&subkey, "ExePath"))
                .and_then(|value| clean_candidate_path(&value));
            let install_dir = reg_value_string(&subkey, "InstallFolder")
                .or_else(|| reg_value_string(&subkey, "InstallDir"))
                .or_else(|| reg_value_string(&subkey, "Path"))
                .map(|value| normalize_windows_path(&value));
            let combined = format!(
                "{}\n{}\n{}",
                name,
                exe.clone().unwrap_or_default(),
                install_dir.clone().unwrap_or_default()
            );
            let (game_id, store_uri) = match extract_protocol_store_reference(&combined) {
                Some((_, game_id, uri)) => (game_id, Some(uri)),
                None => (fallback_protocol_game_id("rockstar", &name), None),
            };
            insert_protocol_store_candidate(
                out,
                ProtocolStoreCandidate {
                    name,
                    game_id,
                    exe,
                    install_dir,
                    args: None,
                    source: "rockstar".to_string(),
                    store_uri,
                },
            );
        }
    }
}

#[tauri::command]
#[cfg(windows)]
fn import_protocol_store_games() -> Result<Vec<InteropGameEntry>, String> {
    let mut candidates = collect_protocol_store_uninstall_candidates();
    collect_ubisoft_registry_candidates(&mut candidates);
    collect_origin_local_content_candidates(&mut candidates);
    collect_rockstar_registry_candidates(&mut candidates);

    let mut entries: Vec<InteropGameEntry> = candidates
        .into_values()
        .filter_map(finalize_protocol_store_candidate)
        .collect();
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries.dedup_by(|a, b| {
        a.source == b.source
            && a.game_id.eq_ignore_ascii_case(&b.game_id)
            && a.exe.eq_ignore_ascii_case(&b.exe)
    });
    Ok(entries)
}

#[tauri::command]
#[cfg(not(windows))]
fn import_protocol_store_games() -> Result<Vec<InteropGameEntry>, String> {
    Ok(Vec::new())
}

#[tauri::command]
#[cfg(windows)]
async fn import_exotic_store_games() -> Result<Vec<InteropGameEntry>, String> {
    let mut candidates = HashMap::<String, ExoticStoreCandidate>::new();
    collect_battle_net_registry_candidates(&mut candidates);
    collect_gamejolt_manifest_candidates(&mut candidates);

    let mut entries: Vec<InteropGameEntry> = candidates
        .into_values()
        .filter_map(finalize_exotic_store_candidate)
        .collect();

    for entry in &mut entries {
        let Some(url) = entry.source_url.clone() else {
            continue;
        };
        if let Ok(page) = fetch_cloud_page_metadata(&url).await {
            if let Some(title) = page.title {
                if entry.name.trim().is_empty()
                    || entry.name.eq_ignore_ascii_case(&entry.game_id)
                    || entry.name.starts_with("GameJolt ")
                    || entry.name.starts_with("Battle.net ")
                {
                    entry.name = title;
                }
            }
            if entry.cover_url.is_none() {
                entry.cover_url = page.cover_url;
            }
            if entry.overview.is_none() {
                entry.overview = page.overview;
            }
            if entry.developer.is_none() {
                entry.developer = page.developer;
            }
        }
    }

    entries.sort_by(|a, b| {
        a.source
            .to_lowercase()
            .cmp(&b.source.to_lowercase())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries.dedup_by(|a, b| a.source == b.source && a.exe.eq_ignore_ascii_case(&b.exe));
    Ok(entries)
}

#[tauri::command]
#[cfg(not(windows))]
async fn import_exotic_store_games() -> Result<Vec<InteropGameEntry>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
fn is_wine_prefix_dir(path: &std::path::Path) -> bool {
    path.join("drive_c").is_dir() && path.join("system.reg").is_file()
}

#[cfg(not(windows))]
fn detect_prefix_graphics(prefix: &std::path::Path) -> (bool, bool) {
    let sys32 = prefix.join("drive_c").join("windows").join("system32");
    let wow64 = prefix.join("drive_c").join("windows").join("syswow64");
    let has_any = |dll: &str| sys32.join(dll).is_file() || wow64.join(dll).is_file();
    let has_dxvk = has_any("dxgi.dll") && (has_any("d3d11.dll") || has_any("d3d9.dll"));
    let has_vkd3d = has_any("d3d12.dll");
    (has_dxvk, has_vkd3d)
}

#[cfg(not(windows))]
fn detect_prefix_media(prefix: &std::path::Path) -> PrefixMediaDiagnostics {
    let sys32 = prefix.join("drive_c").join("windows").join("system32");
    let wow64 = prefix.join("drive_c").join("windows").join("syswow64");
    let has_any = |name: &str| sys32.join(name).is_file() || wow64.join(name).is_file();
    let has_media_foundation = has_any("mfplat.dll") || has_any("mf.dll") || has_any("mfreadwrite.dll");
    let has_quartz = has_any("quartz.dll");
    let has_wmp = has_any("wmp.dll")
        || has_any("wmvcore.dll")
        || prefix
            .join("drive_c")
            .join("Program Files")
            .join("Windows Media Player")
            .join("wmplayer.exe")
            .is_file()
        || prefix
            .join("drive_c")
            .join("Program Files (x86)")
            .join("Windows Media Player")
            .join("wmplayer.exe")
            .is_file();
    let has_lavfilters = has_any("lavsplitter.ax") || has_any("lavvideo.ax") || has_any("lavaudio.ax");
    let has_wmv_decoder = has_any("wmvcore.dll");

    let mut notes = Vec::<String>::new();
    let mut recommended_verbs = Vec::<String>::new();

    if !has_media_foundation {
        notes.push("Media Foundation DLLs are missing; many intro movies and newer in-engine cutscenes may fail or show corrupted output.".to_string());
        recommended_verbs.push("mf".to_string());
    }
    if !has_quartz {
        notes.push("Quartz/DirectShow is missing; older Windows Media Player pipelines may not initialize video playback.".to_string());
        recommended_verbs.push("quartz".to_string());
    }
    if !has_wmp {
        notes.push("Windows Media Player components look incomplete; legacy WMV/WMA-backed videos may not decode correctly.".to_string());
        recommended_verbs.push("wmp11".to_string());
    }
    if !has_lavfilters {
        notes.push("LAV Filters are not present; they can help with older or unusual video playback paths in Wine prefixes.".to_string());
        recommended_verbs.push("lavfilters".to_string());
    }
    if !has_wmv_decoder {
        notes.push("WMV decoder components are missing; this often shows up as a black screen or 'rainbow' intro video.".to_string());
    }

    let likely_video_playback_issue = !has_media_foundation || !has_quartz || !has_wmp || !has_wmv_decoder;
    let summary = if likely_video_playback_issue {
        "Potential intro/video playback compatibility gaps detected".to_string()
    } else if has_lavfilters {
        "Media playback components look healthy".to_string()
    } else {
        "Core media playback looks usable, but extra fallback filters are missing".to_string()
    };

    recommended_verbs.sort();
    recommended_verbs.dedup();

    PrefixMediaDiagnostics {
        has_media_foundation,
        has_quartz,
        has_wmp,
        has_lavfilters,
        has_wmv_decoder,
        likely_video_playback_issue,
        summary,
        notes,
        recommended_verbs,
    }
}

#[tauri::command]
fn list_wine_prefixes() -> Vec<PrefixInfo> {
    #[cfg(windows)]
    {
        Vec::new()
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let mut candidates: Vec<(String, std::path::PathBuf, String)> = Vec::new();
        let mut seen_paths: HashSet<String> = HashSet::new();

        let push_candidate = |items: &mut Vec<(String, std::path::PathBuf, String)>,
                              seen: &mut HashSet<String>,
                              name: String,
                              path: std::path::PathBuf,
                              kind: &str| {
            let key = path.to_string_lossy().to_string();
            if seen.insert(key) {
                items.push((name, path, kind.to_string()));
            }
        };

        // Classic default prefix.
        let default_prefix = std::path::PathBuf::from(format!("{home}/.wine"));
        if default_prefix.exists() {
            push_candidate(
                &mut candidates,
                &mut seen_paths,
                ".wine".to_string(),
                default_prefix,
                "wine",
            );
        }

        // User-managed Wine prefixes.
        let wine_prefix_roots = [
            format!("{home}/.local/share/wineprefixes"),
            format!("{home}/.wineprefixes"),
            format!("{home}/Games"),
        ];
        for root in &wine_prefix_roots {
            let root_path = std::path::Path::new(root);
            if !root_path.exists() {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(root_path) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if !p.is_dir() {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    if is_wine_prefix_dir(&p) {
                        push_candidate(&mut candidates, &mut seen_paths, name, p, "wine");
                    } else {
                        let nested = p.join("prefix");
                        if is_wine_prefix_dir(&nested) {
                            push_candidate(&mut candidates, &mut seen_paths, name, nested, "wine");
                        }
                    }
                }
            }
        }

        // Steam compatdata prefixes (Proton).
        let compat_roots = [
            format!("{home}/.steam/steam/steamapps/compatdata"),
            format!("{home}/.local/share/Steam/steamapps/compatdata"),
            format!("{home}/Library/Application Support/Steam/steamapps/compatdata"),
        ];
        for root in &compat_roots {
            let root_path = std::path::Path::new(root);
            if !root_path.exists() {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(root_path) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let pfx = entry.path().join("pfx");
                    if !is_wine_prefix_dir(&pfx) {
                        continue;
                    }
                    let app_id = entry.file_name().to_string_lossy().to_string();
                    let name = format!("compatdata/{app_id}");
                    push_candidate(&mut candidates, &mut seen_paths, name, pfx, "proton");
                }
            }
        }

        let mut out: Vec<PrefixInfo> = candidates
            .into_iter()
            .filter_map(|(name, path, kind)| {
                if !is_wine_prefix_dir(&path) {
                    return None;
                }
                let (has_dxvk, has_vkd3d) = detect_prefix_graphics(&path);
                let media = detect_prefix_media(&path);
                Some(PrefixInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    kind,
                    has_dxvk,
                    has_vkd3d,
                    media,
                })
            })
            .collect();

        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }
}

#[tauri::command]
fn create_wine_prefix(path: String, runner: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = (path, runner);
        Err("Wine prefixes are not supported on Windows".to_string())
    }
    #[cfg(not(windows))]
    {
        let target = std::path::Path::new(&path);
        if path.trim().is_empty() {
            return Err("Prefix path is empty".to_string());
        }
        std::fs::create_dir_all(target).map_err(|e| e.to_string())?;

        let runner_cmd = runner.unwrap_or_else(|| "wineboot".to_string());
        let is_proton = std::path::Path::new(&runner_cmd)
            .file_name()
            .map(|n| n.to_string_lossy().eq_ignore_ascii_case("proton"))
            .unwrap_or(false);
        let mut cmd = Command::new(&runner_cmd);
        if is_proton {
            // For proton, this should point to compatdata dir (contains pfx after init).
            cmd.arg("run").arg("wineboot");
            cmd.env("STEAM_COMPAT_DATA_PATH", &path);
        } else {
            if std::path::Path::new(&runner_cmd)
                .file_name()
                .map(|n| n.to_string_lossy().contains("wine"))
                .unwrap_or(false)
            {
                cmd.arg("-u");
            }
            cmd.env("WINEPREFIX", &path);
        }

        let out = cmd.output().map_err(|e| format!("Failed to run wineboot: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                "Failed to initialize prefix".to_string()
            } else {
                err
            });
        }
        Ok(())
    }
}

#[tauri::command]
fn delete_wine_prefix(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = path;
        Err("Wine prefixes are not supported on Windows".to_string())
    }
    #[cfg(not(windows))]
    {
        if path.trim().is_empty() {
            return Err("Prefix path is empty".to_string());
        }
        let p = std::path::Path::new(&path);
        if !p.exists() {
            return Ok(());
        }
        if p.parent().is_none() {
            return Err("Refusing to delete root directory".to_string());
        }
        if !is_wine_prefix_dir(p) {
            return Err("The selected path does not look like a Wine prefix".to_string());
        }
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(not(windows))]
fn run_winetricks_for_prefix(prefix: &str, verbs: &[String]) -> Result<String, String> {
    if verbs.is_empty() {
        return Err("No verbs provided".to_string());
    }
    let mut cmd = Command::new("winetricks");
    cmd.arg("-q");
    for v in verbs {
        cmd.arg(v);
    }
    cmd.env("WINEPREFIX", prefix);
    let out = cmd
        .output()
        .map_err(|e| format!("Failed to run winetricks: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let mut msg = String::new();
        if !stderr.is_empty() {
            msg.push_str(&stderr);
        }
        if !stdout.is_empty() {
            if !msg.is_empty() {
                msg.push_str("\n--- stdout ---\n");
            }
            msg.push_str(&stdout);
        }
        Err(if msg.is_empty() {
            "winetricks failed (no output)".to_string()
        } else {
            msg
        })
    }
}

#[tauri::command]
fn run_winetricks(prefix: String, verbs: Vec<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        let _ = (prefix, verbs);
        Err("Winetricks is not available on Windows".to_string())
    }
    #[cfg(not(windows))]
    {
        run_winetricks_for_prefix(&prefix, &verbs)
    }
}

#[tauri::command]
fn install_dxvk_vkd3d(
    prefix: String,
    install_dxvk: bool,
    install_vkd3d: bool,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        let _ = (prefix, install_dxvk, install_vkd3d);
        Err("DXVK/VKD3D installer is not available on Windows".to_string())
    }
    #[cfg(not(windows))]
    {
        let mut verbs: Vec<String> = Vec::new();
        if install_dxvk {
            verbs.push("dxvk".to_string());
        }
        if install_vkd3d {
            verbs.push("vkd3d".to_string());
        }
        if verbs.is_empty() {
            return Err("Nothing selected to install".to_string());
        }
        run_winetricks_for_prefix(&prefix, &verbs)
    }
}

#[tauri::command]
fn install_prefix_media_fixes(prefix: String, verbs: Option<Vec<String>>) -> Result<String, String> {
    #[cfg(windows)]
    {
        let _ = (prefix, verbs);
        Err("Wine media fixes are not available on Windows".to_string())
    }
    #[cfg(not(windows))]
    {
        let prefix_path = std::path::Path::new(&prefix);
        if !is_wine_prefix_dir(prefix_path) {
            return Err("The selected path does not look like a Wine prefix".to_string());
        }
        let mut selected = verbs.unwrap_or_else(|| detect_prefix_media(prefix_path).recommended_verbs);
        selected.retain(|verb| !verb.trim().is_empty());
        selected.sort();
        selected.dedup();
        if selected.is_empty() {
            return Err("No media fixes are recommended for this prefix".to_string());
        }
        run_winetricks_for_prefix(&prefix, &selected)
    }
}

// ─── DXVK / Steam shader cache (Linux & macOS) ────────────────────────────────

#[derive(Serialize, Clone)]
pub struct ShaderCacheArtifact {
    pub path: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct ShaderCacheDiscovery {
    pub game_exe_path: String,
    pub game_dir: String,
    pub dxvk_caches: Vec<ShaderCacheArtifact>,
    pub steam_app_id: Option<String>,
    pub steam_shader_cache_path: Option<String>,
    pub steam_shader_cache_bytes: u64,
    pub steam_shader_cache_files: u64,
    pub hints: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ShaderCacheExportResult {
    pub zip_path: String,
    pub dxvk_files_packed: u64,
    pub steam_files_packed: u64,
}

#[cfg(not(windows))]
fn steam_shadercache_roots() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        PathBuf::from(format!("{home}/.local/share/Steam/steamapps/shadercache")),
        PathBuf::from(format!("{home}/.steam/steam/steamapps/shadercache")),
        PathBuf::from(format!(
            "{home}/Library/Application Support/Steam/steamapps/shadercache"
        )),
    ]
}

#[cfg(not(windows))]
fn resolve_steam_shadercache_dir(app_id: &str) -> Option<PathBuf> {
    let id = app_id.trim();
    if id.is_empty() {
        return None;
    }
    for root in steam_shadercache_roots() {
        let p = root.join(id);
        if p.is_dir() {
            return Some(p);
        }
    }
    None
}

#[cfg(not(windows))]
fn dir_tree_stats(path: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    if !path.is_dir() {
        return (0, 0);
    }
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            files += 1;
            if let Ok(m) = entry.metadata() {
                bytes += m.len();
            }
        }
    }
    (bytes, files)
}

#[cfg(not(windows))]
fn collect_dxvk_caches(game_exe: &Path) -> Result<Vec<ShaderCacheArtifact>, String> {
    let mut out = Vec::new();
    let dir = game_exe
        .parent()
        .ok_or_else(|| "Game path has no parent directory".to_string())?;
    let dir = dir.to_path_buf();
    if !dir.is_dir() {
        return Err("Game directory does not exist".to_string());
    }
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.extension()
            .map(|x| x.eq_ignore_ascii_case("dxvk-cache"))
            .unwrap_or(false)
        {
            let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
            out.push(ShaderCacheArtifact {
                path: p.to_string_lossy().to_string(),
                size: meta.len(),
                kind: "dxvk-state-cache".to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[cfg(not(windows))]
fn discover_shader_cache_artifacts_impl(
    game_exe_path: String,
    steam_app_id: Option<String>,
) -> Result<ShaderCacheDiscovery, String> {
    let game_exe = PathBuf::from(&game_exe_path);
    if !game_exe.is_file() {
        return Err("Game executable path is not a file".to_string());
    }
    let game_dir = game_exe
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let dxvk_caches = collect_dxvk_caches(&game_exe)?;
    let mut hints = Vec::<String>::new();
    if dxvk_caches.is_empty() {
        hints.push(
            "No .dxvk-cache next to this exe yet — it appears after the first DXVK run.".to_string(),
        );
    }
    let sid = steam_app_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let steam_path = sid
        .as_ref()
        .and_then(|id| resolve_steam_shadercache_dir(id));
    let (steam_bytes, steam_files) = steam_path
        .as_ref()
        .map(|p| dir_tree_stats(p))
        .unwrap_or((0, 0));
    if sid.is_some() && steam_path.is_none() {
        hints.push(
            "Steam App ID is set but no Fossilize/Vulkan cache folder was found under common Steam shadercache paths.".to_string(),
        );
    }
    if steam_bytes > 0 {
        hints.push(
            "Steam shader cache reduces Vulkan pipeline stutter; copy it together with DXVK caches when moving machines.".to_string(),
        );
    }
    Ok(ShaderCacheDiscovery {
        game_exe_path,
        game_dir,
        dxvk_caches,
        steam_app_id: sid,
        steam_shader_cache_path: steam_path.map(|p| p.to_string_lossy().to_string()),
        steam_shader_cache_bytes: steam_bytes,
        steam_shader_cache_files: steam_files,
        hints,
    })
}

#[tauri::command]
fn discover_shader_cache_artifacts(
    game_exe_path: String,
    steam_app_id: Option<String>,
) -> Result<ShaderCacheDiscovery, String> {
    #[cfg(windows)]
    {
        let _ = steam_app_id;
        let game_dir = PathBuf::from(&game_exe_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        Ok(ShaderCacheDiscovery {
            game_exe_path,
            game_dir,
            dxvk_caches: vec![],
            steam_app_id: None,
            steam_shader_cache_path: None,
            steam_shader_cache_bytes: 0,
            steam_shader_cache_files: 0,
            hints: vec!["DXVK / Steam shader cache tools target Linux/macOS Wine and Proton.".to_string()],
        })
    }
    #[cfg(not(windows))]
    {
        discover_shader_cache_artifacts_impl(game_exe_path, steam_app_id)
    }
}

#[tauri::command]
fn export_shader_cache_bundle(
    game_exe_path: String,
    steam_app_id: Option<String>,
    output_zip_path: String,
) -> Result<ShaderCacheExportResult, String> {
    #[cfg(windows)]
    {
        let _ = (game_exe_path, steam_app_id, output_zip_path);
        Err("Shader cache export is for Linux/macOS Wine setups.".to_string())
    }
    #[cfg(not(windows))]
    {
        let game_exe = PathBuf::from(&game_exe_path);
        if !game_exe.is_file() {
            return Err("Game executable path is not a file".to_string());
        }
        let dxvk = collect_dxvk_caches(&game_exe)?;
        let sid = steam_app_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let steam_dir = sid.as_ref().and_then(|id| resolve_steam_shadercache_dir(id));
        if dxvk.is_empty() && steam_dir.is_none() {
            return Err("Nothing to export: no .dxvk-cache beside the exe and no Steam shadercache folder.".to_string());
        }
        let zip_path = PathBuf::from(&output_zip_path);
        if let Some(parent) = zip_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut dxvk_packed = 0u64;
        let mut steam_packed = 0u64;
        for art in &dxvk {
            let fname = Path::new(&art.path)
                .file_name()
                .ok_or_else(|| "Invalid dxvk cache path".to_string())?;
            let zip_name = format!("dxvk/{}", fname.to_string_lossy());
            zip.start_file(&zip_name, options)
                .map_err(|e| e.to_string())?;
            let mut src = std::fs::File::open(&art.path).map_err(|e| e.to_string())?;
            std::io::copy(&mut src, &mut zip).map_err(|e| e.to_string())?;
            dxvk_packed += 1;
        }
        if let (Some(id), Some(sdir)) = (sid.as_ref(), steam_dir.as_ref()) {
            for entry in WalkDir::new(sdir).into_iter().filter_map(|e| e.ok()) {
                if !entry.file_type().is_file() {
                    continue;
                }
                let rel = entry
                    .path()
                    .strip_prefix(sdir)
                    .map_err(|e| e.to_string())?;
                let zip_name = format!(
                    "steam/{}/{}",
                    id,
                    rel.to_string_lossy().replace('\\', "/")
                );
                zip.start_file(&zip_name, options)
                    .map_err(|e| e.to_string())?;
                let mut src = std::fs::File::open(entry.path()).map_err(|e| e.to_string())?;
                std::io::copy(&mut src, &mut zip).map_err(|e| e.to_string())?;
                steam_packed += 1;
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(ShaderCacheExportResult {
            zip_path: zip_path.to_string_lossy().to_string(),
            dxvk_files_packed: dxvk_packed,
            steam_files_packed: steam_packed,
        })
    }
}

#[tauri::command]
fn import_shader_cache_bundle(
    game_exe_path: String,
    steam_app_id: Option<String>,
    zip_path: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        let _ = (game_exe_path, steam_app_id, zip_path);
        Err("Shader cache import is for Linux/macOS Wine setups.".to_string())
    }
    #[cfg(not(windows))]
    {
        let game_exe = PathBuf::from(&game_exe_path);
        if !game_exe.is_file() {
            return Err("Game executable path is not a file".to_string());
        }
        let game_dir = game_exe
            .parent()
            .ok_or_else(|| "Game path has no parent directory".to_string())?;
        let f = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
        let sid_param = steam_app_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let mut dxvk_out = 0u64;
        let mut steam_out = 0u64;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let raw = entry.name().to_string();
            if raw.ends_with('/') {
                continue;
            }
            if let Some(rest) = raw.strip_prefix("dxvk/") {
                if rest.is_empty() || rest.contains("..") {
                    continue;
                }
                let dest = game_dir.join(rest);
                if let Some(p) = dest.parent() {
                    std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut out_f = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out_f).map_err(|e| e.to_string())?;
                dxvk_out += 1;
                continue;
            }
            if let Some(rest) = raw.strip_prefix("steam/") {
                if rest.contains("..") {
                    continue;
                }
                let mut parts = rest.splitn(2, '/');
                let zip_app = parts.next().unwrap_or("");
                let sub = parts.next().unwrap_or("");
                if zip_app.is_empty() {
                    continue;
                }
                let target_id = sid_param.as_deref().unwrap_or(zip_app);
                let base = resolve_steam_shadercache_dir(target_id).or_else(|| {
                    let roots = steam_shadercache_roots();
                    roots.first().map(|r| r.join(target_id))
                });
                let Some(base) = base else {
                    continue;
                };
                std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
                if sub.is_empty() {
                    continue;
                }
                let dest = base.join(sub);
                if let Some(p) = dest.parent() {
                    std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut out_f = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out_f).map_err(|e| e.to_string())?;
                steam_out += 1;
            }
        }
        if dxvk_out == 0 && steam_out == 0 {
            return Err(
                "Zip contained no dxvk/ or steam/ entries compatible with this import.".to_string(),
            );
        }
        Ok(format!(
            "Imported {} DXVK cache file(s) and {} Steam shader cache file(s).",
            dxvk_out, steam_out
        ))
    }
}

#[cfg(not(windows))]
fn extract_yaml_value(source: &str, keys: &[&str]) -> Option<String> {
    for line in source.lines() {
        let trimmed = line.trim();
        for key in keys {
            let prefix = format!("{key}:");
            if trimmed.starts_with(&prefix) {
                let raw = trimmed[prefix.len()..].trim();
                if raw.is_empty() || raw == "null" {
                    continue;
                }
                let unquoted = raw
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim()
                    .to_string();
                if !unquoted.is_empty() {
                    return Some(unquoted);
                }
            }
        }
    }
    None
}

#[tauri::command]
fn import_lutris_games() -> Vec<LutrisGameEntry> {
    #[cfg(windows)]
    {
        Vec::new()
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let roots = [
            format!("{home}/.config/lutris/games"),
            format!("{home}/.local/share/lutris/games"),
        ];

        let mut out: Vec<LutrisGameEntry> = Vec::new();
        let mut seen_exe: HashSet<String> = HashSet::new();

        for root in &roots {
            let root_path = std::path::Path::new(root);
            if !root_path.exists() {
                continue;
            }
            let Ok(entries) = std::fs::read_dir(root_path) else {
                continue;
            };
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path
                    .extension()
                    .map(|x| x.to_string_lossy().to_lowercase() != "yml")
                    .unwrap_or(true)
                {
                    continue;
                }
                let Ok(src) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let exe = extract_yaml_value(&src, &["exe", "executable"]);
                let Some(exe_path) = exe else {
                    continue;
                };
                if exe_path.is_empty() || !seen_exe.insert(exe_path.clone()) {
                    continue;
                }
                let slug = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "lutris-game".to_string());
                let name = extract_yaml_value(&src, &["name"]).unwrap_or_else(|| slug.clone());
                let prefix = extract_yaml_value(&src, &["prefix", "wineprefix"]);
                let runner = extract_yaml_value(&src, &["runner", "runner_name"]);
                let args = extract_yaml_value(&src, &["args", "arguments", "game_args"]);
                out.push(LutrisGameEntry {
                    name,
                    slug,
                    exe: exe_path,
                    prefix,
                    runner,
                    args,
                    config_path: path.to_string_lossy().to_string(),
                });
            }
        }

        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }
}

#[cfg(windows)]
fn sqlite_table_columns(conn: &Connection, table: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let pragma = format!("PRAGMA table_info({table})");
    let Ok(mut stmt) = conn.prepare(&pragma) else {
        return out;
    };
    let Ok(mut rows) = stmt.query([]) else {
        return out;
    };
    while let Ok(Some(row)) = rows.next() {
        if let Ok(name) = row.get::<_, String>(1) {
            out.insert(name.to_lowercase());
        }
    }
    out
}

#[cfg(windows)]
fn first_existing_column(cols: &HashSet<String>, candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find(|c| cols.contains(&c.to_lowercase()))
        .map(|s| (*s).to_string())
}

#[cfg(windows)]
fn row_value_opt(row: &rusqlite::Row<'_>, idx: usize) -> Option<String> {
    let v = row.get_ref(idx).ok()?;
    match v {
        ValueRef::Null => None,
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t).trim().to_string()),
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Blob(_) => None,
    }
}

#[tauri::command]
fn import_playnite_games() -> Vec<InteropGameEntry> {
    #[cfg(not(windows))]
    {
        Vec::new()
    }
    #[cfg(windows)]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let db_path = std::path::Path::new(&appdata)
            .join("Playnite")
            .join("library")
            .join("games.db");
        if !db_path.is_file() {
            return Vec::new();
        }
        let Ok(conn) = Connection::open(db_path) else {
            return Vec::new();
        };

        let cols = sqlite_table_columns(&conn, "Games");
        if cols.is_empty() {
            return Vec::new();
        }
        let id_col = first_existing_column(&cols, &["GameId", "Id", "ID"]);
        let name_col = first_existing_column(&cols, &["Name", "name"]);
        let exe_col = first_existing_column(
            &cols,
            &["GameActionPath", "LaunchPath", "ExecutablePath", "Path"],
        );
        let install_col = first_existing_column(&cols, &["InstallDirectory", "InstallationPath"]);
        let args_col = first_existing_column(&cols, &["CommandLine", "Arguments", "LaunchArguments"]);
        let installed_col = first_existing_column(&cols, &["IsInstalled", "Installed"]);
        let Some(name_col) = name_col else {
            return Vec::new();
        };
        if exe_col.is_none() && install_col.is_none() {
            return Vec::new();
        }

        let mut selected_cols: Vec<String> = vec![name_col.clone()];
        if let Some(c) = &id_col {
            selected_cols.push(c.clone());
        }
        if let Some(c) = &exe_col {
            selected_cols.push(c.clone());
        }
        if let Some(c) = &install_col {
            selected_cols.push(c.clone());
        }
        if let Some(c) = &args_col {
            selected_cols.push(c.clone());
        }
        if let Some(c) = &installed_col {
            selected_cols.push(c.clone());
        }

        let sql = format!("SELECT {} FROM Games", selected_cols.join(", "));
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let Ok(mut rows) = stmt.query([]) else {
            return Vec::new();
        };

        let mut out: Vec<InteropGameEntry> = Vec::new();
        let mut seen_exe = HashSet::<String>::new();
        while let Ok(Some(row)) = rows.next() {
            let mut idx = 0usize;
            let name = row_value_opt(row, idx).unwrap_or_else(|| "Playnite Game".to_string());
            idx += 1;

            let game_id = if id_col.is_some() {
                let v = row_value_opt(row, idx).unwrap_or_else(|| name.clone());
                idx += 1;
                v
            } else {
                name.clone()
            };

            let raw_exe = if exe_col.is_some() {
                let v = row_value_opt(row, idx);
                idx += 1;
                v
            } else {
                None
            };
            let install_dir = if install_col.is_some() {
                let v = row_value_opt(row, idx).map(|s| normalize_windows_path(&s));
                idx += 1;
                v
            } else {
                None
            };
            let args = if args_col.is_some() {
                let v = row_value_opt(row, idx);
                idx += 1;
                v
            } else {
                None
            };
            let installed = if installed_col.is_some() {
                let val = row_value_opt(row, idx);
                idx += 1;
                match val {
                    None => true,
                    Some(v) => matches!(
                        v.to_lowercase().as_str(),
                        "1" | "true" | "yes" | "installed"
                    ),
                }
            } else {
                true
            };
            let _ = idx;
            if !installed {
                continue;
            }
            let exe = candidate_from_paths(
                raw_exe.map(|s| normalize_windows_path(&s)),
                install_dir.clone(),
            );
            let Some(exe) = exe else {
                continue;
            };
            let key = exe.to_lowercase();
            if !seen_exe.insert(key) {
                continue;
            }

            out.push(InteropGameEntry {
                name,
                game_id,
                exe,
                args: args.filter(|s| !s.trim().is_empty()),
                source: "playnite".to_string(),
                store_uri: None,
                source_url: None,
                cover_url: None,
                developer: None,
                version: None,
                overview: None,
            });
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }
}

#[cfg(windows)]
fn read_gog_product_titles(conn: &Connection) -> HashMap<String, String> {
    let mut map = HashMap::<String, String>::new();
    let cols = sqlite_table_columns(conn, "Products");
    if cols.is_empty() {
        return map;
    }
    let id_col = first_existing_column(&cols, &["productId", "product_id", "id", "Id"]);
    let title_col = first_existing_column(&cols, &["title", "name", "Title", "Name"]);
    let (Some(id_col), Some(title_col)) = (id_col, title_col) else {
        return map;
    };
    let sql = format!("SELECT {id_col}, {title_col} FROM Products");
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return map;
    };
    let Ok(mut rows) = stmt.query([]) else {
        return map;
    };
    while let Ok(Some(row)) = rows.next() {
        let id = row_value_opt(row, 0).unwrap_or_default();
        let title = row_value_opt(row, 1).unwrap_or_default();
        if !id.is_empty() && !title.is_empty() {
            map.insert(id, title);
        }
    }
    map
}

#[tauri::command]
fn import_gog_galaxy_games() -> Vec<InteropGameEntry> {
    #[cfg(not(windows))]
    {
        Vec::new()
    }
    #[cfg(windows)]
    {
        let program_data = std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
        let db_path = std::path::Path::new(&program_data)
            .join("GOG.com")
            .join("Galaxy")
            .join("storage")
            .join("galaxy-2.0.db");
        if !db_path.is_file() {
            return Vec::new();
        }

        let Ok(conn) = Connection::open(db_path) else {
            return Vec::new();
        };
        let cols = sqlite_table_columns(&conn, "InstalledBaseProducts");
        if cols.is_empty() {
            return Vec::new();
        }
        let id_col = first_existing_column(&cols, &["productId", "product_id", "id", "Id"]);
        let install_col = first_existing_column(&cols, &["installationPath", "install_path", "path"]);
        let exe_col = first_existing_column(
            &cols,
            &["executablePath", "launchPath", "playTaskPath", "executable_path"],
        );
        let args_col = first_existing_column(&cols, &["arguments", "launchArguments", "commandLine"]);
        let (Some(id_col), Some(install_col)) = (id_col, install_col) else {
            return Vec::new();
        };

        let mut select_cols = vec![id_col.clone(), install_col.clone()];
        if let Some(c) = &exe_col {
            select_cols.push(c.clone());
        }
        if let Some(c) = &args_col {
            select_cols.push(c.clone());
        }
        let sql = format!("SELECT {} FROM InstalledBaseProducts", select_cols.join(", "));
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let Ok(mut rows) = stmt.query([]) else {
            return Vec::new();
        };
        let titles = read_gog_product_titles(&conn);

        let mut out = Vec::<InteropGameEntry>::new();
        let mut seen_exe = HashSet::<String>::new();
        while let Ok(Some(row)) = rows.next() {
            let mut idx = 0usize;
            let game_id = row_value_opt(row, idx).unwrap_or_default();
            idx += 1;
            let install = row_value_opt(row, idx).map(|s| normalize_windows_path(&s));
            idx += 1;
            let raw_exe = if exe_col.is_some() {
                let v = row_value_opt(row, idx).map(|s| normalize_windows_path(&s));
                idx += 1;
                v
            } else {
                None
            };
            let args = if args_col.is_some() {
                let v = row_value_opt(row, idx);
                idx += 1;
                v
            } else {
                None
            };
            let _ = idx;
            if game_id.is_empty() {
                continue;
            }
            let exe = candidate_from_paths(raw_exe, install);
            let Some(exe) = exe else {
                continue;
            };
            let key = exe.to_lowercase();
            if !seen_exe.insert(key) {
                continue;
            }

            let name = titles
                .get(&game_id)
                .cloned()
                .unwrap_or_else(|| format!("GOG {}", game_id));
            out.push(InteropGameEntry {
                name,
                game_id,
                exe,
                args: args.filter(|s| !s.trim().is_empty()),
                source: "gog-galaxy".to_string(),
                store_uri: None,
                source_url: None,
                cover_url: None,
                developer: None,
                version: None,
                overview: None,
            });
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        out
    }
}

#[tauri::command]
fn split_args(s: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes: Option<char> = None;

    for c in s.chars() {
        match c {
            '"' | '\'' => {
                if in_quotes == Some(c) {
                    in_quotes = None;
                } else if in_quotes.is_none() {
                    in_quotes = Some(c);
                } else {
                    current.push(c);
                }
            }
            ' ' | '\t' if in_quotes.is_none() => {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

#[tauri::command]
fn launch_game(
    app: AppHandle,
    path: String,
    runner: Option<String>,
    prefix: Option<String>,
    args: Option<String>,
    boss_key: Option<screenshot::BossKeyConfig>,
) -> Result<(), String> {
    let path_clone = path.clone();
    thread::spawn(move || {
        let parent = std::path::Path::new(&path_clone).parent();

        // Build the command — on Windows always run directly; on other platforms
        // optionally wrap via Wine or Proton.
        let mut command = {
            #[cfg(windows)]
            {
                let _ = (&runner, &prefix); // unused on Windows
                let mut cmd = Command::new(&path_clone);
                if let Some(p) = parent {
                    cmd.current_dir(p);
                }
                cmd
            }
            #[cfg(not(windows))]
            {
                if let Some(ref runner_path) = runner {
                    let is_proton = std::path::Path::new(runner_path)
                        .file_name()
                        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("proton"))
                        .unwrap_or(false);
                    let mut cmd = Command::new(runner_path);
                    if is_proton {
                        cmd.arg("run");
                        // Proton requires STEAM_COMPAT_DATA_PATH (the Wine prefix parent)
                        if let Some(ref pfx) = prefix {
                            cmd.env("STEAM_COMPAT_DATA_PATH", pfx);
                        }
                        // Proton also needs STEAM_COMPAT_CLIENT_INSTALL_PATH
                        if let Ok(steam_root) = std::env::var("HOME") {
                            let steam_path = format!("{steam_root}/.local/share/Steam");
                            if std::path::Path::new(&steam_path).exists() {
                                cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &steam_path);
                            }
                        }
                    } else {
                        // Wine — set WINEPREFIX if provided
                        if let Some(ref pfx) = prefix {
                            cmd.env("WINEPREFIX", pfx);
                        }
                    }
                    cmd.arg(&path_clone);
                    if let Some(p) = parent {
                        cmd.current_dir(p);
                    }
                    cmd
                } else {
                    // No runner — attempt to run directly (native or Wine-managed script)
                    let mut cmd = Command::new(&path_clone);
                    if let Some(p) = parent {
                        cmd.current_dir(p);
                    }
                    cmd
                }
            }
        };

        if let Some(arg_str) = args {
            command.args(split_args(&arg_str));
        }

        match command.spawn() {
            Ok(mut child) => {
                let root_pid = child.id();
                discord::set_game_window_pid(root_pid as i32);
                let start_time = Instant::now();
                let initial_related = vec![root_pid];

                {
                    let state = app.state::<screenshot::ActiveGameState>();
                    *state.0.lock().unwrap() = Some(screenshot::ActiveGame {
                        pid: root_pid,
                        root_pid,
                        exe: path_clone.clone(),
                        related_pids: initial_related.clone(),
                    });
                }

                let _ = app.emit("game-started", &path_clone);

                let (tx, rx) = std::sync::mpsc::channel::<u32>();
                let exe_hk = path_clone.clone();
                let app_hk = app.clone();
                let boss_hk = boss_key.clone();
                thread::spawn(move || {
                    screenshot::start_hotkey_listener(root_pid, exe_hk, app_hk, boss_hk, tx);
                });
                let hotkey_thread_id = rx.recv().unwrap_or(0);

                let mut last_tracked_pid = root_pid;
                let mut last_related = initial_related;
                let mut root_exited = false;
                let mut cleanup_attempted = false;
                let mut cleanup_succeeded = true;
                let exit_reason: String;

                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => root_exited = true,
                        Ok(None) => {}
                        Err(_) => root_exited = true,
                    }

                    let related_entries = collect_related_processes(root_pid);
                    let mut related_pids: Vec<u32> = related_entries.iter().map(|entry| entry.pid).collect();
                    related_pids.sort_unstable();
                    related_pids.dedup();

                    if !root_exited && related_pids.is_empty() {
                        related_pids.push(root_pid);
                    }

                    if related_pids.is_empty() && root_exited {
                        last_related = Vec::new();
                        exit_reason = "tracked_processes_exited".to_string();
                        break;
                    }

                    let tracked_pid = choose_tracked_process_pid(&related_entries, root_pid, &path_clone);
                    if tracked_pid != last_tracked_pid || related_pids != last_related {
                        let state = app.state::<screenshot::ActiveGameState>();
                        *state.0.lock().unwrap() = Some(screenshot::ActiveGame {
                            pid: tracked_pid,
                            root_pid,
                            exe: path_clone.clone(),
                            related_pids: related_pids.clone(),
                        });
                        screenshot::update_active_pid(tracked_pid);
                        discord::set_game_window_pid(tracked_pid as i32);
                        last_tracked_pid = tracked_pid;
                        last_related = related_pids;
                    }

                    thread::sleep(std::time::Duration::from_millis(1200));
                }

                screenshot::stop_hotkey_thread(hotkey_thread_id);
                discord::set_game_window_pid(std::process::id() as i32);

                {
                    let state = app.state::<screenshot::ActiveGameState>();
                    let mut guard = state.0.lock().unwrap();
                    if let Some(active) = guard.as_ref() {
                        if !active.related_pids.is_empty() {
                            cleanup_attempted = true;
                            cleanup_succeeded =
                                terminate_process_tree(active.root_pid, &active.related_pids).is_ok();
                        }
                    }
                    *guard = None;
                }

                let duration = start_time.elapsed().as_secs();
                if cleanup_attempted && !cleanup_succeeded {
                    push_rust_log(
                        Some(&app),
                        "warn",
                        format!(
                            "Process cleanup may be incomplete for '{}' (root PID {}, tracked PID {})",
                            path_clone, root_pid, last_tracked_pid
                        ),
                    );
                }
                let _ = app.emit(
                    "game-finished",
                    GameEndedPayload {
                        path: path_clone,
                        duration_secs: duration,
                        lifecycle: Some(ProcessLifecycleDiagnostic {
                            root_pid,
                            tracked_pid: last_tracked_pid,
                            related_pids: last_related,
                            duration_secs: duration,
                            cleanup_attempted,
                            cleanup_succeeded,
                            exit_reason,
                        }),
                    },
                );
            }
            Err(e) => {
                push_rust_log(Some(&app), "error", format!("Failed to launch game: {}", e));
            }
        }
    });
    Ok(())
}

/// Kills the currently-running game process.
#[tauri::command]
fn kill_game(app: AppHandle) -> Result<(), String> {
    let state = app.state::<screenshot::ActiveGameState>();
    let guard = state.0.lock().unwrap();
    if let Some(ref active) = *guard {
        terminate_process_tree(active.root_pid, &active.related_pids)
    } else {
        Err("No game is currently running".to_string())
    }
}

/// Information about an available application update.
#[derive(Serialize)]
struct AppUpdateInfo {
    version: String,
    /// HTML page URL (for "view changelog" link)
    url: String,
    /// Direct download URL for the platform-appropriate asset (zip/tar.gz).
    /// Empty string when no matching asset was found in the release.
    download_url: String,
}

/// Checks the GitHub Releases API for a newer version of LIBMALY.
/// Returns `None` when already up-to-date or if the check fails silently.
#[tauri::command]
async fn check_app_update() -> Result<Option<AppUpdateInfo>, String> {
    let current = env!("CARGO_PKG_VERSION");

    fn parse_ver(s: &str) -> (u32, u32, u32) {
        let mut p = s.split('.').filter_map(|x| x.parse::<u32>().ok());
        (
            p.next().unwrap_or(0),
            p.next().unwrap_or(0),
            p.next().unwrap_or(0),
        )
    }

    // Pick preferred asset extensions per platform (first match wins)
    #[cfg(windows)]
    let preferred = ["windows", "win"];
    #[cfg(target_os = "macos")]
    let preferred = ["macos", "mac"];
    #[cfg(target_os = "linux")]
    let preferred = ["linux"];
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    let preferred: [&str; 0] = [];

    let client = reqwest::Client::builder()
        .user_agent("libmaly-update-checker")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.github.com/repos/Baconana-chan/Libmaly/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Ok(None); // no releases yet or rate-limited — ignore silently
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let tag = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let url = json["html_url"].as_str().unwrap_or("").to_string();

    if tag.is_empty() {
        return Ok(None);
    }
    if parse_ver(&tag) <= parse_ver(current) {
        return Ok(None);
    }

    // Pick the best asset download URL for this platform
    let mut download_url = String::new();
    if let Some(assets) = json["assets"].as_array() {
        // Prefer a .zip or .tar.gz archive over a setup installer so we can
        // do in-place extraction without needing admin rights.
        let archive_exts = [".zip", ".tar.gz", ".tgz"];
        'outer: for keyword in &preferred {
            for asset in assets {
                let name = asset["name"].as_str().unwrap_or("").to_lowercase();
                let dl = asset["browser_download_url"].as_str().unwrap_or("");
                if name.contains(keyword) && archive_exts.iter().any(|e| name.ends_with(e)) {
                    download_url = dl.to_string();
                    break 'outer;
                }
            }
        }
        // Fallback: any archive for this platform
        if download_url.is_empty() {
            'outer2: for keyword in &preferred {
                for asset in assets {
                    let name = asset["name"].as_str().unwrap_or("").to_lowercase();
                    let dl = asset["browser_download_url"].as_str().unwrap_or("");
                    if name.contains(keyword) && !dl.is_empty() {
                        download_url = dl.to_string();
                        break 'outer2;
                    }
                }
            }
        }
    }

    Ok(Some(AppUpdateInfo {
        version: tag,
        url,
        download_url,
    }))
}

/// Download the update archive, extract it next to the current executable, and
/// launch a tiny platform script that will copy the files over once we exit.
///
/// Keeps user data safe: default mode uses AppData, portable mode keeps data next to the executable.
#[tauri::command]
async fn apply_update(app: AppHandle, download_url: String) -> Result<(), String> {
    use std::io::Write;

    if download_url.is_empty() {
        return Err("No download URL provided".to_string());
    }

    // 1. Where is the current exe?
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let install_dir = exe_path
        .parent()
        .ok_or("Cannot determine install directory")?
        .to_path_buf();

    // 2. Temp extraction directory
    let tmp_dir = std::env::temp_dir().join("libmaly-update");
    if tmp_dir.exists() {
        std::fs::remove_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

    // 3. Download the archive
    let client = reqwest::Client::builder()
        .user_agent("libmaly-updater")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    // 4. Save and extract the archive
    let archive_name = download_url
        .split('/')
        .next_back()
        .unwrap_or("update.zip")
        .to_string();
    let archive_path = tmp_dir.join(&archive_name);
    {
        let mut f = std::fs::File::create(&archive_path).map_err(|e| e.to_string())?;
        f.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    if archive_name.ends_with(".zip") {
        let f = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;

        // Detect whether the zip has a single top-level directory wrapper
        // (common pattern: "libmaly-1.2.0/libmaly.exe") and unwrap it.
        let strip_prefix: Option<String> = {
            let mut dirs = std::collections::HashSet::new();
            for i in 0..archive.len() {
                let entry = archive.by_index(i).map_err(|e| e.to_string())?;
                if let Some(first) = entry.name().split('/').next() {
                    if !first.is_empty() {
                        dirs.insert(first.to_string());
                    }
                }
            }
            if dirs.len() == 1 {
                dirs.into_iter().next()
            } else {
                None
            }
        };

        let f2 = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
        let mut archive2 = zip::ZipArchive::new(f2).map_err(|e| e.to_string())?;
        for i in 0..archive2.len() {
            let mut entry = archive2.by_index(i).map_err(|e| e.to_string())?;
            let raw_name = entry.name().to_string();
            let name = match &strip_prefix {
                Some(pfx) => raw_name
                    .strip_prefix(&format!("{}/", pfx))
                    .unwrap_or(&raw_name)
                    .to_string(),
                None => raw_name,
            };
            if name.is_empty() {
                continue;
            }
            let out_path = tmp_dir.join(&name);
            if entry.is_dir() {
                std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = out_path.parent() {
                    std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut out_file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
            }
        }
    } else if archive_name.ends_with(".exe") || archive_name.ends_with(".msi") {
        #[cfg(windows)]
        {
            // Just launch the installer and exit LIBMALY so it can overwrite files.
            let mut cmd = std::process::Command::new("cmd");
            #[cfg(windows)]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            cmd.args(["/C", "start", "\"\"", &archive_path.to_string_lossy()]);
            cmd.spawn()
                .map_err(|e| format!("Failed to start installer: {}", e))?;
            app.exit(0);
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            return Err("Cannot run Windows installer on this OS.".to_string());
        }
    } else {
        // For non-zip archives (tar.gz etc.) just leave the archive in tmp_dir;
        // the script will deal with them or the user can update manually.
        // For now we return an error suggesting manual install.
        return Err(format!(
            "Archive format not supported for auto-update: {}. Please install manually from the release page.",
            archive_name
        ));
    }

    // 5. Write the update script and launch it detached
    let install_dir_str = install_dir.to_string_lossy().into_owned();
    let tmp_dir_str = tmp_dir.to_string_lossy().into_owned();

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Determine the main exe name so we can relaunch it
        let exe_name = exe_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "libmaly.exe".to_string());

        let script_path = tmp_dir.join("_libmaly_update.bat");
        let mut script_lines: Vec<String> = Vec::new();
        script_lines.push("@echo off".to_string());
        script_lines.push("timeout /t 2 /nobreak >nul".to_string());
        script_lines.push(format!(
            r#"xcopy /E /Y /I /Q "{}\*" "{}\" >nul 2>&1"#,
            tmp_dir_str, install_dir_str
        ));
        script_lines.push(format!(r#"start "" "{}\{}""#, install_dir_str, exe_name));
        script_lines.push("del \"%~f0\"".to_string());
        let script_content = script_lines.join("\r\n") + "\r\n";
        {
            let mut f = std::fs::File::create(&script_path).map_err(|e| e.to_string())?;
            f.write_all(script_content.as_bytes())
                .map_err(|e| e.to_string())?;
        }
        Command::new("cmd")
            .args(["/C", &script_path.to_string_lossy()])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let exe_name = exe_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "libmaly".to_string());

        let script_path = tmp_dir.join("_libmaly_update.sh");
        let mut script_lines: Vec<String> = Vec::new();
        script_lines.push("#!/bin/sh".to_string());
        script_lines.push("sleep 2".to_string());
        script_lines.push(format!(
            r#"cp -rf "{}/." "{}/""#,
            tmp_dir_str, install_dir_str
        ));
        script_lines.push(format!(r#"chmod +x "{}/{}""#, install_dir_str, exe_name));
        script_lines.push(format!(r#""{}/{}" &"#, install_dir_str, exe_name));
        script_lines.push("rm -- \"$0\"".to_string());
        let script_content = script_lines.join("\n") + "\n";
        {
            let mut f = std::fs::File::create(&script_path).map_err(|e| e.to_string())?;
            f.write_all(script_content.as_bytes())
                .map_err(|e| e.to_string())?;
        }
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
        Command::new("sh")
            .arg(&script_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    // 6. Exit the application so the script can replace the binary
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_library_profiles(app: AppHandle) -> LibraryProfileRegistry {
    app.state::<LibraryProfilesState>().0.lock().unwrap().clone()
}

#[tauri::command]
fn save_library_profile(
    app: AppHandle,
    profile: LibraryProfileInput,
) -> Result<LibraryProfileRegistry, String> {
    let profiles_state = app.state::<LibraryProfilesState>();
    let mut registry = profiles_state.0.lock().unwrap();
    let trimmed_name = profile.display_name.trim();
    if trimmed_name.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }

    let requested_id = profile.id.as_deref().map(str::trim).unwrap_or("");
    let mut profile_id = if requested_id.is_empty() {
        sanitize_profile_slug(trimmed_name)
    } else {
        sanitize_profile_slug(requested_id)
    };
    if profile_id.is_empty() {
        profile_id = format!("profile-{}", now_ms());
    }

    let mut candidate_id = profile_id.clone();
    let mut suffix = 2usize;
    while registry
        .profiles
        .iter()
        .any(|existing| existing.id == candidate_id && existing.id != requested_id)
    {
        candidate_id = format!("{profile_id}-{suffix}");
        suffix += 1;
    }
    profile_id = candidate_id;

    let now = now_ms();
    if let Some(existing) = registry
        .profiles
        .iter_mut()
        .find(|existing| existing.id == requested_id && !requested_id.is_empty())
    {
        existing.display_name = trimmed_name.to_string();
        existing.handle = normalize_optional_profile_field(profile.handle);
        existing.tagline = normalize_optional_profile_field(profile.tagline);
        existing.avatar_url = normalize_optional_profile_field(profile.avatar_url);
        existing.banner_url = normalize_optional_profile_field(profile.banner_url);
        existing.accent_color = normalize_optional_profile_field(profile.accent_color);
        existing.updated_at = now;
    } else {
        registry.profiles.push(LibraryProfile {
            id: profile_id.clone(),
            display_name: trimmed_name.to_string(),
            handle: normalize_optional_profile_field(profile.handle),
            tagline: normalize_optional_profile_field(profile.tagline),
            avatar_url: normalize_optional_profile_field(profile.avatar_url),
            banner_url: normalize_optional_profile_field(profile.banner_url),
            accent_color: normalize_optional_profile_field(profile.accent_color),
            created_at: now,
            updated_at: now,
        });
        if registry.active_profile_id.is_empty() {
            registry.active_profile_id = profile_id;
        }
    }

    *registry = ensure_profile_registry(registry.clone());
    save_library_profile_registry(&registry)?;
    let snapshot = registry.clone();
    drop(registry);
    refresh_tray(&app, &app.state::<RecentGamesState>().0.lock().unwrap().clone(), &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn switch_library_profile(
    app: AppHandle,
    profile_id: String,
) -> Result<LibraryProfileRegistry, String> {
    let profiles_state = app.state::<LibraryProfilesState>();
    let mut registry = profiles_state.0.lock().unwrap();
    if registry.profiles.iter().all(|profile| profile.id != profile_id) {
        return Err("Profile not found".to_string());
    }
    registry.active_profile_id = profile_id;
    save_library_profile_registry(&registry)?;
    let snapshot = registry.clone();
    drop(registry);
    refresh_tray(&app, &app.state::<RecentGamesState>().0.lock().unwrap().clone(), &snapshot);
    let _ = app.emit("library-profile-switched", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn delete_library_profile(
    app: AppHandle,
    profile_id: String,
) -> Result<LibraryProfileRegistry, String> {
    let profiles_state = app.state::<LibraryProfilesState>();
    let mut registry = profiles_state.0.lock().unwrap();
    if registry.profiles.len() <= 1 {
        return Err("At least one profile must remain".to_string());
    }
    let before_len = registry.profiles.len();
    registry.profiles.retain(|profile| profile.id != profile_id);
    if registry.profiles.len() == before_len {
        return Err("Profile not found".to_string());
    }
    if registry.active_profile_id == profile_id {
        registry.active_profile_id = registry
            .profiles
            .first()
            .map(|profile| profile.id.clone())
            .unwrap_or_else(|| "default".to_string());
    }
    *registry = ensure_profile_registry(registry.clone());
    save_library_profile_registry(&registry)?;
    let snapshot = registry.clone();
    drop(registry);
    refresh_tray(&app, &app.state::<RecentGamesState>().0.lock().unwrap().clone(), &snapshot);
    let _ = app.emit("library-profile-switched", &snapshot);
    Ok(snapshot)
}

/// Build the tray context-menu from a list of recent games.
fn build_tray_menu(
    app: &AppHandle,
    recent: &[RecentGame],
    registry: &LibraryProfileRegistry,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let title = MenuItemBuilder::with_id("_title", "LIBMALY")
        .enabled(false)
        .build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let show = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit LIBMALY").build(app)?;
    let mut profiles_submenu = SubmenuBuilder::new(app, "Profiles");
    for profile in &registry.profiles {
        let prefix = if profile.id == registry.active_profile_id {
            "● "
        } else {
            ""
        };
        let item = MenuItemBuilder::with_id(
            format!("profile_switch_{}", profile.id),
            format!("{prefix}{}", profile.display_name),
        )
        .build(app)?;
        profiles_submenu = profiles_submenu.item(&item);
    }
    let profiles_submenu = profiles_submenu.build()?;

    let mut builder = MenuBuilder::new(app).item(&title).item(&sep1);

    if recent.is_empty() {
        let placeholder = MenuItemBuilder::with_id("_empty", "No recent games")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&placeholder);
    } else {
        for (i, game) in recent.iter().enumerate() {
            let label = format!("▶  {}", game.name);
            let item = MenuItemBuilder::with_id(format!("recent_{i}"), label).build(app)?;
            builder = builder.item(&item);
        }
    }

    builder
        .item(&sep2)
        .item(&profiles_submenu)
        .item(&sep3)
        .item(&show)
        .item(&quit)
        .build()
}

/// Update the tray menu with a new list of recent games.
fn refresh_tray(app: &AppHandle, recent: &[RecentGame], registry: &LibraryProfileRegistry) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(menu) = build_tray_menu(app, recent, registry) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Called by the frontend whenever the last-5 list changes.
#[tauri::command]
fn set_recent_games(app: AppHandle, games: Vec<RecentGame>) -> Result<(), String> {
    *app.state::<RecentGamesState>().0.lock().unwrap() = games.clone();
    let registry = app.state::<LibraryProfilesState>().0.lock().unwrap().clone();
    refresh_tray(&app, &games, &registry);
    Ok(())
}

/// Deletes the parent folder of the given .exe path.
#[tauri::command]
fn delete_game(path: String) -> Result<(), String> {
    let exe_path = std::path::Path::new(&path);
    let parent = exe_path
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;
    std::fs::remove_dir_all(parent)
        .map_err(|e| format!("Failed to delete '{}': {}", parent.display(), e))
}

/// Lists every executable file (.exe / .sh / .bin / .app) directly inside
/// `folder` (non-recursive). Returns full paths. No file-size or block-list
/// filters — the user is explicitly choosing so we show everything.
#[tauri::command]
fn list_executables_in_folder(folder: String) -> Vec<String> {
    let dir = std::path::Path::new(&folder);
    let mut out: Vec<String> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    let exe_exts = ["exe", "sh", "bin", "app"];
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if exe_exts.contains(&ext.as_str()) {
            out.push(p.to_string_lossy().into_owned());
        }
    }
    out.sort();
    out
}

#[tauri::command]
fn run_integrity_check(
    library_folders: Vec<IntegrityLibraryFolderInput>,
    games: Vec<IntegrityGameInput>,
    customizations: HashMap<String, IntegrityCustomizationInput>,
    metadata: HashMap<String, serde_json::Value>,
) -> IntegrityCheckReport {
    let mut issues = Vec::<IntegrityIssue>::new();
    let mut seen_folders = HashMap::<String, String>::new();
    let mut seen_games = HashMap::<String, String>::new();

    for folder in &library_folders {
        let key = normalize_path_key(&folder.path);
        if let Some(first) = seen_folders.insert(key, folder.path.clone()) {
            issues.push(IntegrityIssue {
                severity: "error".to_string(),
                code: "duplicate_library_folder".to_string(),
                message: format!("Duplicate library folder entry: {}", folder.path),
                path: Some(folder.path.clone()),
                game_path: Some(first),
            });
        }
        let folder_path = Path::new(&folder.path);
        if !folder_path.exists() {
            issues.push(IntegrityIssue {
                severity: "error".to_string(),
                code: "missing_library_folder".to_string(),
                message: format!("Library folder does not exist: {}", folder.path),
                path: Some(folder.path.clone()),
                game_path: None,
            });
        } else if !folder_path.is_dir() {
            issues.push(IntegrityIssue {
                severity: "error".to_string(),
                code: "invalid_library_folder".to_string(),
                message: format!("Library folder is not a directory: {}", folder.path),
                path: Some(folder.path.clone()),
                game_path: None,
            });
        }
    }

    for game in &games {
        let key = normalize_path_key(&game.path);
        if let Some(first) = seen_games.insert(key, game.path.clone()) {
            issues.push(IntegrityIssue {
                severity: "error".to_string(),
                code: "duplicate_game_path".to_string(),
                message: format!("Duplicate game path detected for '{}'", game.name),
                path: Some(game.path.clone()),
                game_path: Some(first),
            });
        }

        let game_path = Path::new(&game.path);
        let is_uninstalled = game.uninstalled.unwrap_or(false);
        if !game_path.exists() {
            issues.push(IntegrityIssue {
                severity: if is_uninstalled { "warning" } else { "error" }.to_string(),
                code: "missing_game_executable".to_string(),
                message: if is_uninstalled {
                    format!("Game is marked uninstalled and executable is missing: {}", game.path)
                } else {
                    format!("Game executable does not exist: {}", game.path)
                },
                path: Some(game.path.clone()),
                game_path: Some(game.path.clone()),
            });
        } else if !game_path.is_file() {
            issues.push(IntegrityIssue {
                severity: "error".to_string(),
                code: "invalid_game_executable".to_string(),
                message: format!("Game path is not a file: {}", game.path),
                path: Some(game.path.clone()),
                game_path: Some(game.path.clone()),
            });
        } else if !supported_executable_extension(game_path) {
            issues.push(IntegrityIssue {
                severity: "warning".to_string(),
                code: "unusual_executable_extension".to_string(),
                message: format!("Game executable has an unusual extension: {}", game.path),
                path: Some(game.path.clone()),
                game_path: Some(game.path.clone()),
            });
        }

        if let Some(custom) = customizations.get(&game.path) {
            if let Some(override_path) = custom.exe_override.as_ref().filter(|x| !x.trim().is_empty()) {
                let override_path_ref = Path::new(override_path);
                if !override_path_ref.exists() {
                    issues.push(IntegrityIssue {
                        severity: "error".to_string(),
                        code: "missing_exe_override".to_string(),
                        message: format!("Custom executable override does not exist: {}", override_path),
                        path: Some(override_path.clone()),
                        game_path: Some(game.path.clone()),
                    });
                } else if !override_path_ref.is_file() {
                    issues.push(IntegrityIssue {
                        severity: "error".to_string(),
                        code: "invalid_exe_override".to_string(),
                        message: format!("Custom executable override is not a file: {}", override_path),
                        path: Some(override_path.clone()),
                        game_path: Some(game.path.clone()),
                    });
                }

                let game_dir = Path::new(&game.path).parent().map(|x| normalize_path_key(&x.to_string_lossy()));
                let override_dir = override_path_ref
                    .parent()
                    .map(|x| normalize_path_key(&x.to_string_lossy()));
                if game_dir.is_some() && override_dir.is_some() && game_dir != override_dir {
                    issues.push(IntegrityIssue {
                        severity: "warning".to_string(),
                        code: "override_outside_game_folder".to_string(),
                        message: format!("Custom executable override points outside the game folder: {}", override_path),
                        path: Some(override_path.clone()),
                        game_path: Some(game.path.clone()),
                    });
                }
            }
        }
    }

    for meta_path in metadata.keys() {
        if !seen_games.contains_key(&normalize_path_key(meta_path)) {
            issues.push(IntegrityIssue {
                severity: "warning".to_string(),
                code: "orphan_metadata".to_string(),
                message: format!("Metadata exists for a game path that is no longer in the library: {}", meta_path),
                path: Some(meta_path.clone()),
                game_path: Some(meta_path.clone()),
            });
        }
    }

    for custom_path in customizations.keys() {
        if !seen_games.contains_key(&normalize_path_key(custom_path)) {
            issues.push(IntegrityIssue {
                severity: "warning".to_string(),
                code: "orphan_customization".to_string(),
                message: format!("Customization exists for a game path that is no longer in the library: {}", custom_path),
                path: Some(custom_path.clone()),
                game_path: Some(custom_path.clone()),
            });
        }
    }

    let error_count = issues.iter().filter(|x| x.severity == "error").count();
    let warning_count = issues.iter().filter(|x| x.severity == "warning").count();
    IntegrityCheckReport {
        scanned_at: now_ms(),
        total_games: games.len(),
        total_library_folders: library_folders.len(),
        error_count,
        warning_count,
        issues,
    }
}

#[tauri::command]
fn suggest_auto_heal_paths(
    library_folders: Vec<IntegrityLibraryFolderInput>,
    games: Vec<IntegrityGameInput>,
) -> Result<AutoHealReport, String> {
    let library_roots: Vec<String> = library_folders.iter().map(|f| f.path.clone()).collect();
    let mut broken_games = Vec::<IntegrityGameInput>::new();
    let current_paths: HashSet<String> = games.iter().map(|g| normalize_path_key(&g.path)).collect();

    for game in games.iter() {
        if game.uninstalled.unwrap_or(false) {
            continue;
        }
        if !Path::new(&game.path).exists() {
            broken_games.push(game.clone());
        }
    }

    let mut candidate_games = Vec::<Game>::new();
    for folder in library_folders.iter() {
        if !Path::new(&folder.path).exists() {
            continue;
        }
        let (scanned, _) = scan_games(folder.path.clone())?;
        candidate_games.extend(scanned);
    }

    candidate_games.sort_by(|a, b| a.path.cmp(&b.path));
    candidate_games.dedup_by(|a, b| a.path == b.path);
    let available_candidates: Vec<Game> = candidate_games
        .into_iter()
        .filter(|candidate| !current_paths.contains(&normalize_path_key(&candidate.path)))
        .collect();

    let mut suggestions = Vec::<AutoHealSuggestion>::new();
    let mut used_candidates = HashSet::<String>::new();
    let mut unresolved_paths = Vec::<String>::new();

    for game in broken_games.iter() {
        let mut ranked: Vec<(i32, String, &Game)> = available_candidates
            .iter()
            .filter_map(|candidate| {
                score_auto_heal_candidate(game, candidate, &library_roots)
                    .map(|(score, reason)| (score, reason, candidate))
            })
            .collect();
        ranked.sort_by(|a, b| b.0.cmp(&a.0));

        let Some((best_score, best_reason, best_candidate)) = ranked.first() else {
            unresolved_paths.push(game.path.clone());
            continue;
        };
        let second_score = ranked.get(1).map(|x| x.0).unwrap_or(0);
        let candidate_key = normalize_path_key(&best_candidate.path);
        if *best_score < 60 || (*best_score - second_score) < 8 || used_candidates.contains(&candidate_key) {
            unresolved_paths.push(game.path.clone());
            continue;
        }

        used_candidates.insert(candidate_key);
        suggestions.push(AutoHealSuggestion {
            game_name: game.name.clone(),
            old_path: game.path.clone(),
            new_path: best_candidate.path.clone(),
            confidence: (*best_score).clamp(0, 100) as u8,
            reason: if best_reason.is_empty() {
                "strong executable and folder match".to_string()
            } else {
                best_reason.clone()
            },
        });
    }

    Ok(AutoHealReport {
        scanned_at: now_ms(),
        total_broken_games: broken_games.len(),
        suggestion_count: suggestions.len(),
        unresolved_paths,
        suggestions,
    })
}

// ── Steam playtime import ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct SteamEntry {
    app_id: String,
    name: String,
    /// Total playtime in minutes (from `playtime_forever`)
    played_minutes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct SteamLibraryEntry {
    app_id: String,
    name: String,
    install_dir: String,
    library_dir: String,
    manifest_path: String,
    exe: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct SteamOwnedGame {
    app_id: String,
    name: String,
    played_minutes: u64,
    installed: bool,
    install_dir: Option<String>,
    library_dir: Option<String>,
    manifest_path: Option<String>,
    exe: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EpicLegendaryStatus {
    available: bool,
    authenticated: bool,
    executable_path: Option<String>,
    version: Option<String>,
    display_name: Option<String>,
    install_url: String,
    last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct EpicOwnedGame {
    app_name: String,
    title: String,
    installed: bool,
    install_path: Option<String>,
    exe: Option<String>,
    version: Option<String>,
}

#[derive(Deserialize)]
struct SteamResolveVanityResponse {
    response: SteamResolveVanityPayload,
}

#[derive(Deserialize)]
struct SteamResolveVanityPayload {
    success: u32,
    steamid: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct SteamOwnedGamesResponse {
    response: SteamOwnedGamesPayload,
}

#[derive(Deserialize)]
struct SteamOwnedGamesPayload {
    games: Option<Vec<SteamOwnedGamePayload>>,
}

#[derive(Deserialize)]
struct SteamOwnedGamePayload {
    appid: u64,
    name: Option<String>,
    playtime_forever: Option<u64>,
}

fn steam_root_paths() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let candidates = [
            PathBuf::from(r"C:\Program Files (x86)\Steam"),
            PathBuf::from(r"C:\Program Files\Steam"),
        ];
        candidates
            .iter()
            .filter(|p| p.exists())
            .cloned()
            .collect()
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = [
            PathBuf::from(&home).join(".steam/steam"),
            PathBuf::from(&home).join(".local/share/Steam"),
        ];
        candidates
            .iter()
            .filter(|p| p.exists())
            .cloned()
            .collect()
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let p = PathBuf::from(&home).join("Library/Application Support/Steam");
        if p.exists() {
            vec![p]
        } else {
            vec![]
        }
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        vec![]
    }
}

fn legendary_install_url() -> String {
    "https://github.com/derrod/legendary/releases/latest".to_string()
}

#[cfg(windows)]
fn find_legendary_executable() -> Option<String> {
    let output = Command::new("where")
        .arg("legendary")
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

#[cfg(not(windows))]
fn find_legendary_executable() -> Option<String> {
    let output = Command::new("which").arg("legendary").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn legendary_command_path() -> String {
    find_legendary_executable().unwrap_or_else(|| "legendary".to_string())
}

fn run_legendary_capture(args: &[&str]) -> Result<std::process::Output, String> {
    let executable = legendary_command_path();
    let mut command = Command::new(&executable);
    command.args(args);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    command
        .output()
        .map_err(|e| format!("Failed to run Legendary ({}): {}", executable, e))
}

fn run_legendary_json(args: &[&str]) -> Result<Value, String> {
    let output = run_legendary_capture(args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!("Legendary exited with status {}", output.status)
        } else {
            detail
        });
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse Legendary JSON output: {}", e))
}

fn json_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn json_nested_string_field(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for segment in path {
        cursor = cursor.get(*segment)?;
    }
    cursor
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn json_bool_field(value: &Value, keys: &[&str]) -> Option<bool> {
    for key in keys {
        if let Some(flag) = value.get(*key).and_then(Value::as_bool) {
            return Some(flag);
        }
    }
    None
}

fn parse_legendary_status(value: &Value) -> (bool, Option<String>) {
    let authenticated = json_bool_field(value, &["logged_in", "loggedIn", "authenticated", "is_authenticated"])
        .or_else(|| value.get("account").filter(|entry| !entry.is_null()).map(|_| true))
        .or_else(|| value.get("user").filter(|entry| !entry.is_null()).map(|_| true))
        .unwrap_or(false);
    let display_name = json_string_field(value, &["display_name", "displayName", "account_name", "accountName"])
        .or_else(|| json_nested_string_field(value, &["account", "displayName"]))
        .or_else(|| json_nested_string_field(value, &["account", "name"]))
        .or_else(|| json_nested_string_field(value, &["user", "displayName"]))
        .or_else(|| json_nested_string_field(value, &["user", "name"]));
    (authenticated, display_name)
}

#[cfg(windows)]
fn resolve_epic_installed_exe(exe: Option<String>, install_path: Option<String>) -> Option<String> {
    candidate_from_paths(exe, install_path)
}

#[cfg(not(windows))]
fn resolve_epic_installed_exe(exe: Option<String>, install_path: Option<String>) -> Option<String> {
    exe.filter(|value| Path::new(value).is_file()).or(install_path)
}

fn parse_legendary_owned_entry(value: &Value) -> Option<EpicOwnedGame> {
    let app_name = json_string_field(value, &["app_name", "appName"])?;
    let title = json_string_field(value, &["app_title", "title", "name"])
        .or_else(|| json_nested_string_field(value, &["metadata", "title"]))
        .or_else(|| json_nested_string_field(value, &["metadata", "app_title"]))
        .unwrap_or_else(|| app_name.clone());
    Some(EpicOwnedGame {
        app_name,
        title,
        installed: false,
        install_path: None,
        exe: None,
        version: json_string_field(value, &["version", "app_version", "build_version"]),
    })
}

fn parse_legendary_installed_entry(value: &Value) -> Option<EpicOwnedGame> {
    let app_name = json_string_field(value, &["app_name", "appName"])?;
    let install_path = json_string_field(value, &["install_path", "installPath", "install_dir", "installDir"]);
    let exe_hint = json_string_field(value, &["executable", "launch_executable", "launchExecutable", "main_executable"]);
    let exe = resolve_epic_installed_exe(exe_hint, install_path.clone());
    let title = json_string_field(value, &["title", "app_title", "name"])
        .or_else(|| json_nested_string_field(value, &["metadata", "title"]))
        .unwrap_or_else(|| app_name.clone());
    Some(EpicOwnedGame {
        app_name,
        title,
        installed: true,
        install_path,
        exe,
        version: json_string_field(value, &["version", "app_version", "build_version"]),
    })
}

fn steam_library_paths() -> Vec<PathBuf> {
    let mut roots = HashSet::<PathBuf>::new();
    for steam_root in steam_root_paths() {
        roots.insert(steam_root.clone());
        let library_vdf = steam_root.join("steamapps").join("libraryfolders.vdf");
        let Ok(raw) = read_text_file_resilient(&library_vdf) else {
            continue;
        };
        for line in raw.lines() {
            if let Some((key, value)) = kv_pair(line.trim()) {
                if key.eq_ignore_ascii_case("path") && !value.trim().is_empty() {
                    let normalized = value.replace("\\\\", "\\");
                    roots.insert(PathBuf::from(normalized));
                }
            }
        }
    }
    let mut out: Vec<PathBuf> = roots.into_iter().collect();
    out.sort();
    out
}

fn detect_game_executable(root: &Path) -> Option<String> {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let ext = entry
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "exe" | "bat" | "cmd" | "com" | "sh" | "appimage") {
            continue;
        }
        let path = entry.path();
        let path_str = path.to_string_lossy().into_owned();
        let file_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        if is_blocked(&file_name, &path_str) {
            continue;
        }
        let depth = path
            .strip_prefix(root)
            .ok()
            .map(|p| p.components().count())
            .unwrap_or(99);
        let generic_penalty = if is_generic_name(&file_name) { 1 } else { 0 };
        let key = format!("{:02}-{:02}-{}", generic_penalty, depth, path_str.to_lowercase());
        candidates.push((key, path.to_path_buf()));
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    candidates
        .into_iter()
        .next()
        .map(|(_, path)| path.to_string_lossy().into_owned())
}

fn parse_steam_manifest(path: &Path) -> Option<SteamLibraryEntry> {
    let raw = read_text_file_resilient(path).ok()?;
    let mut app_id = String::new();
    let mut name = String::new();
    let mut install_dir = String::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some((key, value)) = kv_pair(trimmed) {
            match key {
                "appid" => app_id = value.to_string(),
                "name" => name = value.to_string(),
                "installdir" => install_dir = value.to_string(),
                _ => {}
            }
        }
    }
    if app_id.is_empty() || install_dir.is_empty() {
        return None;
    }
    let library_dir = path.parent()?.parent()?.to_path_buf();
    let game_dir = library_dir.join("common").join(&install_dir);
    let exe = detect_game_executable(&game_dir);
    Some(SteamLibraryEntry {
        app_id,
        name,
        install_dir: game_dir.to_string_lossy().into_owned(),
        library_dir: library_dir.to_string_lossy().into_owned(),
        manifest_path: path.to_string_lossy().into_owned(),
        exe,
    })
}

fn parse_steam_profile_reference(profile_ref: &str) -> Result<String, String> {
    let trimmed = profile_ref.trim();
    if trimmed.is_empty() {
        return Err("Steam profile / SteamID is required".to_string());
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Ok(trimmed.to_string());
    }
    if let Ok(url) = reqwest::Url::parse(trimmed) {
        let segments: Vec<String> = url
            .path_segments()
            .map(|items| items.filter(|item| !item.is_empty()).map(|item| item.to_string()).collect())
            .unwrap_or_default();
        if segments.len() >= 2 {
            if segments[0].eq_ignore_ascii_case("profiles") && segments[1].chars().all(|c| c.is_ascii_digit()) {
                return Ok(segments[1].clone());
            }
            if segments[0].eq_ignore_ascii_case("id") {
                return Ok(segments[1].clone());
            }
        }
    }
    Ok(trimmed.to_string())
}

async fn resolve_steam_profile_id(api_key: &str, profile_ref: &str) -> Result<String, String> {
    let candidate = parse_steam_profile_reference(profile_ref)?;
    if candidate.chars().all(|c| c.is_ascii_digit()) {
        return Ok(candidate);
    }

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/")
        .query(&[("key", api_key), ("vanityurl", candidate.as_str())])
        .send()
        .await
        .map_err(|e| format!("Failed to resolve Steam vanity URL: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Steam vanity lookup failed with status {}: {}", status, body));
    }

    let payload: SteamResolveVanityResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Steam vanity lookup response: {}", e))?;
    if payload.response.success != 1 {
        return Err(payload.response.message.unwrap_or_else(|| "Steam vanity lookup failed".to_string()));
    }

    payload
        .response
        .steamid
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Steam vanity lookup did not return a SteamID".to_string())
}

/// Reads Steam's `localconfig.vdf` for every user directory found under the
/// default Steam path and returns playtime data for all apps.
/// Falls back gracefully if Steam is not installed or the file is unreadable.
#[tauri::command]
fn import_steam_playtime() -> Vec<SteamEntry> {
    let mut results: Vec<SteamEntry> = Vec::new();

    for root in &steam_root_paths() {
        let userdata = root.join("userdata");
        let Ok(user_dirs) = std::fs::read_dir(&userdata) else {
            continue;
        };
        for user_dir in user_dirs.filter_map(|e| e.ok()) {
            let cfg = user_dir.path().join("config").join("localconfig.vdf");
            let Ok(content) = read_text_file_resilient(&cfg) else {
                continue;
            };
            // Simple line-based VDF parser (not full KV spec but covers localconfig)
            parse_localconfig_vdf(&content, &mut results);
        }
    }

    let installed_names_by_app_id: HashMap<String, String> = import_steam_library()
        .into_iter()
        .map(|entry| (entry.app_id, entry.name))
        .collect();
    for entry in &mut results {
        if entry.name.trim().is_empty() {
            if let Some(name) = installed_names_by_app_id.get(&entry.app_id) {
                entry.name = name.clone();
            } else {
                entry.name = format!("App {}", entry.app_id);
            }
        }
    }

    // Deduplicate by app_id, keeping the highest played time
    results.sort_by(|a, b| a.app_id.cmp(&b.app_id));
    results.dedup_by(|a, b| {
        if a.app_id == b.app_id {
            b.played_minutes = b.played_minutes.max(a.played_minutes);
            true
        } else {
            false
        }
    });
    // Sort by playtime descending for convenience
    results.sort_by(|a, b| b.played_minutes.cmp(&a.played_minutes));
    results
}

#[tauri::command]
fn get_steam_playtime_minutes(app_id: String) -> Option<u64> {
    import_steam_playtime()
        .into_iter()
        .find(|entry| entry.app_id == app_id)
        .map(|entry| entry.played_minutes)
}

#[tauri::command]
fn import_steam_library() -> Vec<SteamLibraryEntry> {
    let mut entries = Vec::<SteamLibraryEntry>::new();
    for library_dir in steam_library_paths() {
        let steamapps = library_dir.join("steamapps");
        let Ok(read_dir) = std::fs::read_dir(&steamapps) else {
            continue;
        };
        for entry in read_dir.filter_map(|e| e.ok()) {
            let path = entry.path();
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }
            if let Some(parsed) = parse_steam_manifest(&path) {
                entries.push(parsed);
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
}

#[tauri::command]
async fn fetch_steam_owned_games(api_key: String, profile_ref: String) -> Result<Vec<SteamOwnedGame>, String> {
    let api_key_trimmed = api_key.trim();
    if api_key_trimmed.is_empty() {
        return Err("Steam Web API key cannot be empty".to_string());
    }

    let steam_id = resolve_steam_profile_id(api_key_trimmed, &profile_ref).await?;
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/")
        .query(&[
            ("key", api_key_trimmed),
            ("steamid", steam_id.as_str()),
            ("include_appinfo", "1"),
            ("include_played_free_games", "1"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Steam owned games: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Steam owned-games request failed with status {}: {}", status, body));
    }

    let payload: SteamOwnedGamesResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Steam owned-games response: {}", e))?;

    let installed_by_app_id: HashMap<String, SteamLibraryEntry> = import_steam_library()
        .into_iter()
        .map(|entry| (entry.app_id.clone(), entry))
        .collect();

    let mut games: Vec<SteamOwnedGame> = payload
        .response
        .games
        .unwrap_or_default()
        .into_iter()
        .map(|entry| {
            let app_id = entry.appid.to_string();
            let installed = installed_by_app_id.get(&app_id);
            SteamOwnedGame {
                app_id: app_id.clone(),
                name: entry
                    .name
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| format!("App {}", app_id)),
                played_minutes: entry.playtime_forever.unwrap_or(0),
                installed: installed.is_some(),
                install_dir: installed.map(|value| value.install_dir.clone()),
                library_dir: installed.map(|value| value.library_dir.clone()),
                manifest_path: installed.map(|value| value.manifest_path.clone()),
                exe: installed.and_then(|value| value.exe.clone()),
            }
        })
        .collect();

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(games)
}

#[tauri::command]
fn epic_legendary_status() -> EpicLegendaryStatus {
    let install_url = legendary_install_url();
    let executable_path = find_legendary_executable();
    let Ok(version_output) = run_legendary_capture(&["--version"]) else {
        return EpicLegendaryStatus {
            available: false,
            authenticated: false,
            executable_path,
            version: None,
            display_name: None,
            install_url,
            last_error: Some("Legendary was not found in PATH. Install the standalone binary or legendary-gl first.".to_string()),
        };
    };
    if !version_output.status.success() {
        return EpicLegendaryStatus {
            available: false,
            authenticated: false,
            executable_path,
            version: None,
            display_name: None,
            install_url,
            last_error: Some(String::from_utf8_lossy(&version_output.stderr).trim().to_string()),
        };
    }

    let version = String::from_utf8_lossy(&version_output.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string);

    match run_legendary_json(&["status", "--json"]) {
        Ok(status_json) => {
            let (authenticated, display_name) = parse_legendary_status(&status_json);
            EpicLegendaryStatus {
                available: true,
                authenticated,
                executable_path,
                version,
                display_name,
                install_url,
                last_error: None,
            }
        }
        Err(error) => EpicLegendaryStatus {
            available: true,
            authenticated: false,
            executable_path,
            version,
            display_name: None,
            install_url,
            last_error: Some(error),
        },
    }
}

#[tauri::command]
fn epic_legendary_auth() -> Result<(), String> {
    let executable = legendary_command_path();
    Command::new(executable)
        .arg("auth")
        .spawn()
        .map_err(|e| format!("Failed to start Legendary authentication: {}", e))?;
    Ok(())
}

#[tauri::command]
fn fetch_epic_owned_games() -> Result<Vec<EpicOwnedGame>, String> {
    let status = epic_legendary_status();
    if !status.available {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Legendary is not installed.".to_string()));
    }
    if !status.authenticated {
        return Err(status
            .last_error
            .unwrap_or_else(|| "Legendary is installed but not authenticated yet. Run Legendary auth first.".to_string()));
    }

    let owned_json = run_legendary_json(&["list", "--json"])?;
    let installed_json = run_legendary_json(&["list-installed", "--json", "--show-dirs"])
        .unwrap_or_else(|_| Value::Array(Vec::new()));

    let mut by_app_name = HashMap::<String, EpicOwnedGame>::new();
    if let Some(entries) = owned_json.as_array() {
        for entry in entries {
            if let Some(game) = parse_legendary_owned_entry(entry) {
                by_app_name.insert(game.app_name.to_lowercase(), game);
            }
        }
    }
    if let Some(entries) = installed_json.as_array() {
        for entry in entries {
            if let Some(game) = parse_legendary_installed_entry(entry) {
                let key = game.app_name.to_lowercase();
                match by_app_name.get_mut(&key) {
                    Some(existing) => {
                        existing.installed = true;
                        existing.install_path = game.install_path.clone().or(existing.install_path.clone());
                        existing.exe = game.exe.clone().or(existing.exe.clone());
                        existing.version = game.version.clone().or(existing.version.clone());
                        if existing.title.trim().is_empty() {
                            existing.title = game.title.clone();
                        }
                    }
                    None => {
                        by_app_name.insert(key, game);
                    }
                }
            }
        }
    }

    let mut games: Vec<EpicOwnedGame> = by_app_name.into_values().collect();
    games.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(games)
}

#[tauri::command]
fn launch_steam_game(app_id: String) -> Result<(), String> {
    let app_id_trimmed = app_id.trim();
    if app_id_trimmed.is_empty() {
        return Err("Steam app ID cannot be empty".to_string());
    }
    let target = format!("steam://rungameid/{}", app_id_trimmed);
    open_uri_target(&target)
}

#[tauri::command]
fn install_steam_game(app_id: String) -> Result<(), String> {
    let app_id_trimmed = app_id.trim();
    if app_id_trimmed.is_empty() {
        return Err("Steam app ID cannot be empty".to_string());
    }
    let target = format!("steam://install/{}", app_id_trimmed);
    open_uri_target(&target)
}

#[tauri::command]
fn launch_epic_game(app_name: String) -> Result<(), String> {
    let trimmed = app_name.trim();
    if trimmed.is_empty() {
        return Err("Epic app name cannot be empty".to_string());
    }
    let executable = legendary_command_path();
    let mut command = Command::new(executable);
    command.args(["launch", trimmed]);
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map_err(|e| format!("Failed to start Legendary launch: {}", e))?;
    Ok(())
}

#[tauri::command]
fn install_epic_game(app_name: String) -> Result<(), String> {
    let trimmed = app_name.trim();
    if trimmed.is_empty() {
        return Err("Epic app name cannot be empty".to_string());
    }
    let executable = legendary_command_path();
    Command::new(executable)
        .args(["install", trimmed])
        .spawn()
        .map_err(|e| format!("Failed to start Legendary install: {}", e))?;
    Ok(())
}

#[tauri::command]
fn launch_store_uri(uri: String) -> Result<(), String> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        return Err("Store URI cannot be empty".to_string());
    }
    if !is_allowed_store_uri(trimmed) {
        return Err("Unsupported store URI scheme".to_string());
    }
    open_uri_target(trimmed)
}

/// Extracts Steam app playtime from localconfig.vdf's Apps section.
fn parse_localconfig_vdf(src: &str, out: &mut Vec<SteamEntry>) {
    let mut pending_block_key: Option<String> = None;
    let mut stack: Vec<String> = Vec::new();
    let mut current_app: Option<(String, usize)> = None;
    let mut collected: HashMap<String, SteamEntry> = HashMap::new();

    let mut lines = src.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "{" {
            if let Some(key) = pending_block_key.take() {
                stack.push(key.clone());
                let parent_is_apps = stack
                    .iter()
                    .rev()
                    .nth(1)
                    .map(|segment| segment.eq_ignore_ascii_case("apps"))
                    .unwrap_or(false);
                if parent_is_apps && key.chars().all(|c| c.is_ascii_digit()) {
                    current_app = Some((key.clone(), stack.len()));
                    collected.entry(key.clone()).or_insert(SteamEntry {
                        app_id: key,
                        name: String::new(),
                        played_minutes: 0,
                    });
                }
            }
            continue;
        }

        if trimmed == "}" {
            pending_block_key = None;
            if current_app
                .as_ref()
                .map(|(_, depth)| *depth == stack.len())
                .unwrap_or(false)
            {
                current_app = None;
            }
            stack.pop();
            continue;
        }

        if let Some((key, value)) = kv_pair(trimmed) {
            pending_block_key = None;
            if let Some((app_id, _)) = &current_app {
                if let Some(entry) = collected.get_mut(app_id) {
                    match key.to_ascii_lowercase().as_str() {
                        "name" => {
                            if entry.name.is_empty() && !value.trim().is_empty() {
                                entry.name = value.to_string();
                            }
                        }
                        "playtime" | "playtime_forever" => {
                            let parsed = value.parse().unwrap_or(0);
                            if parsed > entry.played_minutes {
                                entry.played_minutes = parsed;
                            }
                        }
                        _ => {}
                    }
                }
            }
            continue;
        }

        if let Some(value) = quoted_value(trimmed) {
            pending_block_key = Some(value.to_string());
        }
    }

    out.extend(collected.into_values().filter(|entry| entry.played_minutes > 0));
}

fn quoted_value(s: &str) -> Option<&str> {
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        Some(&s[1..s.len() - 1])
    } else {
        None
    }
}

fn kv_pair(line: &str) -> Option<(&str, &str)> {
    // Format: "key"  "value"  OR  "key"\t"value"
    let s = line.trim();
    if !s.starts_with('"') {
        return None;
    }
    let end_key = s[1..].find('"')? + 2; // index of closing quote in original
    let key = &s[1..end_key - 1];
    let rest = s[end_key..].trim();
    let val = quoted_value(rest)?;
    Some((key, val))
}

#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, tooltip: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

#[tauri::command]
async fn fetch_rss(url: String) -> Result<String, String> {
    reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_string_to_file(path: String, contents: String) -> Result<(), String> {
    atomic_write_string(Path::new(&path), &contents, "save_string_to_file")
}

#[tauri::command]
fn diagnose_permissions_failure(
    operation: String,
    target_path: Option<String>,
    raw_error: String,
) -> PermissionDiagnostic {
    diagnose_permission_issue(&operation, target_path.as_deref(), &raw_error)
}

#[tauri::command]
fn create_snapshot(request: SnapshotRequest) -> Result<SnapshotResult, String> {
    let created_at = now_ms();
    let label = request.label.as_deref().map(sanitize_snapshot_label);
    let id = match label.as_deref() {
        Some(l) if !l.is_empty() => format!("{}-{}", created_at, l),
        _ => format!("snapshot-{}", created_at),
    };
    let dir = snapshots_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.json"));
    let payload = serde_json::json!({
        "schema": "libmaly-snapshot-v1",
        "id": id,
        "createdAt": created_at,
        "label": request.label,
        "reason": request.reason,
        "portableMode": is_portable_mode(),
        "entries": request.entries,
    });
    let raw = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    atomic_write_string(&path, &raw, "create_snapshot")?;
    prune_old_snapshots(30);
    Ok(SnapshotResult {
        id,
        path: path.to_string_lossy().to_string(),
        created_at,
        entry_count: payload["entries"].as_object().map(|x| x.len()).unwrap_or(0),
        label: request.label,
        reason: request.reason,
    })
}

#[tauri::command]
fn list_snapshots() -> Result<Vec<SnapshotResult>, String> {
    let dir = snapshots_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::<SnapshotResult>::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let snapshot = match read_snapshot_file(&path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        out.push(SnapshotResult {
            id: snapshot.id,
            path: snapshot.path,
            created_at: snapshot.created_at,
            entry_count: snapshot.entry_count,
            label: snapshot.label,
            reason: snapshot.reason,
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
fn restore_snapshot(path: String) -> Result<SnapshotContents, String> {
    read_snapshot_file(Path::new(&path))
}

#[tauri::command]
fn preview_restore_snapshot(
    path: String,
    current_entries: HashMap<String, String>,
) -> Result<SnapshotRestoreReport, String> {
    let snapshot = read_snapshot_file(Path::new(&path))?;
    Ok(build_snapshot_restore_report(&current_entries, snapshot))
}

#[tauri::command]
fn resolve_sync_conflicts(request: SyncConflictRequest) -> SyncConflictResolutionReport {
    let local_entries = request.local_entries;
    let remote_entries = request.remote_entries;
    let base_entries = request.base_entries.unwrap_or_default();

    let mut all_keys = HashSet::<String>::new();
    for key in local_entries.keys() {
        all_keys.insert(key.clone());
    }
    for key in remote_entries.keys() {
        all_keys.insert(key.clone());
    }
    for key in base_entries.keys() {
        all_keys.insert(key.clone());
    }

    let mut sorted_keys: Vec<String> = all_keys.into_iter().collect();
    sorted_keys.sort();

    let mut resolved_entries = HashMap::<String, String>::new();
    let mut items = Vec::<SyncConflictItem>::new();
    let mut changed_keys = Vec::<String>::new();
    let mut conflict_count = 0usize;

    for key in sorted_keys {
        let local = local_entries.get(&key);
        let remote = remote_entries.get(&key);
        let base = base_entries.get(&key);
        let (resolved, resolution, reason, requires_manual) = if local == remote {
            (local.cloned().or_else(|| remote.cloned()), "same", "Local and remote already match", false)
        } else if base.is_some() && local == base {
            (remote.cloned(), "remote", "Remote changed while local stayed at base", false)
        } else if base.is_some() && remote == base {
            (local.cloned(), "local", "Local changed while remote stayed at base", false)
        } else if local.is_none() && remote.is_some() {
            (remote.cloned(), "remote", "Only remote has this entry", false)
        } else if remote.is_none() && local.is_some() {
            (local.cloned(), "local", "Only local has this entry", false)
        } else {
            conflict_count += 1;
            (
                remote.cloned().or_else(|| local.cloned()),
                "remote",
                "Both local and remote changed relative to base. Choose which version to keep.",
                true,
            )
        };

        if let Some(value) = resolved.clone() {
            resolved_entries.insert(key.clone(), value);
        } else {
            resolved_entries.remove(&key);
        }
        let changed = local != remote || base != resolved.as_ref();
        if changed {
            changed_keys.push(key.clone());
            items.push(SyncConflictItem {
                key: key.clone(),
                label: snapshot_entry_label(&key),
                resolution: resolution.to_string(),
                reason: reason.to_string(),
                local_count: count_snapshot_entry(local),
                remote_count: count_snapshot_entry(remote),
                base_count: count_snapshot_entry(base),
                local_value: local.cloned(),
                remote_value: remote.cloned(),
                base_value: base.cloned(),
                requires_manual,
            });
        }
    }

    SyncConflictResolutionReport {
        resolved_entries,
        items,
        conflict_count,
        changed_keys,
    }
}

fn apply_sync_resolution_choice(
    merged_entries: &mut HashMap<String, String>,
    key: &str,
    choice: &str,
    local_value: Option<&String>,
    remote_value: Option<&String>,
    base_value: Option<&String>,
) -> Result<(), String> {
    let selected = match choice {
        "local" => local_value.cloned(),
        "remote" => remote_value.cloned(),
        "base" => base_value.cloned(),
        other => return Err(format!("Unsupported sync conflict resolution: {}", other)),
    };

    if let Some(value) = selected {
        merged_entries.insert(key.to_string(), value);
    } else {
        merged_entries.remove(key);
    }

    Ok(())
}

#[tauri::command]
fn apply_backup_retention_policy(
    policy: BackupRetentionPolicy,
) -> Result<BackupRetentionApplyResult, String> {
    let (snapshots_deleted, snapshots_kept) = prune_dir_with_retention(&snapshots_dir(), &policy);
    let (save_backups_deleted, save_backups_kept) = prune_dir_with_retention(&save_backups_dir(), &policy);
    Ok(BackupRetentionApplyResult {
        snapshots_deleted,
        save_backups_deleted,
        snapshots_kept,
        save_backups_kept,
    })
}

#[tauri::command]
fn read_string_from_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recent_logs(limit: Option<usize>) -> Vec<RustLogEntry> {
    let logs = rust_log_buffer().lock().unwrap();
    let take_n = limit.unwrap_or(200).min(MAX_RUST_LOGS);
    if logs.len() <= take_n {
        logs.clone()
    } else {
        logs[logs.len() - take_n..].to_vec()
    }
}

#[tauri::command]
fn clear_recent_logs() -> Result<(), String> {
    rust_log_buffer().lock().unwrap().clear();
    Ok(())
}

#[tauri::command]
fn get_last_crash_report(app: AppHandle) -> Option<CrashReport> {
    let path = crash_report_path(&app, CRASH_REPORT_FILE);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
fn clear_last_crash_report(app: AppHandle) -> Result<(), String> {
    let path = crash_report_path(&app, CRASH_REPORT_FILE);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct StateStore {
    schema_version: u32,
    entries: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncBaseStore {
    provider_type: sync::SyncProviderType,
    entries: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageBootstrap {
    unified: bool,
    entries: HashMap<String, String>,
}

const CURRENT_SCHEMA_VERSION: u32 = 1;
const STATE_STORAGE_FILE: &str = "state.json";
const PORTABLE_STORAGE_FILE: &str = "portable_storage.json";

fn migrate_state_store(mut store: StateStore) -> Result<StateStore, String> {
    // Forward migrations
    if store.schema_version == 0 {
        // v0 -> v1 migration
        push_rust_log(None, "info", "Migrating state store from v0 to v1");
        store.schema_version = 1;
    }
    
    if store.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!("Schema migration stopped at unsupported version {}", store.schema_version));
    }
    Ok(store)
}

#[tauri::command]
fn get_storage_bootstrap() -> Result<StorageBootstrap, String> {
    let dir = app_data_root();
    let state_path = dir.join(STATE_STORAGE_FILE);
    let legacy_portable_path = dir.join(PORTABLE_STORAGE_FILE);

    let mut initial_store = if state_path.exists() {
        let raw = std::fs::read_to_string(&state_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<StateStore>(&raw).unwrap_or_else(|_| {
            let entries: HashMap<String, String> = serde_json::from_str(&raw).unwrap_or_default();
            StateStore { schema_version: 0, entries }
        })
    } else if legacy_portable_path.exists() {
        let raw = std::fs::read_to_string(&legacy_portable_path).map_err(|e| e.to_string())?;
        let entries: HashMap<String, String> = serde_json::from_str(&raw).unwrap_or_default();
        StateStore { schema_version: 0, entries }
    } else {
        StateStore { schema_version: CURRENT_SCHEMA_VERSION, entries: HashMap::new() }
    };

    if initial_store.schema_version < CURRENT_SCHEMA_VERSION {
        // Ensure rollback potential by backing up existing file if present
        if state_path.exists() {
            let bak_path = dir.join(format!("{}.bak", STATE_STORAGE_FILE));
            let _ = std::fs::copy(&state_path, &bak_path);
        }

        match migrate_state_store(initial_store.clone()) {
            Ok(migrated) => {
                let raw = serde_json::to_string(&migrated).map_err(|e| e.to_string())?;
                if let Err(e) = atomic_write_string(&state_path, &raw, "schema_migration") {
                    push_rust_log(None, "error", format!("Failed to save migrated state: {}", e));
                    return Err(e);
                }
                initial_store = migrated;
            }
            Err(e) => {
                return Err(format!("Storage migration failed (rolled back / aborting): {}", e));
            }
        }
    }

    Ok(StorageBootstrap {
        unified: true,
        entries: initial_store.entries,
    })
}

#[tauri::command]
fn persist_storage_snapshot(entries: HashMap<String, String>) -> Result<(), String> {
    let dir = app_data_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(STATE_STORAGE_FILE);
    
    let store = StateStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        entries,
    };
    
    let raw = serde_json::to_string(&store).map_err(|e| e.to_string())?;
    atomic_write_string(&path, &raw, "persist_storage_snapshot")
}

const SYNC_CONFIG_FILE: &str = "sync_config.json";
const SYNC_BASE_STATE_FILE: &str = "sync_base_state.json";

fn sync_config_path() -> PathBuf {
    profile_file_path(SYNC_CONFIG_FILE)
}

fn sync_base_state_path() -> PathBuf {
    profile_file_path(SYNC_BASE_STATE_FILE)
}

fn legacy_sync_config_path() -> PathBuf {
    legacy_global_file_path(SYNC_CONFIG_FILE)
}

fn legacy_sync_base_state_path() -> PathBuf {
    legacy_global_file_path(SYNC_BASE_STATE_FILE)
}

fn empty_state_store() -> StateStore {
    StateStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        entries: HashMap::new(),
    }
}

fn parse_state_store(raw: &str) -> Result<StateStore, String> {
    if raw.trim().is_empty() {
        return Ok(empty_state_store());
    }

    if let Ok(store) = serde_json::from_str::<StateStore>(raw) {
        return Ok(store);
    }

    let entries = serde_json::from_str::<HashMap<String, String>>(raw)
        .map_err(|e| format!("Invalid state payload: {}", e))?;
    Ok(StateStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        entries,
    })
}

fn load_sync_base_entries(provider_type: sync::SyncProviderType) -> Result<HashMap<String, String>, String> {
    let path = sync_base_state_path();
    if !path.exists() {
        let legacy_path = legacy_sync_base_state_path();
        if !legacy_path.exists() {
            return Ok(HashMap::new());
        }
        let raw = std::fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
        let base_store = serde_json::from_str::<SyncBaseStore>(&raw).map_err(|e| e.to_string())?;
        if base_store.provider_type != provider_type {
            return Ok(HashMap::new());
        }
        persist_sync_base_entries(provider_type, &base_store.entries)?;
        let _ = std::fs::remove_file(legacy_path);
        return Ok(base_store.entries);
    }

    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let base_store = serde_json::from_str::<SyncBaseStore>(&raw).map_err(|e| e.to_string())?;
    if base_store.provider_type != provider_type {
        return Ok(HashMap::new());
    }

    Ok(base_store.entries)
}

fn persist_sync_base_entries(
    provider_type: sync::SyncProviderType,
    entries: &HashMap<String, String>,
) -> Result<(), String> {
    if let Some(parent) = sync_base_state_path().parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string(&SyncBaseStore {
        provider_type,
        entries: entries.clone(),
    })
    .map_err(|e| e.to_string())?;
    atomic_write_string(&sync_base_state_path(), &raw, "persist_sync_base_entries")
}

fn parse_sync_config(raw: &str) -> Result<sync::SyncProviderConfig, String> {
    if let Ok(config) = serde_json::from_str::<sync::SyncProviderConfig>(raw) {
        return Ok(config);
    }

    let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let provider = value
        .get("provider")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "Missing sync provider".to_string())?;

    if value.get("config").is_some() {
        return serde_json::from_value(value).map_err(|e| e.to_string());
    }

    let mut legacy_config = value.clone();
    if let Some(obj) = legacy_config.as_object_mut() {
        obj.remove("provider");
    }

    match provider {
        "webdav" => serde_json::from_value::<sync::WebdavConfig>(legacy_config)
            .map(sync::SyncProviderConfig::Webdav)
            .map_err(|e| e.to_string()),
        "nextcloud" => serde_json::from_value::<sync::NextcloudConfig>(legacy_config)
            .map(sync::SyncProviderConfig::Nextcloud)
            .map_err(|e| e.to_string()),
        "s3" => serde_json::from_value::<sync::S3Config>(legacy_config)
            .map(sync::SyncProviderConfig::S3)
            .map_err(|e| e.to_string()),
        "git" => serde_json::from_value::<sync::GitConfig>(legacy_config)
            .map(sync::SyncProviderConfig::Git)
            .map_err(|e| e.to_string()),
        "google-drive" => serde_json::from_value::<sync::GoogleDriveConfig>(legacy_config)
            .map(sync::SyncProviderConfig::GoogleDrive)
            .map_err(|e| e.to_string()),
        "dropbox" => serde_json::from_value::<sync::DropboxConfig>(legacy_config)
            .map(sync::SyncProviderConfig::Dropbox)
            .map_err(|e| e.to_string()),
        other => Err(format!("Unsupported sync provider: {}", other)),
    }
}

fn sync_secret_pairs(config: &sync::SyncProviderConfig) -> Vec<(&'static str, Option<String>)> {
    match config {
        sync::SyncProviderConfig::Webdav(cfg) => vec![("sync::webdav::password", Some(cfg.password.clone()))],
        sync::SyncProviderConfig::Nextcloud(cfg) => vec![("sync::nextcloud::password", Some(cfg.password.clone()))],
        sync::SyncProviderConfig::S3(cfg) => vec![
            ("sync::s3::access_key", Some(cfg.access_key.clone())),
            ("sync::s3::secret_key", Some(cfg.secret_key.clone())),
        ],
        sync::SyncProviderConfig::Git(cfg) => vec![("sync::git::password", cfg.password.clone())],
        sync::SyncProviderConfig::GoogleDrive(cfg) => vec![
            ("sync::google_drive::access_token", Some(cfg.access_token.clone())),
            ("sync::google_drive::refresh_token", cfg.refresh_token.clone()),
        ],
        sync::SyncProviderConfig::Dropbox(cfg) => vec![
            ("sync::dropbox::access_token", Some(cfg.access_token.clone())),
            ("sync::dropbox::refresh_token", cfg.refresh_token.clone()),
        ],
    }
}

fn sync_config_without_secrets(config: &sync::SyncProviderConfig) -> sync::SyncProviderConfig {
    match config {
        sync::SyncProviderConfig::Webdav(cfg) => sync::SyncProviderConfig::Webdav(sync::WebdavConfig {
            url: cfg.url.clone(),
            username: cfg.username.clone(),
            password: String::new(),
            path: cfg.path.clone(),
        }),
        sync::SyncProviderConfig::Nextcloud(cfg) => sync::SyncProviderConfig::Nextcloud(sync::NextcloudConfig {
            url: cfg.url.clone(),
            username: cfg.username.clone(),
            password: String::new(),
            path: cfg.path.clone(),
        }),
        sync::SyncProviderConfig::S3(cfg) => sync::SyncProviderConfig::S3(sync::S3Config {
            bucket: cfg.bucket.clone(),
            region: cfg.region.clone(),
            access_key: String::new(),
            secret_key: String::new(),
            endpoint: cfg.endpoint.clone(),
            path: cfg.path.clone(),
        }),
        sync::SyncProviderConfig::Git(cfg) => sync::SyncProviderConfig::Git(sync::GitConfig {
            url: cfg.url.clone(),
            branch: cfg.branch.clone(),
            username: cfg.username.clone(),
            password: None,
            ssh_key_path: cfg.ssh_key_path.clone(),
        }),
        sync::SyncProviderConfig::GoogleDrive(cfg) => sync::SyncProviderConfig::GoogleDrive(sync::GoogleDriveConfig {
            access_token: String::new(),
            file_name: cfg.file_name.clone(),
            client_id: cfg.client_id.clone(),
            refresh_token: None,
        }),
        sync::SyncProviderConfig::Dropbox(cfg) => sync::SyncProviderConfig::Dropbox(sync::DropboxConfig {
            access_token: String::new(),
            path: cfg.path.clone(),
            client_id: cfg.client_id.clone(),
            refresh_token: None,
        }),
    }
}

fn hydrate_sync_config_secrets(config: sync::SyncProviderConfig) -> Result<sync::SyncProviderConfig, String> {
    Ok(match config {
        sync::SyncProviderConfig::Webdav(mut cfg) => {
            cfg.password = vault_get_secret("sync::webdav::password")?.unwrap_or_default();
            sync::SyncProviderConfig::Webdav(cfg)
        }
        sync::SyncProviderConfig::Nextcloud(mut cfg) => {
            cfg.password = vault_get_secret("sync::nextcloud::password")?.unwrap_or_default();
            sync::SyncProviderConfig::Nextcloud(cfg)
        }
        sync::SyncProviderConfig::S3(mut cfg) => {
            cfg.access_key = vault_get_secret("sync::s3::access_key")?.unwrap_or_default();
            cfg.secret_key = vault_get_secret("sync::s3::secret_key")?.unwrap_or_default();
            sync::SyncProviderConfig::S3(cfg)
        }
        sync::SyncProviderConfig::Git(mut cfg) => {
            cfg.password = vault_get_secret("sync::git::password")?;
            sync::SyncProviderConfig::Git(cfg)
        }
        sync::SyncProviderConfig::GoogleDrive(mut cfg) => {
            cfg.access_token = vault_get_secret("sync::google_drive::access_token")?.unwrap_or_default();
            cfg.refresh_token = vault_get_secret("sync::google_drive::refresh_token")?;
            sync::SyncProviderConfig::GoogleDrive(cfg)
        }
        sync::SyncProviderConfig::Dropbox(mut cfg) => {
            cfg.access_token = vault_get_secret("sync::dropbox::access_token")?.unwrap_or_default();
            cfg.refresh_token = vault_get_secret("sync::dropbox::refresh_token")?;
            sync::SyncProviderConfig::Dropbox(cfg)
        }
    })
}

fn persist_sync_config_secrets(config: &sync::SyncProviderConfig) -> Result<(), String> {
    for (key, value) in sync_secret_pairs(config) {
        if let Some(secret) = value {
            if secret.trim().is_empty() {
                vault_delete_secret(key)?;
            } else {
                vault::set_secret(key, &secret)?;
            }
        } else {
            vault_delete_secret(key)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn sync_configure(config: sync::SyncProviderConfig) -> Result<(), String> {
    persist_sync_config_secrets(&config)?;
    let dir = profile_file_path("");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = sync_config_path();
    
    let raw = serde_json::to_string(&sync_config_without_secrets(&config)).map_err(|e| e.to_string())?;
    atomic_write_string(&path, &raw, "sync_configure")
}

#[tauri::command]
async fn sync_get_config() -> Result<Option<sync::SyncProviderConfig>, String> {
    let path = sync_config_path();
    
    if !path.exists() {
        let legacy_path = legacy_sync_config_path();
        if !legacy_path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
        let config = parse_sync_config(&raw)?;
        sync_configure(config.clone()).await?;
        let _ = std::fs::remove_file(legacy_path);
        return Ok(Some(config));
    }
    
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let config = parse_sync_config(&raw)?;
    Ok(Some(hydrate_sync_config_secrets(config)?))
}

async fn load_effective_sync_config() -> Result<sync::SyncProviderConfig, String> {
    let config = sync_get_config().await?.ok_or("No sync configuration found")?;
    let refreshed = sync::refresh_oauth_config(config).await?;
    sync_configure(refreshed.clone()).await?;
    Ok(refreshed)
}

#[tauri::command]
fn sync_start_oauth(provider: String, client_id: String) -> Result<sync::SyncOAuthStartResult, String> {
    let provider = match provider.as_str() {
        "google-drive" => sync::SyncProviderType::GoogleDrive,
        "dropbox" => sync::SyncProviderType::Dropbox,
        other => return Err(format!("Unsupported OAuth provider: {}", other)),
    };
    sync::start_oauth(provider, client_id)
}

#[tauri::command]
async fn sync_complete_oauth_callback(callback_url: String) -> Result<sync::SyncProviderConfig, String> {
    let oauth_config = sync::complete_oauth_callback(&callback_url).await?;
    let merged_config = match (sync_get_config().await?, oauth_config) {
        (Some(sync::SyncProviderConfig::GoogleDrive(existing)), sync::SyncProviderConfig::GoogleDrive(oauth)) => {
            sync::SyncProviderConfig::GoogleDrive(sync::GoogleDriveConfig {
                access_token: oauth.access_token,
                file_name: if existing.file_name.trim().is_empty() { oauth.file_name } else { existing.file_name },
                client_id: oauth.client_id.or(existing.client_id),
                refresh_token: oauth.refresh_token.or(existing.refresh_token),
            })
        }
        (Some(sync::SyncProviderConfig::Dropbox(existing)), sync::SyncProviderConfig::Dropbox(oauth)) => {
            sync::SyncProviderConfig::Dropbox(sync::DropboxConfig {
                access_token: oauth.access_token,
                path: if existing.path.trim().is_empty() { oauth.path } else { existing.path },
                client_id: oauth.client_id.or(existing.client_id),
                refresh_token: oauth.refresh_token.or(existing.refresh_token),
            })
        }
        (_, config) => config,
    };
    sync_configure(merged_config.clone()).await?;
    Ok(merged_config)
}

#[tauri::command]
async fn sync_preview_conflicts() -> Result<SyncConflictResolutionReport, String> {
    let config = load_effective_sync_config().await?;
    let provider = sync::create_provider(config)?;
    let provider_type = provider.provider_type();

    let dir = app_data_root();
    let state_path = dir.join(STATE_STORAGE_FILE);
    let local_raw = std::fs::read_to_string(&state_path).unwrap_or_default();
    let local_store = parse_state_store(&local_raw)?;

    let (remote_raw, _metadata) = provider.download().await?;
    let remote_store = parse_state_store(&remote_raw)?;
    let base_entries = load_sync_base_entries(provider_type.clone())?;

    Ok(resolve_sync_conflicts(SyncConflictRequest {
        local_entries: local_store.entries,
        remote_entries: remote_store.entries,
        base_entries: Some(base_entries),
    }))
}

#[tauri::command]
async fn sync_upload_save_backup(game_path: String) -> Result<SyncSaveBackupResult, String> {
    let config = load_effective_sync_config().await?;
    let provider = sync::create_provider(config)?;
    let provider_type = provider.provider_type();

    let backup = build_save_backup_zip(&game_path, None)?;
    let zip_path = PathBuf::from(&backup.zip_path);
    let file_name = zip_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "Save backup zip path is missing a file name".to_string())?;
    let zip_bytes = std::fs::read(&zip_path).map_err(|e| e.to_string())?;
    let remote_path = provider.upload_save_backup(&file_name, &zip_bytes).await?;

    Ok(SyncSaveBackupResult {
        zip_path: backup.zip_path,
        files: backup.files,
        directories: backup.directories,
        remote_path,
        provider_type,
    })
}

#[tauri::command]
async fn sync_upload() -> Result<sync::SyncResult, String> {
    let config = load_effective_sync_config().await?;
    let provider = sync::create_provider(config)?;
    let provider_type = provider.provider_type();

    let dir = app_data_root();
    let state_path = dir.join(STATE_STORAGE_FILE);
    let local_raw = std::fs::read_to_string(&state_path).map_err(|e| e.to_string())?;
    let local_store = parse_state_store(&local_raw)?;

    let merged_entries = if provider.exists().await? {
        let (remote_raw, _metadata) = provider.download().await?;
        let remote_store = parse_state_store(&remote_raw)?;
        let base_entries = load_sync_base_entries(provider_type.clone())?;
        let report = resolve_sync_conflicts(SyncConflictRequest {
            local_entries: local_store.entries.clone(),
            remote_entries: remote_store.entries.clone(),
            base_entries: Some(base_entries),
        });
        if report.conflict_count > 0 {
            return Ok(sync::SyncResult {
                success: false,
                message: format!("Conflicts detected: {} entries need manual resolution", report.conflict_count),
                conflicts_detected: true,
                entries_synced: 0,
            });
        }
        report.resolved_entries
    } else {
        local_store.entries.clone()
    };

    let merged_store = StateStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        entries: merged_entries,
    };
    let merged_raw = serde_json::to_string(&merged_store).map_err(|e| e.to_string())?;
    let metadata = sync::SyncMetadata {
        last_sync_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        last_sync_hash: sync::compute_hash(&merged_raw),
        provider_type: provider_type.clone(),
    };

    if merged_raw != local_raw {
        atomic_write_string(&state_path, &merged_raw, "sync_upload_merge_local")?;
    }

    provider.upload(&merged_raw, &metadata).await?;
    persist_sync_base_entries(provider_type, &merged_store.entries)?;
    
    Ok(sync::SyncResult {
        success: true,
        message: "State synced to remote successfully".to_string(),
        conflicts_detected: false,
        entries_synced: merged_store.entries.len(),
    })
}

#[tauri::command]
async fn sync_download() -> Result<sync::SyncResult, String> {
    let config = load_effective_sync_config().await?;
    let provider = sync::create_provider(config)?;
    let provider_type = provider.provider_type();

    let dir = app_data_root();
    let state_path = dir.join(STATE_STORAGE_FILE);
    let local_raw = std::fs::read_to_string(&state_path).unwrap_or_default();
    let local_store = parse_state_store(&local_raw)?;

    let (remote_raw, _metadata) = provider.download().await?;
    let remote_store = parse_state_store(&remote_raw)?;
    let base_entries = load_sync_base_entries(provider_type.clone())?;
    let report = resolve_sync_conflicts(SyncConflictRequest {
        local_entries: local_store.entries.clone(),
        remote_entries: remote_store.entries.clone(),
        base_entries: Some(base_entries),
    });

    if report.conflict_count > 0 {
        return Ok(sync::SyncResult {
            success: false,
            message: format!("Conflicts detected: {} entries need manual resolution", report.conflict_count),
            conflicts_detected: true,
            entries_synced: 0,
        });
    }

    let merged_store = StateStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        entries: report.resolved_entries,
    };
    let merged_raw = serde_json::to_string(&merged_store).map_err(|e| e.to_string())?;

    if merged_raw != local_raw {
        atomic_write_string(&state_path, &merged_raw, "sync_download")?;
    }

    if merged_raw != remote_raw {
        let metadata = sync::SyncMetadata {
            last_sync_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
            last_sync_hash: sync::compute_hash(&merged_raw),
            provider_type: provider_type.clone(),
        };
        provider.upload(&merged_raw, &metadata).await?;
    }

    persist_sync_base_entries(provider_type, &merged_store.entries)?;
    
    Ok(sync::SyncResult {
        success: true,
        message: "State downloaded and merged successfully".to_string(),
        conflicts_detected: false,
        entries_synced: merged_store.entries.len(),
    })
}

#[tauri::command]
async fn sync_resolve_conflicts(resolution: HashMap<String, String>) -> Result<sync::SyncResult, String> {
    let config = load_effective_sync_config().await?;
    let provider = sync::create_provider(config)?;
    let provider_type = provider.provider_type();

    let dir = app_data_root();
    let state_path = dir.join(STATE_STORAGE_FILE);
    let local_raw = std::fs::read_to_string(&state_path).map_err(|e| e.to_string())?;
    let local_store = parse_state_store(&local_raw)?;

    let (remote_raw, _metadata) = provider.download().await?;
    let remote_store = parse_state_store(&remote_raw)?;
    let base_entries = load_sync_base_entries(provider_type.clone())?;
    let report = resolve_sync_conflicts(SyncConflictRequest {
        local_entries: local_store.entries.clone(),
        remote_entries: remote_store.entries.clone(),
        base_entries: Some(base_entries.clone()),
    });

    let mut merged_entries = report.resolved_entries.clone();
    for item in &report.items {
        if let Some(choice) = resolution.get(&item.key) {
            apply_sync_resolution_choice(
                &mut merged_entries,
                &item.key,
                choice,
                local_store.entries.get(&item.key),
                remote_store.entries.get(&item.key),
                base_entries.get(&item.key),
            )?;
        }
    }

    let merged_store = StateStore {
        schema_version: CURRENT_SCHEMA_VERSION,
        entries: merged_entries,
    };
    let merged_raw = serde_json::to_string(&merged_store).map_err(|e| e.to_string())?;

    atomic_write_string(&state_path, &merged_raw, "sync_resolve_conflicts")?;

    let metadata = sync::SyncMetadata {
        last_sync_at: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        last_sync_hash: sync::compute_hash(&merged_raw),
        provider_type: provider_type.clone(),
    };
    provider.upload(&merged_raw, &metadata).await?;
    persist_sync_base_entries(provider_type, &merged_store.entries)?;
    
    Ok(sync::SyncResult {
        success: true,
        message: "Conflicts resolved and state synced".to_string(),
        conflicts_detected: false,
        entries_synced: merged_store.entries.len(),
    })
}

#[tauri::command]
async fn sync_check_remote() -> Result<bool, String> {
    let config = load_effective_sync_config().await?;
    let provider = sync::create_provider(config)?;
    provider.exists().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(screenshot::ActiveGameState(std::sync::Mutex::new(None)))
        .manage(RecentGamesState(std::sync::Mutex::new(Vec::new())))
        .manage(LibraryProfilesState(std::sync::Mutex::new(
            load_library_profile_registry(),
        )))
        .invoke_handler(tauri::generate_handler![
            run_db_vacuum,
            scan_games,
            scan_games_incremental,
            list_executables_in_folder,
            run_integrity_check,
            suggest_auto_heal_paths,
            get_platform,
            detect_wine_runners,
            list_wine_prefixes,
            create_wine_prefix,
            delete_wine_prefix,
            run_winetricks,
            install_dxvk_vkd3d,
            install_prefix_media_fixes,
            discover_shader_cache_artifacts,
            export_shader_cache_bundle,
            import_shader_cache_bundle,
            import_lutris_games,
            import_playnite_games,
            import_gog_galaxy_games,
            import_protocol_store_games,
            import_exotic_store_games,
            itch_butler_status,
            itch_butler_list_owned_games,
            itch_butler_install_game,
            itch_butler_check_updates,
            itch_butler_apply_update,
            launch_game,
            launch_steam_game,
            launch_store_uri,
            kill_game,
            delete_game,
            set_recent_games,
            check_app_update,
            apply_update,
            resolve_metadata_source,
            fetch_metadata_for_url,
            fetch_metadata_by_source,
            fetch_f95_metadata,
            fetch_dlsite_metadata,
            fetch_vndb_metadata,
            fetch_mangagamer_metadata,
            fetch_johren_metadata,
            fetch_fakku_metadata,
            fetch_igdb_metadata,
            fetch_rawg_metadata,
            fetch_mobygames_metadata,
            fetch_custom_metadata_command,
            custom_metadata_list_templates,
            custom_metadata_export_templates,
            custom_metadata_export_templates_to_path,
            custom_metadata_import_templates,
            custom_metadata_import_templates_from_path,
            custom_metadata_delete_template,
            custom_metadata_match_source,
            search_suggest_links,
            set_api_key,
            get_api_key,
            f95_login,
            f95_logout,
            f95_is_logged_in,
            dlsite_login,
            dlsite_logout,
            dlsite_is_logged_in,
            fakku_login,
            fakku_logout,
            fakku_is_logged_in,
            update_game,
            preview_update,
            get_screenshots,
            export_screenshots_zip,
            open_screenshots_folder,
            take_screenshot_manual,
            save_screenshot_tags,
            overwrite_screenshot_png,
            delete_screenshot_file,
            get_screenshot_data_url,
            backup_save_files,
            discord_initialize,
            discord_shutdown,
            discord_get_snapshot,
            discord_set_presence,
            discord_clear_presence,
            discord_open_connected_games_settings,
            import_steam_playtime,
            get_steam_playtime_minutes,
            import_steam_library,
            fetch_steam_owned_games,
            install_steam_game,
            epic_legendary_status,
            epic_legendary_auth,
            fetch_epic_owned_games,
            launch_epic_game,
            install_epic_game,
            get_library_profiles,
            save_library_profile,
            switch_library_profile,
            delete_library_profile,
            set_tray_tooltip,
            fetch_rss,
            save_string_to_file,
            diagnose_permissions_failure,
            create_snapshot,
            list_snapshots,
            restore_snapshot,
            preview_restore_snapshot,
            resolve_sync_conflicts,
            apply_backup_retention_policy,
            read_string_from_file,
            get_recent_logs,
            get_recent_file_ops,
            clear_recent_logs,
            get_scraper_health_snapshot,
            get_last_crash_report,
            clear_last_crash_report,
            get_storage_bootstrap,
            persist_storage_snapshot,
            run_release_reliability_checks,
            sync_configure,
            sync_get_config,
            sync_start_oauth,
            sync_complete_oauth_callback,
            vault::vault_list_entries,
            vault::vault_delete_entry,
            sync_preview_conflicts,
            sync_upload_save_backup,
            sync_upload,
            sync_download,
            sync_resolve_conflicts,
            sync_check_remote,
            detect_save_paths,
            transfer_saves,
            is_valid_save_directory,
        ])
        .setup(|app| {
            push_rust_log(Some(app.handle()), "info", "LIBMALY started");

            // Capture panics into a persisted crash report file and in-app log stream.
            let app_for_panic = app.handle().clone();
            std::panic::set_hook(Box::new(move |panic_info| {
                let message = parse_panic_payload(panic_info);
                let location = panic_info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                    .unwrap_or_else(|| "unknown".to_string());
                let report = CrashReport {
                    ts: now_ms(),
                    thread: std::thread::current()
                        .name()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "unnamed".to_string()),
                    message: message.clone(),
                    location: location.clone(),
                    backtrace: std::backtrace::Backtrace::force_capture().to_string(),
                };
                write_crash_report(&app_for_panic, &report);
                push_rust_log(
                    Some(&app_for_panic),
                    "error",
                    format!("panic: {} @ {}", message, location),
                );
            }));

            // ── System tray ───────────────────────────────────────────────
            let initial_profiles = app.state::<LibraryProfilesState>().0.lock().unwrap().clone();
            let initial_menu = build_tray_menu(app.handle(), &[], &initial_profiles)?;
            #[allow(unused_mut)]
            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("LIBMALY")
                .menu(&initial_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    match id {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ if id.starts_with("profile_switch_") => {
                            let profile_id = id["profile_switch_".len()..].to_string();
                            let profiles_state = app.state::<LibraryProfilesState>();
                            let mut registry = profiles_state.0.lock().unwrap();
                            if registry.profiles.iter().any(|profile| profile.id == profile_id) {
                                registry.active_profile_id = profile_id;
                                let _ = save_library_profile_registry(&registry);
                                let snapshot = registry.clone();
                                drop(registry);
                                refresh_tray(
                                    app,
                                    &app.state::<RecentGamesState>().0.lock().unwrap().clone(),
                                    &snapshot,
                                );
                                let _ = app.emit("library-profile-switched", &snapshot);
                            }
                        }
                        _ if id.starts_with("recent_") => {
                            // Quick-launch game from tray
                            if let Ok(idx) = id["recent_".len()..].parse::<usize>() {
                                let games =
                                    app.state::<RecentGamesState>().0.lock().unwrap().clone();
                                if let Some(game) = games.get(idx) {
                                    let path = game.path.clone();
                                    let app2 = app.clone();
                                    thread::spawn(move || {
                                        let _ = launch_game(app2, path, None, None, None, None);
                                    });
                                }
                            }
                            // Bring window to front when launching from tray
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click toggles window visibility
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    }
                });

            #[cfg(target_os = "macos")]
            {
                // macOS status-bar icon should be treated as a template image for
                // stable NSStatusItem appearance in light/dark menu bars.
                tray_builder = tray_builder.icon_as_template(true);
            }

            tray_builder.build(app)?;
            Ok(())
        })
        // ── Minimize to tray instead of closing ───────────────────────────
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
