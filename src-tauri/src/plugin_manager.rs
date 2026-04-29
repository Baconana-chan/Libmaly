// ─── Plugin Manager ───────────────────────────────────────────────────────────
//
// Manages JS metadata-source and UI-panel plugins stored in:
//   <AppData>/plugins/<id>/
//
// Plugin types
//   metadata-source  — A plugin.js file that exports a `fetchMetadata(url, html)`
//                      function.  Libmaly pre-fetches the URL, passes the HTML
//                      body to the JS function (evaluated via boa_engine), and
//                      maps the returned object to GameMetadata.
//
//   ui-panel         — An index.html file that Libmaly renders in an <iframe>
//                      inside the Settings > Plugins tab.  The panel can
//                      communicate with the host via window.parent.postMessage.
//
// WASM plugin support can be added in the future by wiring in `wasmtime` or
// `wasmer`; the manifest schema already supports a `kind: "wasm"` variant.

use boa_engine::{Context as JsContext, Source as JsSource};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::io::Read as _;
use std::path::PathBuf;

use crate::data_paths::app_data_root;
use crate::metadata::{finalize_scrape_result, http, GameMetadata};

// ── Constants ─────────────────────────────────────────────────────────────────

const PLUGINS_REGISTRY_FILE: &str = "plugins_registry.json";
const PLUGINS_DIR: &str = "plugins";

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PluginKind {
    MetadataSource,
    UiPanel,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub kind: PluginKind,
    /// Regex strings matched against the URL for metadata-source plugins.
    #[serde(default)]
    pub url_patterns: Vec<String>,
    /// Display title for ui-panel plugins (falls back to `name`).
    #[serde(default)]
    pub panel_title: Option<String>,
    /// Emoji or short text shown as the panel icon (ui-panel only).
    #[serde(default)]
    pub panel_icon: Option<String>,
    /// Filename relative to the plugin directory.
    /// metadata-source → plugin.js  |  ui-panel → index.html
    pub entrypoint: String,
}

impl PluginManifest {
    pub fn summary(&self) -> PluginSummary {
        PluginSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            version: self.version.clone(),
            author: self.author.clone(),
            description: self.description.clone(),
            enabled: self.enabled,
            kind: self.kind.clone(),
            url_patterns: self.url_patterns.clone(),
            panel_title: self.panel_title.clone(),
            panel_icon: self.panel_icon.clone(),
            entrypoint: self.entrypoint.clone(),
        }
    }
}

/// Serialisable summary returned by list / install commands.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub kind: PluginKind,
    pub url_patterns: Vec<String>,
    pub panel_title: Option<String>,
    pub panel_icon: Option<String>,
    pub entrypoint: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PluginRegistry {
    #[serde(default)]
    plugins: Vec<PluginManifest>,
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn plugins_root() -> PathBuf {
    app_data_root().join(PLUGINS_DIR)
}

fn plugin_dir(safe_id: &str) -> PathBuf {
    plugins_root().join(safe_id)
}

fn registry_path() -> PathBuf {
    app_data_root().join(PLUGINS_REGISTRY_FILE)
}

fn load_registry() -> PluginRegistry {
    let path = registry_path();
    if !path.exists() {
        return PluginRegistry::default();
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return PluginRegistry::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_registry(registry: &PluginRegistry) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(registry).map_err(|e| e.to_string())?;
    let path = registry_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, raw).map_err(|e| e.to_string())
}

fn default_true() -> bool {
    true
}

// ── Sanitization ──────────────────────────────────────────────────────────────

/// Converts an arbitrary plugin id to a filesystem-safe lowercase ASCII string.
pub fn sanitize_plugin_id(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else if ch == ' ' && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

// ── Validation ────────────────────────────────────────────────────────────────

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.id.trim().is_empty() {
        return Err("Plugin manifest is missing 'id'".to_string());
    }
    if manifest.name.trim().is_empty() {
        return Err("Plugin manifest is missing 'name'".to_string());
    }
    if manifest.entrypoint.trim().is_empty() {
        return Err("Plugin manifest is missing 'entrypoint'".to_string());
    }
    // Security: reject path traversal in entrypoint
    if manifest.entrypoint.contains("..") || manifest.entrypoint.starts_with('/') {
        return Err("Plugin entrypoint must be a plain filename without path separators".to_string());
    }
    if manifest.kind == PluginKind::MetadataSource && manifest.url_patterns.is_empty() {
        return Err(
            "A metadata-source plugin must declare at least one urlPattern".to_string(),
        );
    }
    for pattern in &manifest.url_patterns {
        Regex::new(pattern)
            .map_err(|e| format!("Invalid urlPattern '{pattern}': {e}"))?;
    }
    Ok(())
}

// ── JS execution ──────────────────────────────────────────────────────────────

/// Runs a metadata-source plugin's JS entrypoint.
///
/// The plugin script must define `function fetchMetadata(url, html)` which
/// returns a GameMetadata-shaped object (or null/undefined if the URL is
/// not supported).  The function receives:
///   - url  — the URL string
///   - html — the pre-fetched HTML body text
///
/// Any additional HTTP fetches needed by the plugin must be done declaratively
/// (return multiple source_url values); live httpGet() is a future enhancement.
fn run_metadata_plugin_js(
    script_path: &PathBuf,
    url: &str,
    html: &str,
) -> Result<GameMetadata, String> {
    let script = std::fs::read_to_string(script_path)
        .map_err(|e| format!("Cannot read plugin script: {e}"))?;

    let url_json = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".to_string());
    let html_json = serde_json::to_string(html).unwrap_or_else(|_| "\"\"".to_string());

    // Wrap the plugin: execute fetchMetadata and serialise the result.
    let wrapped = format!(
        r#"
{script}
JSON.stringify((function() {{
  var __r = fetchMetadata({url_json}, {html_json});
  return __r || null;
}})());
"#
    );

    let mut context = JsContext::default();
    let result = context
        .eval(JsSource::from_bytes(wrapped.as_bytes()))
        .map_err(|e| format!("Plugin JS error: {e}"))?;

    let result_text = result
        .to_string(&mut context)
        .map_err(|e| format!("Plugin JS returned non-string: {e}"))?
        .to_std_string_escaped();

    if result_text == "null" || result_text == "undefined" {
        return Err("Plugin returned null — URL may not be supported by this plugin".to_string());
    }

    let mut meta: GameMetadata = serde_json::from_str(&result_text)
        .map_err(|e| format!("Plugin returned invalid GameMetadata JSON: {e}"))?;

    // Ensure source_url is set; plugin may override it (e.g. canonical URL).
    if meta.source_url.is_empty() {
        meta.source_url = url.to_string();
    }

    Ok(meta)
}

// ── Public helpers (used by lib.rs) ──────────────────────────────────────────

/// Returns the first enabled metadata-source plugin whose urlPatterns match
/// the given URL, or `None` if no plugin matches.
pub fn find_plugin_for_url(url: &str) -> Option<PluginManifest> {
    let registry = load_registry();
    for manifest in registry
        .plugins
        .into_iter()
        .filter(|p| p.enabled && p.kind == PluginKind::MetadataSource)
    {
        for pattern in &manifest.url_patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(url) {
                    return Some(manifest);
                }
            }
        }
    }
    None
}

