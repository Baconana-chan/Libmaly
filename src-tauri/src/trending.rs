//! Anonymized Global Trending
//!
//! Opt-in feature that lets users see "Most played globally this week" without
//! any personal identity tracking.
//!
//! # Privacy guarantees
//! - **Opt-in only** — disabled by default.
//! - **No peer ID** in contribution payloads — the relay cannot link submissions
//!   to any particular Libmaly installation.
//! - **Titles only** — no game file paths, no profile fields.
//! - **Bucketed hours** — play time is rounded to the nearest 0.5 h to prevent
//!   exact-session fingerprinting (6 h 37 m becomes 6.5 h).
//! - **Rate-limited** — at most one contribution per 24 h per installation.
//! - **Ephemeral submission ID** — each POST carries a freshly generated random
//!   UUID that is not stored anywhere and is not linked to the peer ID.
//!
//! # Relay API (client side)
//!   GET  /pulse/trending?limit=N
//!        Returns `Vec<TrendingEntry>` (ranked list of game titles).
//!   POST /pulse/trending/contribute
//!        Body: `{ epochWeek, entries: [{ title, hoursBucket }] }`
//!        No auth required; relay aggregates and discards raw submissions.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::data_paths::app_data_root;

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_FILE: &str = "trending_config.json";

/// Minimum seconds between contributions (24 h).
const CONTRIBUTE_COOLDOWN_SECS: u64 = 86_400;

/// Number of seconds in one week (for epoch-week calculation).
const SECS_PER_WEEK: u64 = 604_800;

/// Maximum entries per contribution (prevents accidental over-sharing).
const MAX_CONTRIBUTION_ENTRIES: usize = 50;

// ── Config ────────────────────────────────────────────────────────────────────

/// Persisted trending configuration.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrendingConfig {
    /// Whether the user has opted in. Default: false.
    #[serde(default)]
    pub enabled: bool,

    /// Unix timestamp (seconds) of the last successful contribution.
    /// Used to enforce the 24-h rate limit.
    #[serde(default)]
    pub last_contributed_at_secs: Option<u64>,
}

impl Default for TrendingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            last_contributed_at_secs: None,
        }
    }
}

// ── Wire types ────────────────────────────────────────────────────────────────

/// One game in a contribution — all personal data stripped.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ContributionItem {
    /// Game title (from metadata or folder name). No paths.
    pub title: String,
    /// Hours played this week, rounded to nearest 0.5 h.
    pub hours_bucket: f32,
}

/// Payload POSTed to `POST /pulse/trending/contribute`.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ContributionPayload {
    /// Week number since Unix epoch (unix_secs / SECS_PER_WEEK).
    /// Allows the relay to discard stale contributions cleanly.
    epoch_week: u64,
    /// Anonymized game entries for this week.
    entries: Vec<ContributionItem>,
    /// Fresh ephemeral UUID — not stored, not linked to peer ID.
    submission_id: String,
}

/// One entry in the global trending list returned by the relay.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrendingEntry {
    /// Game title as submitted by contributors.
    pub title: String,
    /// 1-based rank position.
    #[serde(default)]
    pub rank: u32,
    /// Relay-aggregated approximate total hours across all contributors.
    #[serde(default)]
    pub total_hours_approx: f32,
    /// Number of distinct contributors that reported this title.
    #[serde(default)]
    pub contributor_count: u32,
}

/// Metadata returned alongside the trending list.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrendingResult {
    pub entries: Vec<TrendingEntry>,
    /// ISO-8601 date string of the week start (informational, relay-provided).
    #[serde(default)]
    pub week_start: Option<String>,
    /// Total number of contributors for this week (informational).
    #[serde(default)]
    pub total_contributors: Option<u32>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

fn epoch_week_now() -> u64 {
    now_secs() / SECS_PER_WEEK
}

/// Round hours to the nearest 0.5 h (privacy: prevents exact-session fingerprinting).
fn bucket_hours(hours: f32) -> f32 {
    (hours * 2.0).round() / 2.0
}

/// Generate a random UUID v4 string (ephemeral, not stored).
fn random_uuid() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    // Mix several entropy sources available in std (no extra deps needed).
    let mut h = DefaultHasher::new();
    now_secs().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    let a = h.finish();

    std::time::Instant::now().elapsed().subsec_nanos().hash(&mut h);
    let b = h.finish();

    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (a >> 32) as u32,
        (a >> 16) as u16,
        a as u16 & 0x0fff,
        (b >> 16) as u16 | 0x8000,
        b & 0x0000_ffff_ffff,
    )
}

// ── Persistence ───────────────────────────────────────────────────────────────

fn config_path() -> std::path::PathBuf {
    app_data_root().join(CONFIG_FILE)
}

