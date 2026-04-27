//! System performance monitor — polls CPU, RAM, and (Windows) GPU telemetry
//! every second in a background thread and exposes the latest snapshot via
//! a Tauri command so the overlay widget can display it.

use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use sysinfo::System;

// ── Public data type ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
pub struct SystemTelemetry {
    /// Overall CPU usage 0–100 %
    pub cpu_usage: f32,
    /// Used RAM in MiB
    pub ram_used_mb: u64,
    /// Total RAM in MiB
    pub ram_total_mb: u64,
    /// GPU 3D engine utilization 0–100 % (None if unavailable)
    pub gpu_usage: Option<f32>,
    /// Human-readable GPU name (None if unavailable)
    pub gpu_name: Option<String>,
}

// ── Static store ──────────────────────────────────────────────────────────

static TELEMETRY: OnceLock<Mutex<SystemTelemetry>> = OnceLock::new();

fn store() -> &'static Mutex<SystemTelemetry> {
    TELEMETRY.get_or_init(|| Mutex::new(SystemTelemetry::default()))
}

// ── Public API ────────────────────────────────────────────────────────────

/// Start the background polling thread (idempotent — safe to call multiple times).
pub fn start_monitor() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        let _ = thread::Builder::new()
            .name("libmaly-sysmon".into())
            .spawn(monitor_loop);
    });
}

/// Read the most recently collected telemetry snapshot.
pub fn read() -> SystemTelemetry {
    store().lock().map(|g| g.clone()).unwrap_or_default()
}

// ── Background loop ───────────────────────────────────────────────────────

fn monitor_loop() {
    let mut sys = System::new();

    // sysinfo requires two refresh calls with a delay to produce a meaningful
    // CPU usage value (it computes a delta between samples).
    sys.refresh_cpu_usage();
    thread::sleep(Duration::from_millis(600));

    // Initialise GPU monitoring (Windows-only)
    #[cfg(windows)]
    let gpu_mon = GpuMonitor::new();

    // GPU name is static — read once
    #[cfg(windows)]
    let gpu_name = read_gpu_name();
    #[cfg(not(windows))]
    let gpu_name: Option<String> = None;

    // Persist the GPU name in the store immediately
    if let Ok(mut t) = store().lock() {
        t.gpu_name = gpu_name.clone();
    }

    loop {
        sys.refresh_cpu_usage();
        sys.refresh_memory();

        #[cfg(windows)]
        let gpu_usage = gpu_mon.sample();
        #[cfg(not(windows))]
        let gpu_usage: Option<f32> = None;

        if let Ok(mut t) = store().lock() {
            t.cpu_usage = sys.global_cpu_usage();
            t.ram_used_mb = sys.used_memory() / 1_048_576;
            t.ram_total_mb = sys.total_memory() / 1_048_576;
            t.gpu_usage = gpu_usage;
        }

        thread::sleep(Duration::from_millis(1_000));
    }
}

// ── Windows GPU via PDH ───────────────────────────────────────────────────

#[cfg(windows)]
struct GpuMonitor {
    query: winapi::um::pdh::PDH_HQUERY,
    counter: winapi::um::pdh::PDH_HCOUNTER,
    ok: bool,
}

#[cfg(windows)]
unsafe impl Send for GpuMonitor {}

#[cfg(windows)]
impl GpuMonitor {
    fn new() -> Self {
        use std::ptr;
        use winapi::um::pdh::{
            PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhOpenQueryW,
        };

        let mut query = ptr::null_mut();
        let mut counter = ptr::null_mut();
        let mut ok = false;

        // This PDH counter is available on Windows 10 1607+ and aggregates
        // ALL processes using the GPU 3D engine — i.e. total GPU utilization.
        let path: Vec<u16> = "\\GPU Engine(*engtype_3D)\\Utilization Percentage\0"
            .encode_utf16()
            .collect();

        unsafe {
            if PdhOpenQueryW(ptr::null(), 0, &mut query) == 0 {
                if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) == 0 {
                    // First collection primes the rate counter; the second will
                    // produce a meaningful delta value.
                    PdhCollectQueryData(query);
                    ok = true;
                } else {
                    PdhCloseQuery(query);
                    query = ptr::null_mut();
                }
            }
        }

        Self { query, counter, ok }
    }

    fn sample(&self) -> Option<f32> {
        use std::ptr;
        use winapi::um::pdh::{
            PdhCollectQueryData, PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W,
            PDH_FMT_DOUBLE,
        };

        if !self.ok {
            return None;
        }

        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }

            // First call: query the required buffer size
            let mut buf_size: u32 = 0;
            let mut count: u32 = 0;
            PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut buf_size,
                &mut count,
                ptr::null_mut(),
            );

            if count == 0 || buf_size == 0 {
                return None;
            }

            // Second call: fill the buffer
            let mut buf: Vec<u8> = vec![0u8; buf_size as usize];
            let status = PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut buf_size,
                &mut count,
                buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W,
            );

            // 0 = PDH_STATUS_OK
            if status != 0 {
                return None;
            }

            let items = std::slice::from_raw_parts(
                buf.as_ptr() as *const PDH_FMT_COUNTERVALUE_ITEM_W,
                count as usize,
            );

            // Sum all process contributions for this engine type.
            // CStatus 0 = PDH_CSTATUS_VALID_DATA, 1 = PDH_CSTATUS_NEW_DATA
            let total: f64 = items
                .iter()
                .filter(|i| i.FmtValue.CStatus == 0 || i.FmtValue.CStatus == 1)
                .map(|i| *i.FmtValue.u.doubleValue())
                .sum();

            Some(total.min(100.0) as f32)
        }
    }
}

#[cfg(windows)]
impl Drop for GpuMonitor {
    fn drop(&mut self) {
        if self.ok {
            unsafe {
                winapi::um::pdh::PdhCloseQuery(self.query);
            }
        }
    }
}

// ── GPU name from registry ────────────────────────────────────────────────

#[cfg(windows)]
fn read_gpu_name() -> Option<String> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let video = hklm
        .open_subkey_with_flags("SYSTEM\\CurrentControlSet\\Control\\Video", KEY_READ)
        .ok()?;

    // Each sub-key is a {GUID} for an adapter; the "0000" sub-key is the primary adapter.
    for adapter_guid in video.enum_keys().flatten() {
        if let Ok(adapter) = video.open_subkey_with_flags(&adapter_guid, KEY_READ) {
            if let Ok(idx0) = adapter.open_subkey_with_flags("0000", KEY_READ) {
                if let Ok(desc) = idx0.get_value::<String, _>("DriverDesc") {
                    if !desc.is_empty() {
                        return Some(desc);
                    }
                }
            }
        }
    }
    None
}
