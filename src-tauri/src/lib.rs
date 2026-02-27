use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(not(windows))]
use std::collections::HashSet;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use walkdir::WalkDir;

mod metadata;
use metadata::{
    dlsite_is_logged_in, dlsite_login, dlsite_logout, f95_is_logged_in, f95_login, f95_logout,
    fetch_dlsite_metadata, fetch_f95_metadata, search_suggest_links,
};

mod updater;
use updater::{preview_update, update_game};

mod screenshot;
use screenshot::{
    export_screenshots_zip, get_screenshots, open_screenshots_folder, save_screenshot_tags,
    take_screenshot_manual,
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

static RUST_LOG_BUFFER: OnceLock<Mutex<Vec<RustLogEntry>>> = OnceLock::new();
const MAX_RUST_LOGS: usize = 500;
const CRASH_REPORT_FILE: &str = "libmaly_last_crash.json";

fn rust_log_buffer() -> &'static Mutex<Vec<RustLogEntry>> {
    RUST_LOG_BUFFER.get_or_init(|| Mutex::new(Vec::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn push_rust_log(app: Option<&AppHandle>, level: &str, message: impl Into<String>) {
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
    if let Ok(mut dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        dir.push(CRASH_REPORT_FILE);
        if let Ok(json) = serde_json::to_string_pretty(report) {
            let _ = std::fs::write(dir, json);
        }
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
    let mut push_runner =
        |name: String, path: String, kind: &str, flavor: Option<&str>| {
            if path.is_empty() || !seen_paths.insert(path.clone()) {
                return;
            }
            runners.push(WineRunner {
                name,
                path,
                kind: kind.to_string(),
                flavor: flavor.map(|s| s.to_string()),
            });
        };

    #[cfg(not(windows))]
    {
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
                push_runner("Wine".into(), c.to_string(), "wine", None);
                break;
            }
        }
        // `which wine` fallback
        if runners.is_empty() {
            if let Ok(out) = Command::new("which").arg("wine").output() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    push_runner("Wine (which)".into(), path, "wine", None);
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
                        push_runner(
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
                    push_runner(
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
struct PrefixInfo {
    name: String,
    path: String,
    kind: String, // "wine" | "proton"
    has_dxvk: bool,
    has_vkd3d: bool,
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

#[tauri::command]
fn list_wine_prefixes() -> Vec<PrefixInfo> {
    #[cfg(windows)]
    {
        return Vec::new();
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
                Some(PrefixInfo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    kind,
                    has_dxvk,
                    has_vkd3d,
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
        return Err("Wine prefixes are not supported on Windows".to_string());
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
        return Err("Wine prefixes are not supported on Windows".to_string());
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
        Err(if stderr.is_empty() {
            "winetricks failed".to_string()
        } else {
            stderr
        })
    }
}

#[tauri::command]
fn run_winetricks(prefix: String, verbs: Vec<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        let _ = (prefix, verbs);
        return Err("Winetricks is not available on Windows".to_string());
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
        return Err("DXVK/VKD3D installer is not available on Windows".to_string());
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
        return Vec::new();
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
                let pid = child.id();

                // Store active game so manual screenshots work
                {
                    let state = app.state::<screenshot::ActiveGameState>();
                    *state.0.lock().unwrap() = Some(screenshot::ActiveGame {
                        pid,
                        exe: path_clone.clone(),
                    });
                }

                let _ = app.emit("game-started", &path_clone);

                // Spawn F12 hotkey listener thread; get its OS thread-ID so we
                // can stop it cleanly when the game exits.
                let (tx, rx) = std::sync::mpsc::channel::<u32>();
                let exe_hk = path_clone.clone();
                let app_hk = app.clone();
                let boss_hk = boss_key.clone();
                thread::spawn(move || {
                    screenshot::start_hotkey_listener(pid, exe_hk, app_hk, boss_hk, tx);
                });
                let hotkey_thread_id = rx.recv().unwrap_or(0);

                let start_time = Instant::now();
                let _ = child.wait();
                let duration = start_time.elapsed().as_secs();

                // Tear down hotkey thread
                screenshot::stop_hotkey_thread(hotkey_thread_id);

                // Clear active game
                {
                    let state = app.state::<screenshot::ActiveGameState>();
                    *state.0.lock().unwrap() = None;
                }

                let _ = app.emit(
                    "game-finished",
                    GameEndedPayload {
                        path: path_clone,
                        duration_secs: duration,
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
        #[cfg(windows)]
        {
            Command::new("taskkill")
                .args(["/PID", &active.pid.to_string(), "/F"])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(windows))]
        {
            // SIGTERM first — let the game save/clean up
            Command::new("kill")
                .args(["-15", &active.pid.to_string()])
                .spawn()
                .map_err(|e| e.to_string())?;
            // Give the process 3 seconds to exit gracefully
            let pid = active.pid;
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_secs(3));
                // Check if process is still alive; if so, send SIGKILL
                let still_alive = Command::new("kill")
                    .args(["-0", &pid.to_string()])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if still_alive {
                    let _ = Command::new("kill").args(["-9", &pid.to_string()]).spawn();
                }
            });
        }
        Ok(())
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
/// Keeps all user data safe: localStorage lives in AppData, not the install dir.
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

/// Build the tray context-menu from a list of recent games.
fn build_tray_menu(
    app: &AppHandle,
    recent: &[RecentGame],
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let title = MenuItemBuilder::with_id("_title", "LIBMALY")
        .enabled(false)
        .build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let show = MenuItemBuilder::with_id("show", "Show Window").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit LIBMALY").build(app)?;

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
        .item(&show)
        .item(&sep3)
        .item(&quit)
        .build()
}

/// Update the tray menu with a new list of recent games.
fn refresh_tray(app: &AppHandle, recent: &[RecentGame]) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(menu) = build_tray_menu(app, recent) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Called by the frontend whenever the last-5 list changes.
#[tauri::command]
fn set_recent_games(app: AppHandle, games: Vec<RecentGame>) -> Result<(), String> {
    *app.state::<RecentGamesState>().0.lock().unwrap() = games.clone();
    refresh_tray(&app, &games);
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

// ── Steam playtime import ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct SteamEntry {
    app_id: String,
    name: String,
    /// Total playtime in minutes (from `playtime_forever`)
    played_minutes: u64,
}

/// Reads Steam's `localconfig.vdf` for every user directory found under the
/// default Steam path and returns playtime data for all apps.
/// Falls back gracefully if Steam is not installed or the file is unreadable.
#[tauri::command]
fn import_steam_playtime() -> Vec<SteamEntry> {
    let mut results: Vec<SteamEntry> = Vec::new();

    // Determine the Steam root path per-platform
    #[cfg(windows)]
    let steam_roots: Vec<std::path::PathBuf> = {
        // Default install path; also check HKCU but parsing registry is heavy
        let p1 = std::path::PathBuf::from(r"C:\Program Files (x86)\Steam");
        let p2 = std::path::PathBuf::from(r"C:\Program Files\Steam");
        [p1, p2].iter().filter(|p| p.exists()).cloned().collect()
    };
    #[cfg(target_os = "linux")]
    let steam_roots: Vec<std::path::PathBuf> = {
        let home = std::env::var("HOME").unwrap_or_default();
        let p1 = std::path::PathBuf::from(&home).join(".steam/steam");
        let p2 = std::path::PathBuf::from(&home).join(".local/share/Steam");
        [p1, p2].iter().filter(|p| p.exists()).cloned().collect()
    };
    #[cfg(target_os = "macos")]
    let steam_roots: Vec<std::path::PathBuf> = {
        let home = std::env::var("HOME").unwrap_or_default();
        let p = std::path::PathBuf::from(&home).join("Library/Application Support/Steam");
        if p.exists() {
            vec![p]
        } else {
            vec![]
        }
    };

    for root in &steam_roots {
        let userdata = root.join("userdata");
        let Ok(user_dirs) = std::fs::read_dir(&userdata) else {
            continue;
        };
        for user_dir in user_dirs.filter_map(|e| e.ok()) {
            let cfg = user_dir.path().join("config").join("localconfig.vdf");
            let Ok(content) = std::fs::read_to_string(&cfg) else {
                continue;
            };
            // Simple line-based VDF parser (not full KV spec but covers localconfig)
            parse_localconfig_vdf(&content, &mut results);
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

/// Minimal VDF parser: extracts appid -> {name, playtime_forever} from localconfig.
fn parse_localconfig_vdf(src: &str, out: &mut Vec<SteamEntry>) {
    // We look for blocks like:
    //   "1234567"
    //   {
    //       "name"  "Game Name"
    //       "playtime_forever"  "120"
    //   }
    let mut lines = src.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        // An app block starts with a quoted numeric key
        let Some(app_id) = quoted_value(trimmed) else {
            continue;
        };
        if !app_id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        // Next non-whitespace line should be "{"
        let Some(brace) = lines.peek() else {
            break;
        };
        if brace.trim() != "{" {
            continue;
        }
        lines.next(); // consume "{"

        let mut name = String::new();
        let mut playtime: u64 = 0;
        let mut depth = 1usize;
        for inner in lines.by_ref() {
            let t = inner.trim();
            if t == "{" {
                depth += 1;
                continue;
            }
            if t == "}" {
                depth -= 1;
                if depth == 0 {
                    break;
                }
                continue;
            }
            if depth == 1 {
                if let Some((k, v)) = kv_pair(t) {
                    match k.to_lowercase().as_str() {
                        "name" => {
                            if name.is_empty() {
                                name = v.to_string();
                            }
                        }
                        "playtime_forever" => {
                            playtime = v.parse().unwrap_or(0);
                        }
                        _ => {}
                    }
                }
            }
        }
        if playtime > 0 {
            out.push(SteamEntry {
                app_id: app_id.to_string(),
                name,
                played_minutes: playtime,
            });
        }
    }
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
    std::fs::write(&path, contents).map_err(|e| e.to_string())
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
    let mut path = app.path().app_data_dir().ok()?;
    path.push(CRASH_REPORT_FILE);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

#[tauri::command]
fn clear_last_crash_report(app: AppHandle) -> Result<(), String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push(CRASH_REPORT_FILE);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            scan_games,
            scan_games_incremental,
            list_executables_in_folder,
            get_platform,
            detect_wine_runners,
            list_wine_prefixes,
            create_wine_prefix,
            delete_wine_prefix,
            run_winetricks,
            install_dxvk_vkd3d,
            import_lutris_games,
            launch_game,
            kill_game,
            delete_game,
            set_recent_games,
            check_app_update,
            apply_update,
            fetch_f95_metadata,
            fetch_dlsite_metadata,
            search_suggest_links,
            f95_login,
            f95_logout,
            f95_is_logged_in,
            dlsite_login,
            dlsite_logout,
            dlsite_is_logged_in,
            update_game,
            preview_update,
            get_screenshots,
            export_screenshots_zip,
            open_screenshots_folder,
            take_screenshot_manual,
            save_screenshot_tags,
            import_steam_playtime,
            set_tray_tooltip,
            fetch_rss,
            save_string_to_file,
            get_recent_logs,
            clear_recent_logs,
            get_last_crash_report,
            clear_last_crash_report,
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
            let initial_menu = build_tray_menu(app.handle(), &[])?;
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
