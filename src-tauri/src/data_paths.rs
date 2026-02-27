use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const PORTABLE_MARKERS: [&str; 2] = ["portable.mode", ".portable"];
const PORTABLE_ENV: &str = "LIBMALY_PORTABLE";

fn executable_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|x| x.to_path_buf()))
}

pub fn is_portable_mode() -> bool {
    if let Ok(v) = std::env::var(PORTABLE_ENV) {
        let normalized = v.trim().to_ascii_lowercase();
        if matches!(normalized.as_str(), "1" | "true" | "yes" | "on") {
            return true;
        }
    }

    if let Some(exe_dir) = executable_dir() {
        for marker in PORTABLE_MARKERS {
            if exe_dir.join(marker).exists() {
                return true;
            }
        }
    }
    false
}

pub fn app_data_root() -> PathBuf {
    if is_portable_mode() {
        return executable_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("libmaly-data");
    }

    #[cfg(windows)]
    {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        return base.join("libmaly");
    }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".local/share");
        return base.join("libmaly");
    }
    #[cfg(target_os = "macos")]
    {
        let base = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("Library/Application Support");
        return base.join("libmaly");
    }
}

pub fn crash_report_path(app: &AppHandle, filename: &str) -> PathBuf {
    if is_portable_mode() {
        return app_data_root().join(filename);
    }

    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| app_data_root())
        .join(filename)
}

