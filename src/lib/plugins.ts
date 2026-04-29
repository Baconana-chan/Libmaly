import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PluginKind = "metadata-source" | "ui-panel";

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  enabled: boolean;
  kind: PluginKind;
  /** Regex patterns (metadata-source only). */
  urlPatterns: string[];
  /** Display title for ui-panel plugins (falls back to name). */
  panelTitle?: string;
  /** Short icon text / emoji for ui-panel plugins. */
  panelIcon?: string;
  /** Entrypoint filename relative to the plugin directory. */
  entrypoint: string;
}

export interface PluginManifestInput {
  id: string;
  name: string;
  version?: string;
  author?: string;
  description?: string;
  /** Defaults to true. */
  enabled?: boolean;
  kind?: PluginKind;
  urlPatterns?: string[];
  panelTitle?: string;
  panelIcon?: string;
  entrypoint?: string;
}

// ── Invoke wrappers ───────────────────────────────────────────────────────────

/** List all installed plugins. */
export function invokePluginList(): Promise<PluginSummary[]> {
  return invoke<PluginSummary[]>("plugin_list");
}

/**
 * Install a plugin from a zip file path (absolute path on disk).
 * The zip must contain `manifest.json` and the declared entrypoint file.
 */
export function invokePluginInstallFromZip(
  zipPath: string,
): Promise<PluginSummary> {
  return invoke<PluginSummary>("plugin_install_from_zip", { zipPath });
}

/**
 * Install a metadata-source plugin inline.
 * @param manifest  Plugin manifest (id, name, urlPatterns required).
 * @param script    JS source for the plugin's `fetchMetadata(url, html)` function.
 */
export function invokePluginInstallInline(
  manifest: PluginManifestInput,
  script: string,
): Promise<PluginSummary> {
  return invoke<PluginSummary>("plugin_install_inline", {
    manifestJson: JSON.stringify(manifest),
    script,
  });
}

/** Enable or disable a plugin. */
export function invokePluginSetEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>("plugin_set_enabled", { id, enabled });
}

/** Permanently delete a plugin and all its files. */
export function invokePluginDelete(id: string): Promise<void> {
  return invoke<void>("plugin_delete", { id });
}

/** Read the JS source of a metadata-source plugin. */
export function invokePluginGetScript(id: string): Promise<string> {
  return invoke<string>("plugin_get_script", { id });
}

/** Return the absolute path to a ui-panel plugin's entrypoint HTML. */
export function invokePluginGetPanelPath(id: string): Promise<string> {
  return invoke<string>("plugin_get_panel_path", { id });
}

/** Find the first enabled plugin that handles the given URL (or null). */
export function invokePluginMatchUrl(
  url: string,
): Promise<PluginSummary | null> {
  return invoke<PluginSummary | null>("plugin_match_url", { url });
}

/**
 * Fetch metadata for a URL via a specific plugin.
 * Returns a GameMetadata-shaped object.
 */
export function invokePluginFetchMetadata(
  pluginId: string,
  url: string,
): Promise<unknown> {
  return invoke("plugin_fetch_metadata", { pluginId, url });
}
