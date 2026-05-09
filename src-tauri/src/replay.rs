//! Instant Replay — circular frame buffer + GIF / MP4 encoding.
//!
//! Frames are captured at ~5 FPS while a game is running, scaled to at most
//! 640 × 360 pixels before storage, and held in a ring-buffer of 150 entries
//! (≈ 30 seconds). Calling `save_replay` encodes the buffered frames into:
//!   • GIF — always available (pure Rust via the `image` crate)
//!   • MP4 — optional; requires an `ffmpeg` binary on PATH

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};

// ── Public types ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ReplayClip {
    pub path: String,
    pub filename: String,
    pub timestamp: u64,
    pub format: String,
    pub duration_secs: f32,
    pub frame_count: usize,
}

/// A moment in the replay buffer detected as visually interesting.
#[derive(Serialize, Clone, Debug)]
pub struct HighlightCandidate {
    /// Timestamp of the peak frame (ms since UNIX epoch).
    pub timestamp_ms: u64,
    /// Normalized change score 0.0..1.0.
    pub score: f32,
    /// Human-readable detection reason.
    pub reason: String,
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Serialize, Clone)]
pub struct ReplaySaved {
    pub game_exe: String,
    pub clip: ReplayClip,
}

// ── Internal frame ─────────────────────────────────────────────────────────

struct Frame {
    pixels: Vec<u8>, // RGBA, already scaled ≤ 640 × 360
    width: u32,
    height: u32,
    timestamp_ms: u64,
}

// ── Global state ───────────────────────────────────────────────────────────

static CAPTURE_RUNNING: AtomicBool = AtomicBool::new(false);
static CAPTURE_PID: AtomicU32 = AtomicU32::new(0);

static REPLAY_BUF: OnceLock<Arc<Mutex<VecDeque<Frame>>>> = OnceLock::new();
fn replay_buf() -> &'static Arc<Mutex<VecDeque<Frame>>> {
    REPLAY_BUF.get_or_init(|| Arc::new(Mutex::new(VecDeque::new())))
}

static CAPTURE_EXE: OnceLock<Mutex<String>> = OnceLock::new();
fn capture_exe_global() -> &'static Mutex<String> {
    CAPTURE_EXE.get_or_init(|| Mutex::new(String::new()))
}

// ── Control API ────────────────────────────────────────────────────────────

/// Start the capture loop for a new game session. No-op if already running
/// (only updates PID / exe).
pub fn start_capture(pid: u32, exe: String) {
    CAPTURE_PID.store(pid, Ordering::SeqCst);
    *capture_exe_global().lock().unwrap() = exe;

    // Clear any frames left from the previous session.
    replay_buf().lock().unwrap().clear();

    if CAPTURE_RUNNING.swap(true, Ordering::SeqCst) {
        return; // thread already alive, just updated PID / exe
    }

    let buf = Arc::clone(replay_buf());
    let _ = std::thread::Builder::new()
        .name("libmaly-replay".to_string())
        .spawn(move || {
            const MAX_FRAMES: usize = 150; // 30 s at 5 FPS
            let interval = std::time::Duration::from_millis(200);

            while CAPTURE_RUNNING.load(Ordering::SeqCst) {
                let pid = CAPTURE_PID.load(Ordering::SeqCst);
                if pid != 0 {
                    if let Some((px, w, h)) = capture_raw_scaled(pid, 640, 360) {
                        let ts = now_ms();
                        let mut g = buf.lock().unwrap();
                        if g.len() >= MAX_FRAMES {
                            g.pop_front();
                        }
                        g.push_back(Frame {
                            pixels: px,
                            width: w,
                            height: h,
                            timestamp_ms: ts,
                        });
                    }
                }
                std::thread::sleep(interval);
            }
        });
}

/// Notify the capture loop that the tracked PID changed.
pub fn update_pid(pid: u32) {
    CAPTURE_PID.store(pid, Ordering::SeqCst);
}

/// Stop the capture loop. The buffer is intentionally NOT cleared so the
/// user can still save a replay right after the game exits.
pub fn stop_capture() {
    CAPTURE_RUNNING.store(false, Ordering::SeqCst);
    CAPTURE_PID.store(0, Ordering::SeqCst);
    *capture_exe_global().lock().unwrap() = String::new();
}

/// Returns the game exe path set by the most recent `start_capture` call.
#[allow(dead_code)]
pub fn current_exe() -> String {
    capture_exe_global().lock().unwrap().clone()
}

// ── Save ───────────────────────────────────────────────────────────────────