/// Fetch metadata via a specific plugin (async, called from lib.rs).
pub async fn fetch_metadata_via_plugin(
    manifest: &PluginManifest,
    url: &str,
) -> Result<GameMetadata, String> {
    if !manifest.enabled {
        return Err(format!("Plugin '{}' is disabled", manifest.id));
    }
    if manifest.kind != PluginKind::MetadataSource {
        return Err(format!("Plugin '{}' is not a metadata-source plugin", manifest.id));
    }

    // Pre-fetch the URL in the async context before handing off to the sync JS engine.
    let html = http()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Plugin HTTP fetch failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Plugin HTTP read failed: {e}"))?;

    let safe_id = sanitize_plugin_id(&manifest.id);
    let script_path = plugin_dir(&safe_id).join(&manifest.entrypoint);
    let url_owned = url.to_string();
    let plugin_name = manifest.name.clone();
    let plugin_id = manifest.id.clone();

    let meta = tokio::task::spawn_blocking(move || {
        run_metadata_plugin_js(&script_path, &url_owned, &html)
    })
    .await
    .map_err(|e| e.to_string())??;

    finalize_scrape_result(&plugin_id, &plugin_name, &meta.source_url.clone(), Ok(meta))
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// List all installed plugins (both enabled and disabled).
#[tauri::command]
pub fn plugin_list() -> Vec<PluginSummary> {
    load_registry()
        .plugins
        .iter()
        .map(|p| p.summary())
        .collect()
}

/// Install a plugin from a zip archive.
///
/// The zip must contain:
///   manifest.json  — the PluginManifest
///   <entrypoint>   — the JS or HTML entrypoint declared in the manifest
///
/// Any additional assets (CSS, images, …) may also be included and will be
/// extracted alongside the entrypoint.
#[tauri::command]
pub fn plugin_install_from_zip(zip_path: String) -> Result<PluginSummary, String> {
    let bytes = std::fs::read(&zip_path)
        .map_err(|e| format!("Cannot read zip file: {e}"))?;
    let cursor = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip archive: {e}"))?;

    // Read and validate the manifest first.
    let manifest: PluginManifest = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "Plugin zip must contain a manifest.json file".to_string())?;
        let mut raw = String::new();
        entry
            .read_to_string(&mut raw)
            .map_err(|e| format!("Cannot read manifest.json: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("Invalid manifest.json: {e}"))?
    };

    validate_manifest(&manifest)?;

    // Confirm the declared entrypoint exists in the zip.
    archive
        .by_name(&manifest.entrypoint)
        .map_err(|_| format!("Plugin zip is missing declared entrypoint '{}'", manifest.entrypoint))?;

    let safe_id = sanitize_plugin_id(&manifest.id);
    if safe_id.is_empty() {
        return Err("Plugin id is empty after sanitization".to_string());
    }

    // Extract all zip entries to the plugin directory.
    let dest = plugin_dir(&safe_id);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        // Security: skip absolute paths, directory traversal, and directory entries.
        if name.contains("..") || name.starts_with('/') || name.ends_with('/') {
            continue;
        }

        let out_path = dest.join(&name);
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
    }

    // Register in the global plugin registry.
    let mut registry = load_registry();
    registry.plugins.retain(|p| sanitize_plugin_id(&p.id) != safe_id);
    registry.plugins.push(manifest.clone());
    save_registry(&registry)?;

    Ok(manifest.summary())
}

