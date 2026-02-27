use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use tauri::AppHandle;
use base64::Engine;
use crate::data_paths::app_data_root;
#[cfg(windows)]
use tauri::Emitter;

// ── Shared state: currently-running game ──────────────────────────────────

pub struct ActiveGame {
    pub pid: u32,
    pub exe: String,
}

pub struct ActiveGameState(pub Mutex<Option<ActiveGame>>);

// ── Global state for WH_KEYBOARD_LL callback (Windows only) ────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct BossKeyConfig {
    pub vk_code: u32,
    pub action: String,
    pub mute: bool,
}

#[cfg(windows)]
struct HookState {
    pid: u32,
    exe: String,
    app: AppHandle,
    boss_key: Option<BossKeyConfig>,
}

#[cfg(windows)]
static HOOK_STATE: std::sync::OnceLock<Mutex<Option<HookState>>> = std::sync::OnceLock::new();

#[cfg(windows)]
fn hook_state() -> &'static Mutex<Option<HookState>> {
    HOOK_STATE.get_or_init(|| Mutex::new(None))
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Returns the base screenshots directory for the current platform.
pub fn screenshots_dir(game_exe: &str) -> PathBuf {
    let base = app_data_root();

    let folder_name = Path::new(game_exe)
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let sanitized: String = folder_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    base.join("screenshots").join(sanitized)
}

// ── Serde types ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Screenshot {
    pub path: String,
    pub filename: String,
    pub timestamp: u64,
    pub tags: Vec<String>,
}

#[cfg(windows)]
#[derive(Serialize, Clone)]
pub struct ScreenshotTakenPayload {
    pub game_exe: String,
    pub screenshot: Screenshot,
}

// ── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_screenshots(game_exe: String) -> Result<Vec<Screenshot>, String> {
    let dir = screenshots_dir(&game_exe);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let meta_path = dir.join("tags.json");
    let all_tags: std::collections::HashMap<String, Vec<String>> = if meta_path.exists() {
        let content = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    let mut shots: Vec<Screenshot> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|x| x.to_string_lossy().eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        })
        .map(|e| {
            let path_str = e.path().to_string_lossy().to_string();
            let filename = e.file_name().to_string_lossy().to_string();
            let timestamp = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let tags = all_tags.get(&filename).cloned().unwrap_or_default();
            Screenshot {
                path: path_str,
                filename,
                timestamp,
                tags,
            }
        })
        .collect();
    shots.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(shots)
}

