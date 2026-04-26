import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "preact/hooks";
import { formatWinetricksErrorWithHints } from "../../lib/winetricksSupport";
import { buildShaderWarmupLines, type ShaderCacheDiscovery, WINE_COMPATIBILITY_PRESETS } from "../../lib/shaderCache";
import type { LaunchConfig, PrefixInfo, RunnerKind } from "../../types";
import { MediaInstallPreviewModal } from "./MediaInstallPreviewModal";

export function WineSettingsModal({ config, onSave, onClose, platform = "windows", onPermissionFailure }: {
  config: LaunchConfig;
  onSave: (c: LaunchConfig) => void;
  onClose: () => void;
  platform?: string;
  onPermissionFailure?: (
    operation: string,
    targetPath: string | null,
    error: unknown,
    fallbackTitle?: string,
  ) => Promise<void>;
}) {
  const [cfg, setCfg] = useState<LaunchConfig>(config);
  const [detected, setDetected] = useState<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [prefixes, setPrefixes] = useState<PrefixInfo[]>([]);
  const [prefixLoading, setPrefixLoading] = useState(false);
  const [prefixError, setPrefixError] = useState("");
  const [newPrefixPath, setNewPrefixPath] = useState("");
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [mediaInstallPreview, setMediaInstallPreview] = useState<null | { prefix: PrefixInfo; verbs: string[]; sourceLabel: string }>(null);
  const [selectedVerb, setSelectedVerb] = useState("vcrun2019");
  const winetricksVerbs = ["vcrun2019", "d3dx9", "dotnet48", "corefonts", "xact", "xinput"];
  const [shaderToolExe, setShaderToolExe] = useState("");
  const [shaderToolSteamId, setShaderToolSteamId] = useState("");
  const [shaderToolDiscovery, setShaderToolDiscovery] = useState<ShaderCacheDiscovery | null>(null);
  const [shaderToolBusy, setShaderToolBusy] = useState(false);

  const mediaPlaybackPresets: { label: string; verbs: string[] }[] = [
    { label: "Legacy WMV", verbs: ["wmp9", "wmv9vcm", "qasf"] },
    { label: "RPG Maker", verbs: ["directshow", "quartz", "lavfilters"] },
    { label: "WMP Heavy", verbs: ["wmp11", "mf", "qasf", "lavfilters"] },
    { label: "Fallback Only", verbs: ["directshow", "quartz"] },
  ];

  const openMediaInstallPreview = (prefix: PrefixInfo, verbs: string[], sourceLabel: string) => {
    const v = verbs.filter((x) => x.trim());
    if (!v.length) return;
    setMediaInstallPreview({ prefix, verbs: v, sourceLabel });
  };

  useEffect(() => {
    setDetecting(true);
    invoke<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>("detect_wine_runners")
      .then(setDetected).catch(() => { }).finally(() => setDetecting(false));
  }, []);

  const refreshPrefixes = useCallback(() => {
    setPrefixLoading(true);
    setPrefixError("");
    invoke<PrefixInfo[]>("list_wine_prefixes")
      .then((rows) => {
        setPrefixes(rows);
        if (!newPrefixPath && rows.length > 0) setNewPrefixPath(rows[0].path.replace(/[\\/][^\\/]+$/, ""));
      })
      .catch((e) => setPrefixError(String(e)))
      .finally(() => setPrefixLoading(false));
  }, [newPrefixPath]);

  useEffect(() => {
    refreshPrefixes();
  }, [refreshPrefixes]);

  const createPrefix = async () => {
    const target = newPrefixPath.trim();
    if (!target) return;
    setToolBusy("create");
    try {
      await invoke("create_wine_prefix", { path: target, runner: cfg.runnerPath || null });
      await refreshPrefixes();
    } catch (e) {
      alert("Failed to create prefix: " + e);
    } finally {
      setToolBusy(null);
    }
  };

  const deletePrefix = async (path: string) => {
    if (!confirm(`Delete prefix?\n${path}`)) return;
    setToolBusy(`del:${path}`);
    try {
      await invoke("delete_wine_prefix", { path });
      await refreshPrefixes();
    } catch (e) {
      alert("Failed to delete prefix: " + e);
    } finally {
      setToolBusy(null);
    }
  };

  const installGraphics = async (prefix: PrefixInfo) => {
    const needDxvk = !prefix.has_dxvk;
    const needVkd3d = !prefix.has_vkd3d;
    if (!needDxvk && !needVkd3d) return;
    setToolBusy(`gfx:${prefix.path}`);
    try {
      await invoke("install_dxvk_vkd3d", {
        prefix: prefix.path,
        installDxvk: needDxvk,
        installVkd3d: needVkd3d,
      });
      await refreshPrefixes();
    } catch (e) {
      alert(formatWinetricksErrorWithHints(String(e)));
    } finally {
      setToolBusy(null);
    }
  };

  const installMediaFixes = (prefix: PrefixInfo) => {
    if ((prefix.media.recommended_verbs?.length || 0) === 0) return;
    openMediaInstallPreview(prefix, prefix.media.recommended_verbs, "Recommended (detected missing components)");
  };

  const runVerb = async (prefix: PrefixInfo) => {
    setToolBusy(`verb:${prefix.path}`);
    try {
      await invoke("run_winetricks", { prefix: prefix.path, verbs: [selectedVerb] });
      alert(`Winetricks finished: ${selectedVerb}`);
      await refreshPrefixes();
    } catch (e) {
      alert(formatWinetricksErrorWithHints(String(e)));
    } finally {
      setToolBusy(null);
    }
  };

  const pickShaderToolExe = async () => {
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Executable", extensions: ["exe"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setShaderToolExe(sel);
  };

  const discoverShaderToolCaches = async () => {
    const exe = shaderToolExe.trim();
    if (!exe) {
      alert("Choose the game's .exe path first.");
      return;
    }
    setShaderToolBusy(true);
    try {
      const sid = shaderToolSteamId.trim() || null;
      const d = await invoke<ShaderCacheDiscovery>("discover_shader_cache_artifacts", {
        gameExePath: exe,
        steamAppId: sid,
      });
      setShaderToolDiscovery(d);
    } catch (e) {
      if (onPermissionFailure) await onPermissionFailure("discover shader cache files", exe.trim() || null, e, "Shader cache discovery failed");
      else alert("Shader cache discovery failed: " + e);
    } finally {
      setShaderToolBusy(false);
    }
  };

  const exportShaderToolBundle = async () => {
    const exe = shaderToolExe.trim();
    if (!exe) {
      alert("Choose the game's .exe path first.");
      return;
    }
    setShaderToolBusy(true);
    try {
      const sid = shaderToolSteamId.trim() || null;
      const base = exe.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") || "game";
      const safe = base.replace(/[^\w\-]+/g, "_").slice(0, 80);
      const out = await save({
        defaultPath: `libmaly-shader-cache-${safe}.zip`,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }).catch(() => null);
      if (!out || typeof out !== "string") return;
      const res = await invoke<{
        zip_path: string;
        dxvk_files_packed: number;
        steam_files_packed: number;
      }>("export_shader_cache_bundle", {
        gameExePath: exe,
        steamAppId: sid,
        outputZipPath: out,
      });
      alert(
        `Shader cache bundle saved:\n${res.zip_path}\n\nDXVK entries: ${res.dxvk_files_packed}\nSteam cache files: ${res.steam_files_packed}`,
      );
    } catch (e) {
      if (onPermissionFailure) await onPermissionFailure("export the shader cache bundle", null, e, "Shader cache export failed");
      else alert("Shader cache export failed: " + e);
    } finally {
      setShaderToolBusy(false);
    }
  };

  const importShaderToolBundle = async () => {
    const exe = shaderToolExe.trim();
    if (!exe) {
      alert("Choose the game's .exe path first.");
      return;
    }
    setShaderToolBusy(true);
    try {
      const sid = shaderToolSteamId.trim() || null;
      const zip = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      }).catch(() => null);
      if (!zip || typeof zip !== "string") return;
      const msg = await invoke<string>("import_shader_cache_bundle", {
        gameExePath: exe,
        steamAppId: sid,
        zipPath: zip,
      });
      alert(msg);
      await discoverShaderToolCaches();
    } catch (e) {
      if (onPermissionFailure) await onPermissionFailure("import the shader cache bundle", null, e, "Shader cache import failed");
      else alert("Shader cache import failed: " + e);
    } finally {
      setShaderToolBusy(false);
    }
  };

  const upd = (patch: Partial<LaunchConfig>) => setCfg((p) => ({ ...p, ...patch }));

  return (
    <>
      <div className="fixed inset-0 flex items-center justify-center z-50"
        style={{ background: "rgba(0,0,0,0.8)" }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="rounded-xl shadow-2xl w-[500px] flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-strong)", maxHeight: "80vh" }}>
          <div className="flex items-center gap-2.5 px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
            <span className="text-lg">🍷</span>
            <span className="font-bold flex-1" style={{ color: "var(--color-white)" }}>Wine / Proton Settings</span>
            <button onClick={onClose} style={{ color: "var(--color-text-muted)", fontSize: "18px" }}>✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative w-10 h-5 shrink-0">
                <input type="checkbox" className="sr-only" checked={cfg.enabled}
                  onChange={(e) => upd({ enabled: e.currentTarget.checked })} />
                <div className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: cfg.enabled ? "var(--color-accent-dark)" : "var(--color-panel-3)", border: "1px solid var(--color-border-strong)" }} />
                <div className="absolute top-0.5 rounded-full w-4 h-4 transition-transform"
                  style={{ background: "var(--color-white)", left: cfg.enabled ? "22px" : "2px", transition: "left 0.15s" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Run via Wine / Proton</p>
                <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>When disabled, games launch directly (use on Linux-native builds)</p>
              </div>
            </label>

            {cfg.enabled && (<>
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-muted)" }}>Runner type</p>
                <div className="flex gap-2">
                  {(["wine", "proton", "custom"] as const).map((r) => (
                    <button key={r} onClick={() => upd({ runner: r })}
                      className="flex-1 py-2 rounded text-xs font-semibold capitalize"
                      style={{
                        background: cfg.runner === r ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                        color: cfg.runner === r ? "var(--color-white)" : "var(--color-text-muted)",
                        border: `1px solid ${cfg.runner === r ? "var(--color-accent-mid)" : "var(--color-border-subtle)"}`,
                      }}>{r === "wine" ? "🍷 Wine" : r === "proton" ? "⚙ Proton" : "🔧 Custom"}</button>
                  ))}
                </div>
              </div>

              {detected.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>Detected on this system</p>
                  <div className="space-y-1">
                    {detected.map((d) => (
                      <button key={d.path}
                        onClick={() => upd({ runnerPath: d.path, runner: d.kind })}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-left"
                        style={{
                          background: cfg.runnerPath === d.path ? "var(--color-accent-deeper)" : "var(--color-panel-alt)",
                          border: `1px solid ${cfg.runnerPath === d.path ? "var(--color-accent-mid)" : "var(--color-border-subtle)"}`,
                          color: "var(--color-text)",
                        }}>
                        <span>{d.kind === "wine" ? "🍷" : "⚙"}</span>
                        <span className="font-semibold">{d.name}</span>
                        {d.flavor === "ge" && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "#3a2800", color: "var(--color-warning)" }}>
                            GE
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[10px] truncate max-w-[220px]" style={{ color: "var(--color-text-dim)" }}>{d.path}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {detecting && <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>Detecting runners…</p>}
              {!detecting && detected.length === 0 && (
                <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>No Wine or Proton installations detected automatically.</p>
              )}

              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                  {cfg.runner === "wine" ? "Wine executable path" : cfg.runner === "proton" ? "Proton executable path" : "Runner executable path"}
                </p>
                <input
                  placeholder={cfg.runner === "wine" ? "/usr/bin/wine" : cfg.runner === "proton" ? "/path/to/proton" : "/path/to/runner"}
                  value={cfg.runnerPath}
                  onInput={(e) => upd({ runnerPath: (e.target as HTMLInputElement).value })}
                  className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }} />
                <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                  Leave blank to use system-wide binary from PATH
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                  {cfg.runner === "proton" ? "Steam Compat Data Path (STEAM_COMPAT_DATA_PATH)" : "Wine Prefix (WINEPREFIX)"}
                </p>
                <input
                  placeholder={cfg.runner === "proton" ? "~/.steam/steam/steamapps/compatdata/custom" : "~/.wine"}
                  value={cfg.prefixPath}
                  onInput={(e) => upd({ prefixPath: (e.target as HTMLInputElement).value })}
                  className="w-full px-3 py-1.5 rounded text-xs font-mono outline-none"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }} />
                <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                  Leave blank to use the default prefix
                </p>
              </div>

              {cfg.runner === "proton" && (
                <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "#1a2636", border: "1px solid var(--color-panel-3)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                  <p className="font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Proton notes</p>
                  <p>The <code style={{ color: "var(--color-code-accent)" }}>proton</code> script requires <strong>python3</strong> and a Steam installation.</p>
                  <p>Set the data path to a folder that will hold the Proton prefix (Wine bottle) for your games.</p>
                </div>
              )}

              <div className="rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Wine Prefix Manager</p>
                  <button
                    onClick={refreshPrefixes}
                    className="ml-auto px-2 py-1 rounded text-[10px]"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                    disabled={prefixLoading}
                  >
                    Refresh
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPrefixPath}
                    onInput={(e) => setNewPrefixPath((e.target as HTMLInputElement).value)}
                    placeholder="New prefix path"
                    className="flex-1 px-2 py-1.5 rounded text-xs font-mono outline-none"
                    style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }}
                  />
                  <button
                    onClick={createPrefix}
                    disabled={toolBusy === "create" || !newPrefixPath.trim()}
                    className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                  >
                    Create
                  </button>
                </div>

                {prefixError && <p className="text-[10px]" style={{ color: "var(--color-danger)" }}>{prefixError}</p>}
                {prefixLoading && <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>Loading prefixes…</p>}

                <div className="space-y-2 max-h-56 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
                  {prefixes.length === 0 && !prefixLoading && (
                    <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>No Wine/Proton prefixes found.</p>
                  )}
                  {prefixes.map((pfx) => (
                    <div key={pfx.path} className="rounded p-2" style={{ background: "var(--color-bg-code)", border: "1px solid var(--color-border-soft)" }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold" style={{ color: "var(--color-text)" }}>{pfx.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-panel)", color: "var(--color-text-muted)" }}>{pfx.kind}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.has_dxvk ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.has_dxvk ? "var(--color-success)" : "var(--color-warning)" }}>
                          DXVK {pfx.has_dxvk ? "ok" : "missing"}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.has_vkd3d ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.has_vkd3d ? "var(--color-success)" : "var(--color-warning)" }}>
                          VKD3D {pfx.has_vkd3d ? "ok" : "missing"}
                        </span>
                      </div>
                      <p className="text-[9px] mt-1 font-mono break-all" style={{ color: "var(--color-text-dim)" }}>{pfx.path}</p>
                      <div className="mt-2 rounded px-2.5 py-2" style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border-subtle)" }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-semibold" style={{ color: pfx.media.likely_video_playback_issue ? "var(--color-warning)" : "var(--color-success)" }}>
                            {pfx.media.summary}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_media_foundation ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_media_foundation ? "var(--color-success)" : "var(--color-warning)" }}>
                            MF {pfx.media.has_media_foundation ? "ok" : "missing"}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_quartz ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_quartz ? "var(--color-success)" : "var(--color-warning)" }}>
                            Quartz {pfx.media.has_quartz ? "ok" : "missing"}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_wmp ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_wmp ? "var(--color-success)" : "var(--color-warning)" }}>
                            WMP {pfx.media.has_wmp ? "ok" : "missing"}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: pfx.media.has_lavfilters ? "var(--color-success-bg)" : "var(--color-warning-bg)", color: pfx.media.has_lavfilters ? "var(--color-success)" : "var(--color-warning)" }}>
                            LAV {pfx.media.has_lavfilters ? "ok" : "missing"}
                          </span>
                        </div>
                        {pfx.media.notes.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {pfx.media.notes.slice(0, 2).map((note) => (
                              <p key={note} className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                                {note}
                              </p>
                            ))}
                          </div>
                        )}
                        {pfx.media.recommended_verbs.length > 0 && (
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <span className="text-[9px]" style={{ color: "var(--color-text-dim)" }}>
                              Suggested fixes:
                            </span>
                            {pfx.media.recommended_verbs.map((verb) => (
                              <span key={verb} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-bg-deep)", color: "var(--color-accent-soft)", border: "1px solid var(--color-border-subtle)" }}>
                                {verb}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => installGraphics(pfx)}
                            disabled={toolBusy === `gfx:${pfx.path}` || (pfx.has_dxvk && pfx.has_vkd3d)}
                            className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}
                          >
                            Install DXVK/VKD3D
                          </button>
                          <button
                            onClick={() => installMediaFixes(pfx)}
                            disabled={!!mediaInstallPreview || pfx.media.recommended_verbs.length === 0}
                            className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-warning)" }}
                            title="Install recommended media/video playback fixes via winetricks"
                          >
                            Install media fixes
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1" style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
                          <span className="text-[9px] shrink-0" style={{ color: "var(--color-text-dim)" }}>Media presets:</span>
                          {mediaPlaybackPresets.map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => openMediaInstallPreview(pfx, preset.verbs, `Media preset: ${preset.label}`)}
                              disabled={!!mediaInstallPreview}
                              className="px-1.5 py-0.5 rounded text-[9px] disabled:opacity-40"
                              style={{ background: "var(--color-bg-code)", color: "var(--color-accent-soft)", border: "1px solid var(--color-border-subtle)" }}
                              title={`Preview / install: ${preset.verbs.join(", ")}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[9px] shrink-0" style={{ color: "var(--color-text-dim)" }}>Compatibility:</span>
                          {WINE_COMPATIBILITY_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => openMediaInstallPreview(pfx, preset.verbs, `${preset.title}`)}
                              disabled={!!mediaInstallPreview}
                              className="px-1.5 py-0.5 rounded text-[9px] disabled:opacity-40"
                              style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-subtle)" }}
                              title={`${preset.title} — ${preset.verbs.join(", ")}`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={selectedVerb}
                            onChange={(e) => setSelectedVerb((e.target as HTMLSelectElement).value)}
                            className="px-2 py-1 rounded text-[10px] outline-none"
                            style={{ background: "var(--color-panel-alt)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                          >
                            {winetricksVerbs.map((v) => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => runVerb(pfx)}
                            disabled={toolBusy === `verb:${pfx.path}`}
                            className="px-2.5 py-1 rounded text-[10px] disabled:opacity-40"
                            style={{ background: "var(--color-panel-3)", color: "var(--color-accent)" }}
                          >
                            Run Winetricks
                          </button>
                          <button
                            onClick={() => deletePrefix(pfx.path)}
                            disabled={toolBusy === `del:${pfx.path}`}
                            className="ml-auto px-2 py-1 rounded text-[10px] disabled:opacity-40"
                            style={{ background: "#3a2020", color: "var(--color-danger-soft)" }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {platform !== "windows" && (
                <div className="rounded-lg p-3 space-y-2.5" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                  <p className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Shader cache (DXVK / Steam)</p>
                  <p className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-dim)" }}>
                    Point at a Windows game executable. Optional Steam App ID adds Fossilize paths to discover and to the portable ZIP.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={shaderToolExe}
                      onInput={(e) => setShaderToolExe((e.target as HTMLInputElement).value)}
                      placeholder="Path to game.exe"
                      className="flex-1 px-2 py-1.5 rounded text-[10px] font-mono outline-none"
                      style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }}
                    />
                    <button
                      type="button"
                      onClick={() => void pickShaderToolExe()}
                      className="px-2.5 py-1.5 rounded text-[10px] shrink-0"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                    >
                      Browse…
                    </button>
                  </div>
                  <input
                    type="text"
                    value={shaderToolSteamId}
                    onInput={(e) => setShaderToolSteamId((e.target as HTMLInputElement).value)}
                    placeholder="Steam App ID (optional)"
                    className="w-full px-2 py-1.5 rounded text-[10px] font-mono outline-none"
                    style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-panel-3)" }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void discoverShaderToolCaches()}
                      disabled={shaderToolBusy}
                      className="px-2.5 py-1 rounded text-[10px] disabled:opacity-45"
                      style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                    >
                      {shaderToolBusy ? "Working…" : "Discover"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportShaderToolBundle()}
                      disabled={shaderToolBusy}
                      className="px-2.5 py-1 rounded text-[10px] disabled:opacity-45"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}
                    >
                      Export ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => void importShaderToolBundle()}
                      disabled={shaderToolBusy}
                      className="px-2.5 py-1 rounded text-[10px] disabled:opacity-45"
                      style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}
                    >
                      Import ZIP
                    </button>
                  </div>
                  {shaderToolDiscovery && (
                    <ul className="text-[10px] space-y-0.5 pl-3.5 list-disc" style={{ color: "var(--color-text-muted)" }}>
                      {buildShaderWarmupLines({
                        wineActive: true,
                        discovery: shaderToolDiscovery,
                      }).map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>)}
          </div>

          <div className="flex gap-2 justify-end px-5 py-3 border-t shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
            <button onClick={onClose}
              className="px-4 py-2 rounded text-sm"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Cancel</button>
            <button onClick={() => { onSave(cfg); onClose(); }}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Save</button>
          </div>
        </div>
      </div>
      {mediaInstallPreview !== null && (
        <MediaInstallPreviewModal
          isOpen
          onClose={() => setMediaInstallPreview(null)}
          prefixName={mediaInstallPreview.prefix.name}
          prefixPath={mediaInstallPreview.prefix.path}
          verbs={mediaInstallPreview.verbs}
          sourceLabel={mediaInstallPreview.sourceLabel}
          beforeMedia={mediaInstallPreview.prefix.media}
          onFinished={refreshPrefixes}
        />
      )}
    </>
  );
}