/// Encode the buffered frames and write a replay clip to disk.
///
/// `format_hint`:
/// - `"mp4"` — tries ffmpeg first, falls back to GIF
/// - anything else — writes GIF directly
pub fn save_replay(game_exe: &str, format_hint: &str) -> Result<ReplayClip, String> {
    // Snapshot the buffer (release lock before encoding, which can take a while).
    let frames: Vec<(Vec<u8>, u32, u32, u64)> = {
        let g = replay_buf().lock().unwrap();
        g.iter()
            .map(|f| (f.pixels.clone(), f.width, f.height, f.timestamp_ms))
            .collect()
    };

    if frames.is_empty() {
        return Err("Replay buffer is empty — no frames captured yet.".to_string());
    }

    let dir = replays_dir(game_exe);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = now_secs();
    let duration_secs = {
        let span = frames
            .last()
            .unwrap()
            .3
            .saturating_sub(frames.first().unwrap().3);
        (span as f32 / 1000.0).max(0.1)
    };
    let frame_count = frames.len();

    if format_hint == "mp4" {
        if let Ok(clip) = encode_mp4(&frames, &dir, ts, duration_secs) {
            return Ok(clip);
        }
        // fall through to GIF
    }

    encode_gif(&frames, &dir, ts, duration_secs, frame_count)
}

// ── Clip directory & listing ────────────────────────────────────────────────

pub fn replays_dir(game_exe: &str) -> PathBuf {
    crate::screenshot::screenshots_dir(game_exe).join("replays")
}

pub fn get_clips(game_exe: &str) -> Vec<ReplayClip> {
    let dir = replays_dir(game_exe);
    if !dir.exists() {
        return vec![];
    }
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return vec![];
    };
    let mut clips: Vec<ReplayClip> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let ext = e.path().extension()?.to_string_lossy().to_lowercase();
            if ext != "gif" && ext != "mp4" {
                return None;
            }
            let ts = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Some(ReplayClip {
                path: e.path().to_string_lossy().to_string(),
                filename: e.file_name().to_string_lossy().to_string(),
                timestamp: ts,
                format: ext,
                duration_secs: 0.0, // would need full decode; skip for listing
                frame_count: 0,
            })
        })
        .collect();
    clips.sort_by_key(|c| std::cmp::Reverse(c.timestamp));
    clips
}

// ── Auto-highlight detection ───────────────────────────────────────────────

/// Analyze the current replay buffer for visually interesting moments.
///
/// Compares consecutive frames by sampling every 16th pixel (RGBA), computing
/// the mean absolute RGB difference, then finding local-maximum peaks above
/// `min_score` (0.0 – 1.0; suggested default ≈ 0.08).
///
/// Returns up to 10 candidates sorted by score descending.
pub fn analyze_highlights(min_score: f32) -> Vec<HighlightCandidate> {
    // Snapshot the buffer (release lock before heavy work).
    let frames: Vec<(Vec<u8>, u32, u32, u64)> = {
        let g = replay_buf().lock().unwrap();
        g.iter()
            .map(|f| (f.pixels.clone(), f.width, f.height, f.timestamp_ms))
            .collect()
    };

    if frames.len() < 2 {
        return vec![];
    }

    // ── Per-frame difference score ─────────────────────────────────────
    let mut raw: Vec<f32> = vec![0.0_f32; frames.len()];

    for i in 1..frames.len() {
        let (ref a, wa, ha, _) = frames[i - 1];
        let (ref b, wb, hb, _) = frames[i];

        if wa != wb || ha != hb || a.len() != b.len() {
            continue;
        }

        let mut diff_sum: f64 = 0.0;
        let mut count: usize = 0;
        // Sample every 16th pixel (stride 64 bytes = 16 RGBA pixels).
        let mut idx = 0usize;
        while idx + 2 < a.len() {
            let dr = (a[idx] as i32 - b[idx] as i32).unsigned_abs() as f64;
            let dg = (a[idx + 1] as i32 - b[idx + 1] as i32).unsigned_abs() as f64;
            let db = (a[idx + 2] as i32 - b[idx + 2] as i32).unsigned_abs() as f64;
            diff_sum += (dr + dg + db) / 3.0;
            count += 1;
            idx += 64;
        }

        raw[i] = if count > 0 {
            (diff_sum / count as f64 / 128.0).min(1.0) as f32
        } else {
            0.0
        };
    }

    // ── Smooth with ±2 frame window ────────────────────────────────────
    let smoothed: Vec<f32> = (0..raw.len())
        .map(|i| {
            let lo = i.saturating_sub(2);
            let hi = (i + 3).min(raw.len());
            raw[lo..hi].iter().sum::<f32>() / (hi - lo) as f32
        })
        .collect();

    // ── Non-maximum suppression with ±10-frame radius ──────────────────
    let nms_r = 10usize;
    let threshold = min_score.max(0.04_f32);
    let mut candidates: Vec<HighlightCandidate> = Vec::new();

    for i in 0..smoothed.len() {
        let s = smoothed[i];
        if s < threshold {
            continue;
        }
        let lo = i.saturating_sub(nms_r);
        let hi = (i + nms_r + 1).min(smoothed.len());
        let is_peak = smoothed[lo..hi].iter().all(|&v| v <= s);
        if !is_peak {
            continue;
        }
        let reason = if s >= 0.45 {
            "scene change"
        } else if s >= 0.20 {
            "rapid motion"
        } else {
            "motion spike"
        };
        candidates.push(HighlightCandidate {
            timestamp_ms: frames[i].3,
            score: s,
            reason: reason.to_string(),
        });
    }

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(10);
    candidates
}