#[tauri::command]
pub fn save_screenshot_tags(
    game_exe: String,
    screenshot_name: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let dir = screenshots_dir(&game_exe);
    if !dir.exists() {
        return Err("Screenshots directory not found".into());
    }

    let meta_path = dir.join("tags.json");
    let mut all_tags: std::collections::HashMap<String, Vec<String>> = if meta_path.exists() {
        let content = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    all_tags.insert(screenshot_name, tags);

    let content = serde_json::to_string_pretty(&all_tags).map_err(|e| e.to_string())?;
    std::fs::write(&meta_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_screenshots_folder(game_exe: String) -> Result<(), String> {
    let dir = screenshots_dir(&game_exe);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn export_screenshots_zip(game_exe: String, output_path: String) -> Result<(), String> {
    let dir = screenshots_dir(&game_exe);
    if !dir.exists() {
        return Err("No screenshots found for this game.".to_string());
    }

    let mut png_files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .map(|x| x.to_string_lossy().eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        })
        .collect();
    if png_files.is_empty() {
        return Err("No screenshot files to export.".to_string());
    }
    png_files.sort();

    let file = File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for p in png_files {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| "Invalid screenshot filename".to_string())?;
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        let mut src = File::open(&p).map_err(|e| e.to_string())?;
        std::io::copy(&mut src, &mut zip).map_err(|e| e.to_string())?;
    }

    let tags_path = dir.join("tags.json");
    if tags_path.exists() {
        zip.start_file("tags.json", options)
            .map_err(|e| e.to_string())?;
        let mut tags_file = File::open(tags_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut tags_file, &mut zip).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn take_screenshot_manual(state: tauri::State<ActiveGameState>) -> Result<Screenshot, String> {
    let guard = state.0.lock().unwrap();
    match &*guard {
        None => Err("No game is currently running.".to_string()),
        Some(game) => capture_window_of(game.pid, &game.exe),
    }
}

#[tauri::command]
pub fn overwrite_screenshot_png(path: String, data_url: String) -> Result<(), String> {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(data_url.as_str());
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| format!("Invalid PNG data: {e}"))?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_screenshot_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_screenshot_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

// ── Public capture entry-point (also used by hotkey thread) ───────────────

#[allow(unused_variables)]
pub fn capture_window_of(pid: u32, game_exe: &str) -> Result<Screenshot, String> {
    #[cfg(windows)]
    {
        win::capture_and_save(pid, game_exe)
    }
    #[cfg(target_os = "linux")]
    {
        capture_linux(pid, game_exe)
    }
    #[cfg(target_os = "macos")]
    {
        capture_macos(pid, game_exe)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = (pid, game_exe);
        Err("Screenshots are not supported on this platform.".to_string())
    }
}

// ── Hotkey thread ──────────────────────────────────────────────────────────

/// Global low-level keyboard callback.
/// Called synchronously by Windows from the hook thread's message loop.
#[cfg(windows)]
unsafe extern "system" fn ll_keyboard_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use winapi::um::winuser::{CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN};
    if code >= 0 && wparam == WM_KEYDOWN as usize {
        let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
        if kb.vkCode == 0x7B {
            if let Ok(guard) = hook_state().lock() {
                if let Some(ref state) = *guard {
                    if kb.vkCode == 0x7B {
                        match capture_window_of(state.pid, &state.exe) {
                            Ok(shot) => {
                                let _ = state.app.emit(
                                    "screenshot-taken",
                                    ScreenshotTakenPayload {
                                        game_exe: state.exe.clone(),
                                        screenshot: shot,
                                    },
                                );
                            }
                            Err(e) => eprintln!("[screenshot] F12: {}", e),
                        }
                    } else if let Some(ref boss) = state.boss_key {
                        if kb.vkCode == boss.vk_code {
                            let action = boss.action.clone();
                            let mute = boss.mute;
                            let pid = state.pid;
                            // Hide the Libmaly window via frontend event
                            let _ = state.app.emit("boss-key-pressed", ());
                            // Execute panic action in background to avoid blocking the hook thread
                            std::thread::spawn(move || {
                                win::exec_panic_action(pid, &action, mute);
                            });
                        }
                    }
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

/// Registers a low-level keyboard hook that intercepts F12 globally.
/// Uses `WH_KEYBOARD_LL` instead of `RegisterHotKey` so it works even when
/// F12 is taken by another app (Steam overlay, browser devtools, etc.).
pub fn start_hotkey_listener(
    pid: u32,
    game_exe: String,
    app: AppHandle,
    boss_key: Option<BossKeyConfig>,
    thread_id_tx: mpsc::Sender<u32>,
) {
    #[cfg(windows)]
    unsafe {
        use winapi::um::processthreadsapi::GetCurrentThreadId;
        use winapi::um::winuser::{
            GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL,
        };

        // Store state so the hook callback can access it
        *hook_state().lock().unwrap() = Some(HookState {
            pid,
            exe: game_exe,
            app,
            boss_key,
        });

        let thread_id = GetCurrentThreadId();
        let _ = thread_id_tx.send(thread_id);

        // Install the global low-level keyboard hook on this thread
        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(ll_keyboard_proc),
            std::ptr::null_mut(),
            0, // 0 = system-wide (not thread-local)
        );

        // Pump messages so the hook callback is dispatched
        let mut msg: MSG = std::mem::zeroed();
        loop {
            let ret = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
            if ret <= 0 {
                break;
            }
        }

        if !hook.is_null() {
            UnhookWindowsHookEx(hook);
        }
        *hook_state().lock().unwrap() = None;
    }

    #[cfg(not(windows))]
    {
        let _ = (pid, game_exe, app, boss_key);
        let _ = thread_id_tx.send(0);
    }
}

/// Posts `WM_QUIT` to the hotkey thread so its `GetMessage` loop exits.
pub fn stop_hotkey_thread(thread_id: u32) {
    #[cfg(windows)]
    unsafe {
        winapi::um::winuser::PostThreadMessageW(thread_id, 0x0012 /*WM_QUIT*/, 0, 0);
    }
    #[cfg(not(windows))]
    let _ = thread_id;
}

// ── Linux screenshot capture ───────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn capture_linux(pid: u32, game_exe: &str) -> Result<Screenshot, String> {
    use std::process::Command;
    let dir = screenshots_dir(game_exe);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("screenshot_{}.png", now);
    let out_path = dir.join(&filename);
    let out_str = out_path.to_string_lossy().to_string();

    // Try to find the window ID for this PID via xdotool, then
    // capture only that window. Fall back to full-screen capture.
    let window_id: Option<String> = Command::new("xdotool")
        .args(["search", "--pid", &pid.to_string(), "--limit", "1"])
        .output()
        .ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        });

    // Tool preference order: scrot (focused window) → gnome-screenshot → import
    let ok = if let Some(ref wid) = window_id {
        // scrot with window id
        Command::new("scrot")
            .args(["--window", wid, &out_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    };

    let ok = ok
        || Command::new("scrot")
            .args(["--focused", &out_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    let ok = ok
        || Command::new("gnome-screenshot")
            .args(["--file", &out_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    // ImageMagick import: screenshot of root window
    let ok = ok
        || Command::new("import")
            .args(["-window", "root", &out_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    if !ok || !out_path.exists() {
        return Err(
            "Screenshot failed. Install 'scrot' or 'gnome-screenshot' for screenshot support."
                .to_string(),
        );
    }

    Ok(Screenshot {
        path: out_str,
        filename,
        timestamp: now,
        tags: vec![],
    })
}

// ── macOS screenshot capture ────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn capture_macos(pid: u32, game_exe: &str) -> Result<Screenshot, String> {
    use std::process::Command;
    let dir = screenshots_dir(game_exe);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("screenshot_{}.png", now);
    let out_path = dir.join(&filename);
    let out_str = out_path.to_string_lossy().to_string();

    // Try to resolve the game's CGWindowID first (AXWindowID), then capture that window.
    let cg_window_id = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            r#"tell application "System Events" to tell (first process whose unix id is {}) to get value of attribute "AXWindowID" of first window"#,
            pid
        ))
        .output()
        .ok()
        .and_then(|o| {
            if !o.status.success() {
                return None;
            }
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.chars().all(|c| c.is_ascii_digit()) {
                Some(s)
            } else {
                None
            }
        });

    // screencapture -x = no sound. If we have a window id, use `-l <id>` (CGWindow path).
    let ok = if let Some(id) = cg_window_id {
        Command::new("screencapture")
            .args(["-x", "-l", &id, &out_str])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    } || Command::new("screencapture")
        .args(["-x", "-m", &out_str])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !ok || !out_path.exists() {
        return Err("screencapture failed (macOS screenshot)".to_string());
    }

    Ok(Screenshot {
        path: out_str,
        filename,
        timestamp: now,
        tags: vec![],
    })
}

// ── Windows GDI capture ────────────────────────────────────────────────────

#[cfg(windows)]
mod win {
    use super::{screenshots_dir, Screenshot};
    use winapi::shared::minwindef::{BOOL, DWORD, FALSE, LPARAM, TRUE};
    use winapi::shared::windef::{HBITMAP, HWND, POINT, RECT};
    use winapi::um::wingdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, RGBQUAD, SRCCOPY,
    };
    use winapi::um::winuser::{
        ClientToScreen, EnumWindows, GetClientRect, GetDC, GetForegroundWindow, GetWindowLongW,
        GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, PrintWindow, ReleaseDC,
        GWL_STYLE,
    };

    pub fn exec_panic_action(pid: u32, action: &str, mute: bool) {
        if action == "kill" {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .spawn();
        } else if action == "hide" {
            use winapi::um::winuser::{ShowWindow, SW_HIDE};
            if let Some(hwnd) = find_game_window(pid) {
                unsafe {
                    ShowWindow(hwnd, SW_HIDE);
                }
            }
        }

        if mute {
            unsafe {
                use winapi::um::winuser::{
                    keybd_event, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VK_VOLUME_MUTE,
                };
                keybd_event(VK_VOLUME_MUTE as u8, 0, KEYEVENTF_EXTENDEDKEY, 0);
                keybd_event(
                    VK_VOLUME_MUTE as u8,
                    0,
                    KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP,
                    0,
                );
            }
        }
    }

    // ── Window finder ──────────────────────────────────────────────────────

    struct FindData {
        pid: DWORD,
        hwnd: HWND,
        strict: bool,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let d = &mut *(lparam as *mut FindData);
        let mut pid: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != d.pid || IsWindowVisible(hwnd) == 0 {
            return TRUE;
        }
        if d.strict {
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            // Must have a title bar (typical for RPG Maker / game windows)
            if style & 0x00C0_0000 /*WS_CAPTION*/ == 0 {
                return TRUE;
            }
            let mut title = [0u16; 512];
            if GetWindowTextW(hwnd, title.as_mut_ptr(), 512) == 0 {
                return TRUE;
            }
        }
        d.hwnd = hwnd;
        FALSE // stop enumeration
    }

    fn find_game_window(pid: u32) -> Option<HWND> {
        // First pass: strict – prefer titled, captioned windows
        let mut data = FindData {
            pid,
            hwnd: std::ptr::null_mut(),
            strict: true,
        };
        unsafe { EnumWindows(Some(enum_proc), &mut data as *mut _ as LPARAM) };
        if !data.hwnd.is_null() {
            return Some(data.hwnd);
        }
        // Loose pass: any visible window from this PID
        let mut data2 = FindData {
            pid,
            hwnd: std::ptr::null_mut(),
            strict: false,
        };
        unsafe { EnumWindows(Some(enum_proc), &mut data2 as *mut _ as LPARAM) };
        if data2.hwnd.is_null() {
            None
        } else {
            Some(data2.hwnd)
        }
    }

    // ── GDI capture ───────────────────────────────────────────────────────

    pub fn capture_and_save(pid: u32, game_exe: &str) -> Result<Screenshot, String> {
        let hwnd = find_game_window(pid).ok_or("Game window not found")?;

        let (pixels, width, height) = unsafe {
            let mut rect: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut rect);
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            if w <= 0 || h <= 0 {
                return Err(format!("Game window reports size {}×{}", w, h));
            }

            let hdc_src = GetDC(hwnd);
            if hdc_src.is_null() {
                return Err("GetDC failed".into());
            }
            let hdc_mem = CreateCompatibleDC(hdc_src);
            let hbmp: HBITMAP = CreateCompatibleBitmap(hdc_src, w, h);
            let old = SelectObject(hdc_mem, hbmp as *mut _);

            let blit_from_screen = || -> bool {
                let mut pt = POINT { x: 0, y: 0 };
                ClientToScreen(hwnd, &mut pt);
                let hdc_screen = GetDC(std::ptr::null_mut());
                if !hdc_screen.is_null() {
                    BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, pt.x, pt.y, SRCCOPY);
                    ReleaseDC(std::ptr::null_mut(), hdc_screen);
                    true
                } else {
                    BitBlt(hdc_mem, 0, 0, w, h, hdc_src, 0, 0, SRCCOPY);
                    false
                }
            };

            let is_foreground = GetForegroundWindow() == hwnd;
            if is_foreground {
                // Foreground games (Unity/DirectX especially) are best captured from the screen.
                // If screen-DC path fails for any reason, fall back to PrintWindow.
                if !blit_from_screen() {
                    let _ = PrintWindow(hwnd, hdc_mem, 1);
                }
            } else {
                // Background or partially covered windows: prefer PrintWindow first.
                // If PrintWindow fails, capture whatever is currently visible on screen.
                let ok = PrintWindow(hwnd, hdc_mem, 1);
                if ok == 0 {
                    let _ = blit_from_screen();
                }
            }

            // Read pixels as 32 bpp BGRA top-down
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // negative = top-down scan lines
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD {
                    rgbBlue: 0,
                    rgbGreen: 0,
                    rgbRed: 0,
                    rgbReserved: 0,
                }],
            };

            let mut buf: Vec<u8> = vec![0u8; (w * h) as usize * 4];
            let mut ret = GetDIBits(
                hdc_mem,
                hbmp,
                0,
                h as u32,
                buf.as_mut_ptr() as *mut _,
                &mut bmi,
                DIB_RGB_COLORS,
            );

            if ret == 0 {
                SelectObject(hdc_mem, old);
                DeleteObject(hbmp as *mut _);
                DeleteDC(hdc_mem);
                ReleaseDC(hwnd, hdc_src);
                return Err("GetDIBits failed".into());
            }

            // Some Unity/D3D windows still produce a white frame via PrintWindow;
            // retry once from the screen DC, but only when game is foreground
            // (otherwise we may capture an overlapping window by design).
            let mostly_white = {
                let mut white = 0usize;
                let mut total = 0usize;
                for px in buf.chunks(4).step_by(32) {
                    total += 1;
                    if px[0] > 245 && px[1] > 245 && px[2] > 245 {
                        white += 1;
                    }
                }
                total > 64 && white * 100 / total >= 95
            };
            if mostly_white && is_foreground {
                let _ = blit_from_screen();
                ret = GetDIBits(
                    hdc_mem,
                    hbmp,
                    0,
                    h as u32,
                    buf.as_mut_ptr() as *mut _,
                    &mut bmi,
                    DIB_RGB_COLORS,
                );
                if ret == 0 {
                    SelectObject(hdc_mem, old);
                    DeleteObject(hbmp as *mut _);
                    DeleteDC(hdc_mem);
                    ReleaseDC(hwnd, hdc_src);
                    return Err("GetDIBits failed on foreground fallback".into());
                }
            }

            SelectObject(hdc_mem, old);
            DeleteObject(hbmp as *mut _);
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_src);

            // GDI gives BGRA — swap B ↔ R to get RGBA, set alpha = 255
            for px in buf.chunks_mut(4) {
                px.swap(0, 2);
                px[3] = 255;
            }

            (buf, w as u32, h as u32)
        };

        // Encode to PNG via `image` crate
        let dir = screenshots_dir(game_exe);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let filename = format!("screenshot_{}.png", now);
        let out_path = dir.join(&filename);

        let img = image::RgbaImage::from_raw(width, height, pixels)
            .ok_or("Failed to create image buffer from pixel data")?;
        img.save(&out_path).map_err(|e| e.to_string())?;

        Ok(Screenshot {
            path: out_path.to_string_lossy().to_string(),
            filename,
            timestamp: now,
            tags: vec![],
        })
    }
}