/// Install a metadata-source plugin defined entirely inline (no zip needed).
///
/// The `manifest_json` describes the plugin (id, name, urlPatterns, …) and
/// `script` is the JS source.  The entrypoint defaults to `plugin.js`.
#[tauri::command]
pub fn plugin_install_inline(
    manifest_json: String,
    script: String,
) -> Result<PluginSummary, String> {
    let mut manifest: PluginManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Invalid manifest JSON: {e}"))?;

    manifest.kind = PluginKind::MetadataSource;
    if manifest.entrypoint.trim().is_empty() {
        manifest.entrypoint = "plugin.js".to_string();
    }

    validate_manifest(&manifest)?;

    let safe_id = sanitize_plugin_id(&manifest.id);
    if safe_id.is_empty() {
        return Err("Plugin id is empty after sanitization".to_string());
    }

    let dest = plugin_dir(&safe_id);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    std::fs::write(dest.join(&manifest.entrypoint), &script)
        .map_err(|e| format!("Cannot write plugin script: {e}"))?;
    std::fs::write(
        dest.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut registry = load_registry();
    registry.plugins.retain(|p| sanitize_plugin_id(&p.id) != safe_id);
    registry.plugins.push(manifest.clone());
    save_registry(&registry)?;

    Ok(manifest.summary())
}

/// Enable or disable a plugin.
#[tauri::command]
pub fn plugin_set_enabled(id: String, enabled: bool) -> Result<(), String> {
    let safe_id = sanitize_plugin_id(&id);
    let mut registry = load_registry();
    let plugin = registry
        .plugins
        .iter_mut()
        .find(|p| sanitize_plugin_id(&p.id) == safe_id)
        .ok_or_else(|| format!("Plugin '{}' not found", id))?;
    plugin.enabled = enabled;
    save_registry(&registry)
}

/// Permanently delete a plugin and all its files.
#[tauri::command]
pub fn plugin_delete(id: String) -> Result<(), String> {
    let safe_id = sanitize_plugin_id(&id);
    let dir = plugin_dir(&safe_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let mut registry = load_registry();
    registry.plugins.retain(|p| sanitize_plugin_id(&p.id) != safe_id);
    save_registry(&registry)
}

/// Read the JS source of a metadata-source plugin.
#[tauri::command]
pub fn plugin_get_script(id: String) -> Result<String, String> {
    let safe_id = sanitize_plugin_id(&id);
    let registry = load_registry();
    let manifest = registry
        .plugins
        .iter()
        .find(|p| sanitize_plugin_id(&p.id) == safe_id)
        .ok_or_else(|| format!("Plugin '{}' not found", id))?;
    if manifest.kind != PluginKind::MetadataSource {
        return Err("plugin_get_script is only for metadata-source plugins".to_string());
    }
    let script_path = plugin_dir(&safe_id).join(&manifest.entrypoint);
    std::fs::read_to_string(&script_path).map_err(|e| e.to_string())
}

/// Return the absolute filesystem path to a ui-panel plugin's entrypoint HTML.
/// The frontend loads this via a `tauri://` asset URL or file:// iframe src.
#[tauri::command]
pub fn plugin_get_panel_path(id: String) -> Result<String, String> {
    let safe_id = sanitize_plugin_id(&id);
    let registry = load_registry();
    let manifest = registry
        .plugins
        .iter()
        .find(|p| sanitize_plugin_id(&p.id) == safe_id)
        .ok_or_else(|| format!("Plugin '{}' not found", id))?;
    if manifest.kind != PluginKind::UiPanel {
        return Err("plugin_get_panel_path is only for ui-panel plugins".to_string());
    }
    let path = plugin_dir(&safe_id).join(&manifest.entrypoint);
    if !path.exists() {
        return Err(format!(
            "UI panel entrypoint '{}' does not exist on disk",
            path.display()
        ));
    }
    Ok(path.to_string_lossy().to_string())
}

/// Find which plugin (if any) handles the given URL.
#[tauri::command]
pub fn plugin_match_url(url: String) -> Option<PluginSummary> {
    find_plugin_for_url(&url).map(|m| m.summary())
}

/// Fetch metadata for a URL using a specific plugin.
#[tauri::command]
pub async fn plugin_fetch_metadata(
    plugin_id: String,
    url: String,
) -> Result<GameMetadata, String> {
    let safe_id = sanitize_plugin_id(&plugin_id);
    let registry = load_registry();
    let manifest = registry
        .plugins
        .iter()
        .find(|p| sanitize_plugin_id(&p.id) == safe_id)
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?
        .clone();
    fetch_metadata_via_plugin(&manifest, &url).await
}