/// Encode a clip from the buffer around a specific timestamp.
///
/// `before_ms` / `after_ms` define the window around the peak.
/// Falls back from MP4 → GIF just like `save_replay`.
pub fn save_highlight_clip(
    game_exe: &str,
    around_ms: u64,
    before_ms: u64,
    after_ms: u64,
    format_hint: &str,
) -> Result<ReplayClip, String> {
    let start_ms = around_ms.saturating_sub(before_ms);
    let end_ms = around_ms.saturating_add(after_ms);

    let frames: Vec<(Vec<u8>, u32, u32, u64)> = {
        let g = replay_buf().lock().unwrap();
        g.iter()
            .filter(|f| f.timestamp_ms >= start_ms && f.timestamp_ms <= end_ms)
            .map(|f| (f.pixels.clone(), f.width, f.height, f.timestamp_ms))
            .collect()
    };

    if frames.is_empty() {
        return Err("No frames in the requested time window — the buffer may have scrolled past this moment.".to_string());
    }

    let dir = replays_dir(game_exe);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ts = now_secs();
    let duration_secs = {
        let span = frames
            .last()
            .unwrap()
            .3
            .saturating_sub(frames.first().unwrap().3);
        (span as f32 / 1000.0).max(0.1)
    };
    let frame_count = frames.len();

    if format_hint == "mp4" {
        if let Ok(clip) = encode_mp4(&frames, &dir, ts, duration_secs) {
            return Ok(clip);
        }
    }

    encode_gif(&frames, &dir, ts, duration_secs, frame_count)
}

// ── GIF encoding ───────────────────────────────────────────────────────────

fn encode_gif(
    frames: &[(Vec<u8>, u32, u32, u64)],
    dir: &std::path::Path,
    ts: u64,
    duration_secs: f32,
    frame_count: usize,
) -> Result<ReplayClip, String> {
    use image::codecs::gif::{GifEncoder, Repeat};
    use image::{Delay, Frame as ImgFrame, RgbaImage};

    let filename = format!("replay_{ts}.gif");
    let out_path = dir.join(&filename);
    let file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;

    let mut enc = GifEncoder::new_with_speed(file, 10);
    enc.set_repeat(Repeat::Infinite)
        .map_err(|e| e.to_string())?;

    // Compute per-frame delay from actual timestamps; clamp to ≥ 20 ms.
    let interval_ms: u32 = if frames.len() > 1 {
        let span = frames
            .last()
            .unwrap()
            .3
            .saturating_sub(frames.first().unwrap().3);
        ((span / (frames.len() as u64 - 1)) as u32).max(20)
    } else {
        200
    };

    for (pixels, w, h, _) in frames {
        let img =
            RgbaImage::from_raw(*w, *h, pixels.clone()).ok_or("Frame pixel data is malformed")?;
        let frame = ImgFrame::from_parts(img, 0, 0, Delay::from_numer_denom_ms(interval_ms, 1));
        enc.encode_frame(frame).map_err(|e| e.to_string())?;
    }

    Ok(ReplayClip {
        path: out_path.to_string_lossy().to_string(),
        filename,
        timestamp: ts,
        format: "gif".to_string(),
        duration_secs,
        frame_count,
    })
}

// ── MP4 encoding (ffmpeg subprocess) ───────────────────────────────────────