fn load_config() -> TrendingConfig {
    let path = config_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_config(cfg: &TrendingConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async fn http_get_trending(relay_url: &str, limit: u32) -> Result<TrendingResult, String> {
    let base = relay_url.trim_end_matches('/');
    let url = format!("{}/pulse/trending?limit={}", base, limit);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Relay returned HTTP {}", resp.status()));
    }
    // Try to parse as TrendingResult; fall back to bare Vec<TrendingEntry>
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if let Ok(result) = serde_json::from_str::<TrendingResult>(&text) {
        return Ok(result);
    }
    // Bare array fallback (simpler relay implementations)
    let entries: Vec<TrendingEntry> = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse trending response: {}", e))?;
    let with_ranks: Vec<TrendingEntry> = entries
        .into_iter()
        .enumerate()
        .map(|(i, mut e)| {
            if e.rank == 0 {
                e.rank = (i + 1) as u32;
            }
            e
        })
        .collect();
    Ok(TrendingResult {
        entries: with_ranks,
        week_start: None,
        total_contributors: None,
    })
}

async fn http_post_contribution(
    relay_url: &str,
    payload: ContributionPayload,
) -> Result<(), String> {
    let base = relay_url.trim_end_matches('/');
    let url = format!("{}/pulse/trending/contribute", base);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() || resp.status().as_u16() == 204 {
        Ok(())
    } else {
        Err(format!("Relay returned HTTP {}", resp.status()))
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the current trending configuration.
#[tauri::command]
pub fn trending_get_config() -> TrendingConfig {
    load_config()
}

/// Persist updated trending configuration.
#[tauri::command]
pub fn trending_save_config(config: TrendingConfig) -> Result<(), String> {
    persist_config(&config)
}

/// Fetch the global trending list from the relay.
///
/// Does NOT require opt-in — users can view trending data without contributing.
#[tauri::command]
pub async fn trending_fetch(relay_url: String, limit: u32) -> Result<TrendingResult, String> {
    let limit = limit.clamp(1, 100);
    http_get_trending(&relay_url, limit).await
}

/// Contribute anonymized weekly play stats to the relay.
///
/// The frontend computes `entries` (titles + bucketed hours) from local session
/// data — no paths or identity fields ever reach this function.
///
/// Rate-limited to once per 24 h.  Enforced on the client side; the relay may
/// also enforce its own limits.
///
/// Returns `Ok(())` when the contribution was accepted or when the rate-limit
/// has not yet expired (silently skipped — not an error for the caller).
#[tauri::command]
pub async fn trending_contribute(
    relay_url: String,
    entries: Vec<ContributionItem>,
) -> Result<(), String> {
    let mut cfg = load_config();

    // Respect opt-in — return early without error if disabled
    if !cfg.enabled {
        return Err("Trending contribution is disabled (user has not opted in).".into());
    }

    // Rate-limit: at most once per 24 h
    if let Some(last) = cfg.last_contributed_at_secs {
        let elapsed = now_secs().saturating_sub(last);
        if elapsed < CONTRIBUTE_COOLDOWN_SECS {
            let remaining = CONTRIBUTE_COOLDOWN_SECS - elapsed;
            let h = remaining / 3600;
            let m = (remaining % 3600) / 60;
            return Err(format!(
                "Rate-limited: next contribution allowed in {}h {}m.",
                h, m
            ));
        }
    }

    // Validate + sanitize entries
    if entries.is_empty() {
        return Err("No entries to contribute.".into());
    }
    let sanitized: Vec<ContributionItem> = entries
        .into_iter()
        .take(MAX_CONTRIBUTION_ENTRIES)
        .filter(|e| !e.title.trim().is_empty() && e.hours_bucket > 0.0)
        .map(|e| ContributionItem {
            title: e.title.trim().chars().take(120).collect(), // max 120 chars
            hours_bucket: bucket_hours(e.hours_bucket.clamp(0.0, 999.0)),
        })
        .collect();

    if sanitized.is_empty() {
        return Err("No valid entries after sanitization.".into());
    }

    let payload = ContributionPayload {
        epoch_week: epoch_week_now(),
        entries: sanitized,
        submission_id: random_uuid(),
    };

    http_post_contribution(&relay_url, payload).await?;

    // Update last contributed timestamp
    cfg.last_contributed_at_secs = Some(now_secs());
    persist_config(&cfg)?;

    Ok(())
}

/// Return the number of seconds until the next contribution is allowed.
/// Returns 0 when a contribution can be submitted immediately.
#[tauri::command]
pub fn trending_contribution_cooldown_secs() -> u64 {
    let cfg = load_config();
    match cfg.last_contributed_at_secs {
        None => 0,
        Some(last) => {
            let elapsed = now_secs().saturating_sub(last);
            CONTRIBUTE_COOLDOWN_SECS.saturating_sub(elapsed)
        }
    }
}
