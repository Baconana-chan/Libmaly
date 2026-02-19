use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use std::collections::HashMap;
use std::process::Command;
use std::thread;
use std::time::{Instant, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Manager;
use tauri::AppHandle;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

mod metadata;
use metadata::{
    fetch_f95_metadata, fetch_dlsite_metadata,
    f95_login, f95_logout, f95_is_logged_in,
};

mod updater;
use updater::{update_game, preview_update};

mod screenshot;
use screenshot::{get_screenshots, open_screenshots_folder, take_screenshot_manual};

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
        .and_then(|t| Ok(t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()))
        .unwrap_or(0)
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
        if !p.is_file() { continue; }
        if p.extension().map(|e| e.to_string_lossy().to_lowercase()) != Some("exe".into()) {
            continue;
        }
        let name = match p.file_stem() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        let path_str = p.to_string_lossy().into_owned();
        if is_blocked(&name, &path_str) { continue; }
        if let Ok(meta) = p.metadata() {
            if meta.len() < 100 * 1024 { continue; }
        }
        out.push(Game { name, path: path_str });
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
        if !entry.file_type().is_dir() { continue; }
        let dir_path = entry.path();
        let dir_str  = dir_path.to_string_lossy().into_owned();
        let current_mtime = dir_mtime(dir_path);

        new_mtimes.push(DirMtime { path: dir_str.clone(), mtime: current_mtime });

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
    #[cfg(windows)]        { "windows" }
    #[cfg(target_os = "linux")]  { "linux" }
    #[cfg(target_os = "macos")] { "macos" }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))] { "unknown" }
}

#[derive(Serialize)]
struct WineRunner {
    name: String,
    path: String,
    kind: String, // "wine" | "proton"
}

#[tauri::command]
fn detect_wine_runners() -> Vec<WineRunner> {
    #[allow(unused_mut)]
    let mut runners: Vec<WineRunner> = Vec::new();
    #[cfg(not(windows))]
    {
        // ── Wine system binary ─────────────────────────────────────────────
        let wine_candidates = [
            "/usr/bin/wine",
            "/usr/local/bin/wine",
            "/opt/homebrew/bin/wine", // macOS Homebrew
            "/usr/bin/wine64",
        ];
        for c in &wine_candidates {
            if std::path::Path::new(c).exists() {
                runners.push(WineRunner { name: "Wine".into(), path: c.to_string(), kind: "wine".into() });
                break;
            }
        }
        // `which wine` fallback
        if runners.is_empty() {
            if let Ok(out) = Command::new("which").arg("wine").output() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    runners.push(WineRunner { name: "Wine (which)".into(), path, kind: "wine".into() });
                }
            }
        }
        // ── Steam Proton ───────────────────────────────────────────────────
        let home = std::env::var("HOME").unwrap_or_default();
        let steam_common_paths = [
            format!("{home}/.steam/steam/steamapps/common"),
            format!("{home}/.local/share/Steam/steamapps/common"),
            // macOS Steam
            format!("{home}/Library/Application Support/Steam/steamapps/common"),
        ];
        for steam_common in &steam_common_paths {
            let p = std::path::Path::new(steam_common);
            if !p.exists() { continue; }
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
                        runners.push(WineRunner {
                            name: name.clone(),
                            path: proton_bin.to_string_lossy().to_string(),
                            kind: "proton".into(),
                        });
                    }
                }
            }
        }
    }
    runners
}
#[tauri::command]
fn launch_game(app: AppHandle, path: String, runner: Option<String>, prefix: Option<String>) -> Result<(), String> {
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
                if let Some(p) = parent { cmd.current_dir(p); }
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
                    if let Some(p) = parent { cmd.current_dir(p); }
                    cmd
                } else {
                    // No runner — attempt to run directly (native or Wine-managed script)
                    let mut cmd = Command::new(&path_clone);
                    if let Some(p) = parent { cmd.current_dir(p); }
                    cmd
                }
            }
        };

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
                thread::spawn(move || {
                    screenshot::start_hotkey_listener(pid, exe_hk, app_hk, tx);
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

                let _ = app.emit("game-finished", GameEndedPayload {
                    path: path_clone,
                    duration_secs: duration,
                });
            }
            Err(e) => {
                eprintln!("Failed to launch game: {}", e);
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
            Command::new("kill")
                .args(["-9", &active.pid.to_string()])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    } else {
        Err("No game is currently running".to_string())
    }
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

    let mut builder = MenuBuilder::new(app)
        .item(&title)
        .item(&sep1);

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(screenshot::ActiveGameState(std::sync::Mutex::new(None)))
        .manage(RecentGamesState(std::sync::Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            scan_games,
            scan_games_incremental,
            get_platform,
            detect_wine_runners,
            launch_game,
            kill_game,
            delete_game,
            set_recent_games,
            fetch_f95_metadata,
            fetch_dlsite_metadata,
            f95_login,
            f95_logout,
            f95_is_logged_in,
            update_game,
            preview_update,
            get_screenshots,
            open_screenshots_folder,
            take_screenshot_manual,
        ])
        .setup(|app| {
            // ── System tray ───────────────────────────────────────────────
            let initial_menu = build_tray_menu(app.handle(), &[])?;
            TrayIconBuilder::with_id("main-tray")
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
                                let games = app
                                    .state::<RecentGamesState>()
                                    .0.lock().unwrap().clone();
                                if let Some(game) = games.get(idx) {
                                    let path = game.path.clone();
                                    let app2 = app.clone();
                                    thread::spawn(move || {
                                        let _ = launch_game(app2, path, None, None);
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
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left
                            && button_state == MouseButtonState::Up
                        {
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
                })
                .build(app)?;
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