fn encode_mp4(
    frames: &[(Vec<u8>, u32, u32, u64)],
    dir: &std::path::Path,
    ts: u64,
    duration_secs: f32,
) -> Result<ReplayClip, String> {
    use image::RgbaImage;
    use std::process::Command;

    if !Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Err("ffmpeg not found on PATH".to_string());
    }

    let tmp = dir.join(format!("_tmp_{ts}"));
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let fps: u32 = if frames.len() > 1 {
        let span = frames
            .last()
            .unwrap()
            .3
            .saturating_sub(frames.first().unwrap().3);
        ((frames.len() as f64 * 1000.0 / span.max(1) as f64).round() as u32).clamp(1, 60)
    } else {
        5
    };

    // Ensure width and height are even (H.264 requirement).
    let (enc_w, enc_h) = {
        let (w, h) = (frames[0].1, frames[0].2);
        (w & !1, h & !1)
    };

    for (i, (px, w, h, _)) in frames.iter().enumerate() {
        let img = RgbaImage::from_raw(*w, *h, px.clone()).ok_or("bad frame pixels")?;
        // Crop to even dimensions if needed.
        let img = if *w != enc_w || *h != enc_h {
            image::imageops::crop_imm(&img, 0, 0, enc_w, enc_h).to_image()
        } else {
            img
        };
        // Convert to RGB (libx264 works better without alpha channel).
        let rgb: image::RgbImage = image::DynamicImage::ImageRgba8(img).into_rgb8();
        rgb.save(tmp.join(format!("f_{i:04}.png")))
            .map_err(|e| e.to_string())?;
    }

    let filename = format!("replay_{ts}.mp4");
    let out_path = dir.join(&filename);
    let pattern = tmp.join("f_%04d.png").to_string_lossy().to_string();

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-framerate",
            &fps.to_string(),
            "-i",
            &pattern,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-movflags",
            "+faststart",
            &out_path.to_string_lossy(),
        ])
        .status()
        .map_err(|e| e.to_string())?;

    // Always clean up temp files.
    let _ = std::fs::remove_dir_all(&tmp);

    if !status.success() || !out_path.exists() {
        return Err("ffmpeg encoding failed".to_string());
    }

    Ok(ReplayClip {
        path: out_path.to_string_lossy().to_string(),
        filename,
        timestamp: ts,
        format: "mp4".to_string(),
        duration_secs,
        frame_count: frames.len(),
    })
}

// ── Platform-specific raw capture + scaling ────────────────────────────────

