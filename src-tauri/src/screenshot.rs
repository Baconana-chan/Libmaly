use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Emitter;

// ── Shared state: currently-running game ──────────────────────────────────

pub struct ActiveGame {
    pub pid: u32,
    pub exe: String,
}

pub struct ActiveGameState(pub Mutex<Option<ActiveGame>>);

// ── Global state for WH_KEYBOARD_LL callback (Windows only) ────────────────

#[cfg(windows)]
struct HookState {
    pid: u32,
    exe: String,
    app: AppHandle,
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
    #[cfg(windows)]
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));

    #[cfg(target_os = "linux")]
    let base = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".local/share");

    #[cfg(target_os = "macos")]
    let base = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Library/Application Support");

    let folder_name = Path::new(game_exe)
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let sanitized: String = folder_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    base.join("libmaly").join("screenshots").join(sanitized)
}

// ── Serde types ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Screenshot {
    pub path: String,
    pub filename: String,
    pub timestamp: u64,
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
            Screenshot { path: path_str, filename, timestamp }
        })
        .collect();
    shots.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(shots)
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
    }    #[cfg(target_os = "linux")]
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
    }    Ok(())
}

#[tauri::command]
pub fn take_screenshot_manual(
    state: tauri::State<ActiveGameState>,
) -> Result<Screenshot, String> {
    let guard = state.0.lock().unwrap();
    match &*guard {
        None => Err("No game is currently running.".to_string()),
        Some(game) => capture_window_of(game.pid, &game.exe),
    }
}

// ── Public capture entry-point (also used by hotkey thread) ───────────────

pub fn capture_window_of(pid: u32, game_exe: &str) -> Result<Screenshot, String> {
    #[cfg(windows)]
    {
        win::capture_and_save(pid, game_exe)
    }
    #[cfg(not(windows))]
    {
        let _ = (pid, game_exe);
        Err("Screenshots are only supported on Windows.".to_string())
    }
}

// ── Hotkey thread ──────────────────────────────────────────────────────────

/// Global low-level keyboard callback.
/// Called synchronously by Windows from the hook thread's message loop.
#[cfg(windows)]
unsafe extern "system" fn ll_keyboard_proc(
    code: i32,
    wparam: usize,
    lparam: isize,
) -> isize {
    use winapi::um::winuser::{CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN};
    if code >= 0 && wparam == WM_KEYDOWN as usize {
        let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
        if kb.vkCode == 0x7B {
            // VK_F12 — take screenshot
            if let Ok(guard) = hook_state().lock() {
                if let Some(ref state) = *guard {
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
    thread_id_tx: mpsc::Sender<u32>,
) {
    #[cfg(windows)]
    unsafe {
        use winapi::um::processthreadsapi::GetCurrentThreadId;
        use winapi::um::winuser::{
            GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
            WH_KEYBOARD_LL, MSG,
        };

        // Store state so the hook callback can access it
        *hook_state().lock().unwrap() = Some(HookState {
            pid,
            exe: game_exe,
            app,
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
        let _ = (pid, game_exe, app);
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

// ── Windows GDI capture ────────────────────────────────────────────────────

#[cfg(windows)]
mod win {
    use super::{Screenshot, screenshots_dir};
    use winapi::shared::minwindef::{BOOL, DWORD, LPARAM, TRUE, FALSE};
    use winapi::shared::windef::{HBITMAP, HWND, RECT};
    use winapi::um::wingdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        GetDIBits, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        RGBQUAD, SRCCOPY,
    };
    use winapi::um::winuser::{
        EnumWindows, GetClientRect, GetDC, GetWindowLongW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, PrintWindow, ReleaseDC,
        GWL_STYLE,
    };

    // ── Window finder ──────────────────────────────────────────────────────

    struct FindData { pid: DWORD, hwnd: HWND, strict: bool }

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
        let mut data = FindData { pid, hwnd: std::ptr::null_mut(), strict: true };
        unsafe { EnumWindows(Some(enum_proc), &mut data as *mut _ as LPARAM) };
        if !data.hwnd.is_null() {
            return Some(data.hwnd);
        }
        // Loose pass: any visible window from this PID
        let mut data2 = FindData { pid, hwnd: std::ptr::null_mut(), strict: false };
        unsafe { EnumWindows(Some(enum_proc), &mut data2 as *mut _ as LPARAM) };
        if data2.hwnd.is_null() { None } else { Some(data2.hwnd) }
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

            // PrintWindow captures the window even when it's not in foreground.
            // PW_CLIENTONLY (1) = skip title bar / borders.
            let ok = PrintWindow(hwnd, hdc_mem, 1);
            if ok == 0 {
                // Fallback: BitBlt (requires the window to be visible and not covered)
                BitBlt(hdc_mem, 0, 0, w, h, hdc_src, 0, 0, SRCCOPY);
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
                bmiColors: [RGBQUAD { rgbBlue: 0, rgbGreen: 0, rgbRed: 0, rgbReserved: 0 }],
            };

            let mut buf: Vec<u8> = vec![0u8; (w * h) as usize * 4];
            let ret = GetDIBits(
                hdc_mem, hbmp, 0, h as u32,
                buf.as_mut_ptr() as *mut _,
                &mut bmi, DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, old);
            DeleteObject(hbmp as *mut _);
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_src);

            if ret == 0 {
                return Err("GetDIBits failed".into());
            }

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
        })
    }
}