/// Capture the game window's pixels, then scale to at most max_w × max_h.
/// Returns `None` if the window cannot be found or captured.
#[allow(unused_variables)]
fn capture_raw_scaled(pid: u32, max_w: u32, max_h: u32) -> Option<(Vec<u8>, u32, u32)> {
    #[cfg(windows)]
    {
        win::capture_raw(pid).map(|(px, w, h)| scale_down(px, w, h, max_w, max_h))
    }
    #[cfg(target_os = "linux")]
    {
        linux_capture_raw(pid).map(|(px, w, h)| scale_down(px, w, h, max_w, max_h))
    }
    #[cfg(target_os = "macos")]
    {
        macos_capture_raw(pid).map(|(px, w, h)| scale_down(px, w, h, max_w, max_h))
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

fn scale_down(pixels: Vec<u8>, w: u32, h: u32, max_w: u32, max_h: u32) -> (Vec<u8>, u32, u32) {
    if w == 0 || h == 0 {
        return (pixels, w, h);
    }
    if w <= max_w && h <= max_h {
        return (pixels, w, h);
    }
    let scale = (max_w as f32 / w as f32).min(max_h as f32 / h as f32);
    let nw = ((w as f32 * scale) as u32).max(1);
    let nh = ((h as f32 * scale) as u32).max(1);
    match image::RgbaImage::from_raw(w, h, pixels) {
        Some(img) => {
            let s = image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle);
            (s.into_raw(), nw, nh)
        }
        None => (vec![], 0, 0),
    }
}

// ── Windows GDI raw capture ────────────────────────────────────────────────

#[cfg(windows)]
mod win {
    use winapi::shared::minwindef::{BOOL, DWORD, FALSE, LPARAM, TRUE};
    use winapi::shared::windef::{HBITMAP, HWND, POINT, RECT};
    use winapi::um::wingdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, RGBQUAD, SRCCOPY,
    };
    use winapi::um::winuser::{
        ClientToScreen, EnumWindows, GetClientRect, GetDC, GetForegroundWindow, GetWindowLongW,
        GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, ReleaseDC, GWL_STYLE,
    };

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
            if style & 0x00C0_0000 /* WS_CAPTION */ == 0 {
                return TRUE;
            }
            let mut title = [0u16; 512];
            if GetWindowTextW(hwnd, title.as_mut_ptr(), 512) == 0 {
                return TRUE;
            }
        }
        d.hwnd = hwnd;
        FALSE
    }

    fn find_window(pid: u32) -> Option<HWND> {
        let mut d = FindData {
            pid,
            hwnd: std::ptr::null_mut(),
            strict: true,
        };
        unsafe { EnumWindows(Some(enum_proc), &mut d as *mut _ as LPARAM) };
        if !d.hwnd.is_null() {
            return Some(d.hwnd);
        }
        let mut d2 = FindData {
            pid,
            hwnd: std::ptr::null_mut(),
            strict: false,
        };
        unsafe { EnumWindows(Some(enum_proc), &mut d2 as *mut _ as LPARAM) };
        if d2.hwnd.is_null() {
            None
        } else {
            Some(d2.hwnd)
        }
    }

    /// Returns raw RGBA pixels and dimensions for the game window, or `None`.
    pub fn capture_raw(pid: u32) -> Option<(Vec<u8>, u32, u32)> {
        let hwnd = find_window(pid)?;
        unsafe {
            let mut rect: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut rect);
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            if w <= 0 || h <= 0 {
                return None;
            }

            let hdc_src = GetDC(hwnd);
            if hdc_src.is_null() {
                return None;
            }
            let hdc_mem = CreateCompatibleDC(hdc_src);
            let hbmp: HBITMAP = CreateCompatibleBitmap(hdc_src, w, h);
            let old = SelectObject(hdc_mem, hbmp as *mut _);

            // Foreground games: BitBlt from screen; background: copy from window DC.
            let is_fg = GetForegroundWindow() == hwnd;
            if is_fg {
                let mut pt = POINT { x: 0, y: 0 };
                ClientToScreen(hwnd, &mut pt);
                let hdc_scr = GetDC(std::ptr::null_mut());
                if !hdc_scr.is_null() {
                    BitBlt(hdc_mem, 0, 0, w, h, hdc_scr, pt.x, pt.y, SRCCOPY);
                    ReleaseDC(std::ptr::null_mut(), hdc_scr);
                } else {
                    BitBlt(hdc_mem, 0, 0, w, h, hdc_src, 0, 0, SRCCOPY);
                }
            } else {
                BitBlt(hdc_mem, 0, 0, w, h, hdc_src, 0, 0, SRCCOPY);
            }

            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down
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

            let mut buf = vec![0u8; (w * h * 4) as usize];
            let ret = GetDIBits(
                hdc_mem,
                hbmp,
                0,
                h as u32,
                buf.as_mut_ptr() as *mut _,
                &mut bmi,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, old);
            DeleteObject(hbmp as *mut _);
            DeleteDC(hdc_mem);
            ReleaseDC(hwnd, hdc_src);

            if ret == 0 {
                return None;
            }

            // GDI returns BGRA — swap B ↔ R, set A = 255.
            for px in buf.chunks_mut(4) {
                px.swap(0, 2);
                px[3] = 255;
            }

            Some((buf, w as u32, h as u32))
        }
    }
}

// ── Linux raw capture ──────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
fn linux_capture_raw(pid: u32) -> Option<(Vec<u8>, u32, u32)> {
    use std::process::Command;

    let tmp = std::env::temp_dir().join(format!("libmaly_replay_{}.png", now_ms()));
    let tmp_s = tmp.to_string_lossy().to_string();

    // Try xdotool to find the window by PID, then capture just that window.
    let win_id = Command::new("xdotool")
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

    let ok = win_id
        .as_deref()
        .map(|wid| {
            Command::new("scrot")
                .args(["--window", wid, &tmp_s])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
        .unwrap_or(false)
        || Command::new("scrot")
            .args(["--focused", &tmp_s])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        || Command::new("import")
            .args(["-window", "root", &tmp_s])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

    if !ok || !tmp.exists() {
        return None;
    }

    let img = image::open(&tmp).ok()?;
    let _ = std::fs::remove_file(&tmp);
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Some((rgba.into_raw(), w, h))
}

// ── macOS raw capture ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn macos_capture_raw(pid: u32) -> Option<(Vec<u8>, u32, u32)> {
    use std::process::Command;
    let _ = pid; // screencapture -m captures the frontmost window regardless of PID

    let tmp = std::env::temp_dir().join(format!("libmaly_replay_{}.png", now_ms()));
    let tmp_s = tmp.to_string_lossy().to_string();

    let ok = Command::new("screencapture")
        .args(["-x", "-m", &tmp_s])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !ok || !tmp.exists() {
        return None;
    }

    let img = image::open(&tmp).ok()?;
    let _ = std::fs::remove_file(&tmp);
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Some((rgba.into_raw(), w, h))
}

// ── Utilities ──────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
