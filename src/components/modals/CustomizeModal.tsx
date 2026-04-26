import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "preact/hooks";
import { GENERIC_EXE_NAMES } from "../../lib/constants";
import type {
  EmulatorProfile,
  Game,
  GameCustomization,
  GameMetadata,
  LaunchConfig,
  RunnerKind,
  RunnerOverrideConfig,
} from "../../types";

export function CustomizeModal({ game, meta, custom, platform, globalLaunchConfig, emulatorProfiles, onSave, onClose }: {
  game: Game; meta?: GameMetadata; custom: GameCustomization;
  platform: string;
  globalLaunchConfig: LaunchConfig;
  emulatorProfiles: EmulatorProfile[];
  onSave: (c: GameCustomization) => void; onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(custom.displayName ?? meta?.title ?? game.name);
  const [coverUrl, setCoverUrl] = useState(custom.coverUrl ?? "");
  const [bgUrl, setBgUrl] = useState(custom.backgroundUrl ?? "");
  const [logoUrl, setLogoUrl] = useState(custom.logoUrl ?? "");
  const [iconUrl, setIconUrl] = useState(custom.iconUrl ?? "");
  const [exeOverride, setExeOverride] = useState(custom.exeOverride ?? "");
  const [launchArgs, setLaunchArgs] = useState(custom.launchArgs ?? "");
  const [pinnedExes, setPinnedExes] = useState<{ name: string; path: string }[]>(custom.pinnedExes ?? []);
  const [siblingExes, setSiblingExes] = useState<string[]>([]);
  const [detectingExes, setDetectingExes] = useState(false);
  const [runnerOverrideEnabled, setRunnerOverrideEnabled] = useState(!!custom.runnerOverrideEnabled);
  const [runnerOverride, setRunnerOverride] = useState<RunnerOverrideConfig>(
    custom.runnerOverride ?? {
      runner: globalLaunchConfig.runner,
      runnerPath: globalLaunchConfig.runnerPath,
      prefixPath: globalLaunchConfig.prefixPath,
    }
  );
  const [detectedRunners, setDetectedRunners] = useState<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>([]);
  const [detectingRunners, setDetectingRunners] = useState(false);
  const [customTags, setCustomTags] = useState<string[]>(custom.customTags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [personalReview, setPersonalReview] = useState(custom.personalReview ?? "");
  const [manualDeveloper, setManualDeveloper] = useState(custom.manualDeveloper ?? meta?.developer ?? "");
  const [manualPublisher, setManualPublisher] = useState(custom.manualPublisher ?? meta?.publisher ?? "");
  const [manualGenres, setManualGenres] = useState(custom.manualGenres ?? (meta?.genres?.join(", ") ?? ""));
  const [manualReleaseDate, setManualReleaseDate] = useState(custom.manualReleaseDate ?? meta?.release_date ?? "");
  const [manualDescription, setManualDescription] = useState(custom.manualDescription ?? meta?.overview ?? "");

  const [mugenForceSingleCore, setMugenForceSingleCore] = useState(!!custom.mugenForceSingleCore);
  const [mugenDgVoodooFolder, setMugenDgVoodooFolder] = useState(custom.mugenDgVoodooFolder ?? "");
  const [mugenDetected, setMugenDetected] = useState<boolean | null>(null);
  const [dgVoodooWorking, setDgVoodooWorking] = useState(false);
  const [dgVoodooStatus, setDgVoodooStatus] = useState<string | null>(null);
  const [mugenLaaWorking, setMugenLaaWorking] = useState(false);
  const [mugenLaaEnabled, setMugenLaaEnabled] = useState<boolean | null>(null);
  const [mugenLaaStatus, setMugenLaaStatus] = useState<string | null>(null);
  const [sgdbSyncing, setSgdbSyncing] = useState(false);
  const [sgdbStatus, setSgdbStatus] = useState<string | null>(null);

  const [emuProfileId, setEmuProfileId] = useState(custom.emulatorProfileId ?? "");
  const [romPath, setRomPath] = useState(custom.romPath ?? "");

  const gameFolder = game.path.replace(/[\\/][^\\/]+$/, "");

  useEffect(() => {
    if (platform === "windows") return;
    setDetectingRunners(true);
    invoke<{ name: string; path: string; kind: RunnerKind; flavor?: string }[]>("detect_wine_runners")
      .then(setDetectedRunners)
      .catch(() => setDetectedRunners([]))
      .finally(() => setDetectingRunners(false));
  }, [platform]);

  useEffect(() => {
    invoke<boolean>("detect_mugen_game", { path: game.path })
      .then(setMugenDetected)
      .catch(() => setMugenDetected(false));
  }, [game.path]);

  useEffect(() => {
    if (platform !== "windows") {
      setMugenLaaEnabled(null);
      return;
    }
    invoke<boolean>("get_mugen_large_address_aware", { gamePath: game.path })
      .then(setMugenLaaEnabled)
      .catch(() => setMugenLaaEnabled(null));
  }, [game.path, platform]);

  const pickImage = async (setter: (s: string) => void) => {
    const sel = await open({
      multiple: false, directory: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setter(convertFileSrc(sel));
  };

  const pickExe = async () => {
    const sel = await open({
      multiple: false, directory: false,
      defaultPath: gameFolder,
      filters: [{ name: "Executable", extensions: ["exe", "sh", "bin", "app"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setExeOverride(sel);
  };

  const detectSiblings = async () => {
    setDetectingExes(true);
    try {
      const exes = await invoke<string[]>("list_executables_in_folder", {
        folder: gameFolder,
      });
      setSiblingExes(exes.filter((e) => e !== game.path));
    } catch {
      setSiblingExes([]);
    } finally {
      setDetectingExes(false);
    }
  };

  const pickDgVoodooFolder = async () => {
    const sel = await open({ multiple: false, directory: true }).catch(() => null);
    if (sel && typeof sel === "string") setMugenDgVoodooFolder(sel);
  };

  const pickRom = async () => {
    const sel = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "ROM", extensions: ["zip", "7z", "iso", "cue", "bin", "gba", "gb", "gbc", "nes", "sfc", "smc", "n64", "z64", "chd", "md", "gen", "nds", "3ds", "psx", "pbp"] }],
    }).catch(() => null);
    if (sel && typeof sel === "string") setRomPath(sel);
  };

  const syncSteamGridDbArtwork = async () => {
    setSgdbSyncing(true);
    setSgdbStatus(null);
    try {
      const key = await invoke<string>("get_api_key", { provider: "steamgriddb" }).catch(() => "");
      if (!key || !key.trim()) {
        setSgdbStatus("SteamGridDB API key is missing. Configure it in Settings > Sources & Accounts > Third-party API Keys.");
        return;
      }
      const result = await invoke<{
        gameName?: string;
        coverUrl?: string | null;
        heroUrl?: string | null;
        logoUrl?: string | null;
        iconUrl?: string | null;
      }>("fetch_steamgriddb_artwork", {
        query: (displayName || game.name || "").trim(),
        steamAppId: custom.steamAppId || null,
      });

      let applied = 0;
      if (result.coverUrl) {
        setCoverUrl(result.coverUrl);
        applied += 1;
      }
      if (result.heroUrl) {
        setBgUrl(result.heroUrl);
        applied += 1;
      }
      if (result.logoUrl) {
        setLogoUrl(result.logoUrl);
        applied += 1;
      }
      if (result.iconUrl) {
        setIconUrl(result.iconUrl);
        applied += 1;
      }

      if (applied === 0) {
        setSgdbStatus("SteamGridDB did not return usable artwork for this game.");
      } else {
        const matchedName = result.gameName ? ` (${result.gameName})` : "";
        setSgdbStatus(`Synced ${applied} artwork item(s) from SteamGridDB${matchedName}.`);
      }
    } catch (e) {
      setSgdbStatus(`Error: ${e}`);
    } finally {
      setSgdbSyncing(false);
    }
  };

  const applyDgVoodoo = async () => {
    if (!mugenDgVoodooFolder.trim()) { alert("Please select the dgVoodoo2 folder first."); return; }
    setDgVoodooWorking(true);
    setDgVoodooStatus(null);
    try {
      const copied = await invoke<string[]>("apply_dgvoodoo_wrapper", {
        gamePath: game.path,
        dgvoodooFolder: mugenDgVoodooFolder.trim(),
      });
      setDgVoodooStatus(`Applied: ${copied.join(", ")}`);
    } catch (e) {
      setDgVoodooStatus(`Error: ${e}`);
    } finally {
      setDgVoodooWorking(false);
    }
  };

  const removeDgVoodoo = async () => {
    setDgVoodooWorking(true);
    setDgVoodooStatus(null);
    try {
      const removed = await invoke<string[]>("remove_dgvoodoo_wrapper", { gamePath: game.path });
      setDgVoodooStatus(removed.length > 0 ? `Removed: ${removed.join(", ")}` : "No wrapper DLLs found in game folder.");
    } catch (e) {
      setDgVoodooStatus(`Error: ${e}`);
    } finally {
      setDgVoodooWorking(false);
    }
  };

  const setMugenLaa = async (enabled: boolean) => {
    if (platform !== "windows") return;
    setMugenLaaWorking(true);
    setMugenLaaStatus(null);
    try {
      const next = await invoke<boolean>("set_mugen_large_address_aware", {
        gamePath: game.path,
        enabled,
      });
      setMugenLaaEnabled(next);
      setMugenLaaStatus(next
        ? "LAA enabled: this executable can use up to 4 GB address space on 64-bit Windows."
        : "LAA disabled: executable reverted to default 2 GB address space flag.");
    } catch (e) {
      setMugenLaaStatus(`Error: ${e}`);
    } finally {
      setMugenLaaWorking(false);
    }
  };

  const doSave = () => {
    onSave({
      displayName: displayName.trim() || undefined,
      coverUrl: coverUrl.trim() || undefined,
      backgroundUrl: bgUrl.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
      iconUrl: iconUrl.trim() || undefined,
      exeOverride: exeOverride.trim() && exeOverride.trim() !== game.path ? exeOverride.trim() : undefined,
      launchArgs: launchArgs.trim() || undefined,
      pinnedExes: pinnedExes.length > 0 ? pinnedExes : undefined,
      runnerOverrideEnabled: platform !== "windows" && runnerOverrideEnabled ? true : undefined,
      runnerOverride: platform !== "windows" && runnerOverrideEnabled ? {
        runner: runnerOverride.runner,
        runnerPath: runnerOverride.runnerPath.trim(),
        prefixPath: runnerOverride.prefixPath.trim(),
      } : undefined,
      customTags: customTags.length > 0 ? customTags : undefined,
      personalReview: personalReview.trim() || undefined,
      manualDeveloper: manualDeveloper.trim() || undefined,
      manualPublisher: manualPublisher.trim() || undefined,
      manualGenres: manualGenres.trim() || undefined,
      manualReleaseDate: manualReleaseDate.trim() || undefined,
      manualDescription: manualDescription.trim() || undefined,
      mugenForceSingleCore: mugenForceSingleCore || undefined,
      mugenDgVoodooFolder: mugenDgVoodooFolder.trim() || undefined,
      emulatorProfileId: emuProfileId.trim() || undefined,
      romPath: romPath.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <span style={{ fontSize: "20px" }}>🎨</span>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Customise Game</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{game.name}</p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Display Name <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(used in list &amp; search)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" value={displayName}
                onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button
                title="Use the parent folder name as the game title"
                onClick={() => {
                  const folder = game.path.replace(/[\\/][^\\/]+$/, "");
                  const folderName = folder.replace(/\\/g, "/").split("/").pop() ?? folder;
                  setDisplayName(folderName);
                }}
                className="px-2.5 py-2 rounded text-xs shrink-0 flex items-center gap-1"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-accent-deep)"; e.currentTarget.style.color = "var(--color-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-panel-3)"; e.currentTarget.style.color = "var(--color-text-muted)"; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Folder
              </button>
            </div>
            {GENERIC_EXE_NAMES.has((game.path.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase()) && (
              <p className="mt-1 text-[10px]" style={{ color: "var(--color-warning)" }}>
                ⚠ Generic exe detected — folder name was used as the title automatically during scan.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
              Launch Executable
              <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}> (override scanned .exe)</span>
            </label>
            <div className="rounded px-3 py-2 mb-2 text-xs font-mono break-all"
              style={{ background: "var(--color-bg-code)", border: "1px solid var(--color-border-soft)", color: exeOverride ? "var(--color-warning)" : "var(--color-text-dim)" }}>
              {exeOverride || game.path}
              {exeOverride && (
                <span className="ml-2 font-sans"
                  style={{ color: "var(--color-text-dim)", fontSize: "10px" }}>
                  (override active)
                </span>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={pickExe}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-accent-deep)"; e.currentTarget.style.color = "var(--color-accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-panel-3)"; e.currentTarget.style.color = "var(--color-text)"; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Browse…
              </button>
              <button onClick={detectSiblings} disabled={detectingExes}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
                onMouseEnter={(e) => { if (!detectingExes) { e.currentTarget.style.background = "var(--color-accent-deep)"; e.currentTarget.style.color = "var(--color-accent)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--color-panel-3)"; e.currentTarget.style.color = "var(--color-text)"; }}>
                {detectingExes
                  ? <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>}
                Detect others…
              </button>
              {exeOverride && (
                <button onClick={() => { setExeOverride(""); setSiblingExes([]); }}
                  className="px-3 py-1.5 rounded text-xs shrink-0"
                  style={{ background: "transparent", color: "var(--color-danger)", border: "1px solid var(--color-danger-bg)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-danger-bg)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  title="Clear override — use the originally scanned exe">
                  ✕ Clear
                </button>
              )}
            </div>
            {siblingExes.length > 0 && (
              <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border-soft)" }}>
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text-dim)" }}>
                  Executables found in game folder — click to select
                </p>
                {siblingExes.map((exe) => {
                  const fname = exe.replace(/\\/g, "/").split("/").pop() ?? exe;
                  const isActive = exeOverride === exe;
                  return (
                    <button key={exe} onClick={() => setExeOverride(exe)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left"
                      style={{
                        background: isActive ? "var(--color-accent-deeper)" : "var(--color-panel-deep)",
                        color: isActive ? "var(--color-accent)" : "var(--color-text-muted)",
                        borderTop: "1px solid var(--color-border-soft)",
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-panel-alt)"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-panel-deep)"; }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                        stroke={isActive ? "var(--color-accent)" : "var(--color-text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 12h4" /><path d="M8 10v4" /><circle cx="17" cy="12" r="1" />
                      </svg>
                      <span className="font-mono flex-1 truncate">{fname}</span>
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
                {siblingExes.length === 0 && (
                  <p className="px-3 py-3 text-xs text-center" style={{ color: "var(--color-text-dim)", background: "var(--color-panel-deep)" }}>
                    No other executables found in this folder.
                  </p>
                )}
              </div>
            )}
            {!detectingExes && siblingExes.length === 0 && exeOverride === "" && (
              <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                By default the game launches the scanned .exe above. Use this to pick a different launcher in the same folder.
              </p>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
                Launch Arguments
              </label>
              <input type="text" placeholder="e.g. -fullscreen -w 1920" value={launchArgs}
                onInput={(e) => setLaunchArgs((e.target as HTMLInputElement).value)}
                className="w-full px-3 py-2 rounded text-sm outline-none font-mono"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
            </div>

            {platform !== "windows" && (
              <div className="mt-4 rounded-lg p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
                  <input
                    type="checkbox"
                    checked={runnerOverrideEnabled}
                    onChange={(e) => setRunnerOverrideEnabled(e.currentTarget.checked)}
                  />
                  Per-game runner override
                </label>
                {!runnerOverrideEnabled && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--color-text-dim)" }}>
                    Uses global Wine/Proton settings.
                  </p>
                )}

                {runnerOverrideEnabled && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      {(["wine", "proton", "custom"] as RunnerKind[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRunnerOverride((prev) => ({ ...prev, runner: r }))}
                          className="flex-1 py-1.5 rounded text-xs capitalize"
                          style={{
                            background: runnerOverride.runner === r ? "var(--color-accent-dark)" : "var(--color-panel-alt)",
                            color: runnerOverride.runner === r ? "var(--color-white)" : "var(--color-text-muted)",
                            border: `1px solid ${runnerOverride.runner === r ? "var(--color-accent-mid)" : "var(--color-border)"}`,
                          }}
                        >
                          {r === "wine" ? "Wine" : r === "proton" ? "Proton" : "Custom"}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      placeholder={runnerOverride.runner === "wine" ? "/usr/bin/wine" : runnerOverride.runner === "proton" ? "/path/to/proton" : "/path/to/runner"}
                      value={runnerOverride.runnerPath}
                      onInput={(e) => setRunnerOverride((prev) => ({ ...prev, runnerPath: (e.target as HTMLInputElement).value }))}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono outline-none"
                      style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    />
                    <input
                      type="text"
                      placeholder={runnerOverride.runner === "proton" ? "STEAM_COMPAT_DATA_PATH" : "WINEPREFIX"}
                      value={runnerOverride.prefixPath}
                      onInput={(e) => setRunnerOverride((prev) => ({ ...prev, prefixPath: (e.target as HTMLInputElement).value }))}
                      className="w-full px-2 py-1.5 rounded text-xs font-mono outline-none"
                      style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                    />
                    {detectedRunners.length > 0 && (
                      <div className="max-h-32 overflow-y-auto rounded border" style={{ borderColor: "var(--color-border)" }}>
                        {detectedRunners.map((d) => (
                          <button
                            key={d.path}
                            onClick={() =>
                              setRunnerOverride((prev) => ({
                                ...prev,
                                runnerPath: d.path,
                                runner: d.kind,
                              }))
                            }
                            className="w-full text-left px-2 py-1.5 text-[10px] border-b last:border-b-0 flex items-center gap-2"
                            style={{
                              background: runnerOverride.runnerPath === d.path ? "var(--color-accent-deeper)" : "var(--color-bg-code)",
                              borderColor: "var(--color-border-soft)",
                              color: runnerOverride.runnerPath === d.path ? "var(--color-accent)" : "var(--color-text-muted)",
                            }}
                          >
                            <span>{d.name}</span>
                            {d.flavor === "ge" && <span className="ml-auto text-[9px]" style={{ color: "var(--color-warning)" }}>GE</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {detectingRunners && <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>Detecting runners…</p>}
                    <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                      Tip: leave runner path empty with Custom to force direct launch for this game.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
                Pinned Executables <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(e.g. Server, Config)</span>
              </label>
              <div className="space-y-2">
                {pinnedExes.map((pe, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="text" placeholder="Label" value={pe.name}
                      onInput={(e) => {
                        const next = [...pinnedExes];
                        next[i].name = (e.target as HTMLInputElement).value;
                        setPinnedExes(next);
                      }}
                      className="w-1/3 px-2 py-1.5 rounded text-xs outline-none bg-[var(--color-panel-2)] border border-[var(--color-border)] text-[var(--color-text)]" />
                    <input type="text" placeholder="Exe path" value={pe.path} readOnly
                      className="flex-1 px-2 py-1.5 rounded text-[10px] outline-none bg-[var(--color-bg-code)] border border-[var(--color-border-soft)] text-[var(--color-text-muted)] font-mono break-all" />
                    <button onClick={() => setPinnedExes(pinnedExes.filter((_, idx) => idx !== i))}
                      className="px-2 rounded text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]" title="Remove pin">✕</button>
                  </div>
                ))}
              </div>
              <button
                onClick={async () => {
                  const sel = await open({ multiple: false, directory: false, defaultPath: gameFolder, filters: [{ name: "Executable", extensions: ["exe", "bat", "sh"] }] }).catch(() => null);
                  if (sel && typeof sel === "string") {
                    const fname = sel.replace(/\\/g, "/").split("/").pop() ?? "New Pin";
                    setPinnedExes([...pinnedExes, { name: fname, path: sel }]);
                  }
                }}
                className="mt-2 px-3 py-1.5 rounded text-xs" style={{ background: "var(--color-panel-3)", color: "var(--color-accent)", border: "1px dashed var(--color-border-strong)" }}>
                + Add pinned executable
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Custom Cover <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(thumbnail in sidebar)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="Paste URL or pick a file…" value={coverUrl}
                onInput={(e) => setCoverUrl((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button onClick={() => pickImage(setCoverUrl)}
                className="px-3 py-2 rounded text-xs shrink-0"
                style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Browse</button>
            </div>
            {coverUrl && (
              <img src={coverUrl} alt="" className="mt-2 rounded h-20 w-auto object-cover"
                style={{ border: "1px solid var(--color-border)", maxWidth: "100%" }} />
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Hero Background <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(banner on detail page)</span>
            </label>
            <div className="flex gap-2">
              <input type="text" placeholder="Paste URL or pick a file…" value={bgUrl}
                onInput={(e) => setBgUrl((e.target as HTMLInputElement).value)}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button onClick={() => pickImage(setBgUrl)}
                className="px-3 py-2 rounded text-xs shrink-0"
                style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Browse</button>
            </div>
            {bgUrl && (
              <img src={bgUrl} alt="" className="mt-2 rounded h-20 w-full object-cover"
                style={{ border: "1px solid var(--color-border)" }} />
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              SteamGridDB Artwork Sync <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(covers / heroes / logos / icons)</span>
            </label>
            <div className="rounded p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
              <p className="text-[10px] mb-2" style={{ color: "var(--color-text-dim)" }}>
                Uses your SteamGridDB API key from Settings and auto-applies the best matched artwork to this game.
              </p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={syncSteamGridDbArtwork}
                  disabled={sgdbSyncing}
                  className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
                  {sgdbSyncing ? "Syncing..." : "Sync from SteamGridDB"}
                </button>
                <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  Query: {(displayName || game.name || "").trim() || "(empty)"}
                </span>
              </div>
              {sgdbStatus && (
                <p className="mt-2 text-[10px]" style={{ color: sgdbStatus.startsWith("Error") ? "var(--color-danger)" : "var(--color-success, var(--color-accent))" }}>
                  {sgdbStatus}
                </p>
              )}
              {(logoUrl || iconUrl) && (
                <div className="mt-2 flex items-center gap-3 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  {logoUrl && (
                    <div className="flex items-center gap-1.5">
                      <span>Logo:</span>
                      <img src={logoUrl} alt="logo" className="h-6 max-w-[120px] object-contain" />
                    </div>
                  )}
                  {iconUrl && (
                    <div className="flex items-center gap-1.5">
                      <span>Icon:</span>
                      <img src={iconUrl} alt="icon" className="h-6 w-6 object-contain rounded" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Custom Tags <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(for organization & filtering)</span>
            </label>
            <div className="flex gap-2 mb-2">
              <input type="text" placeholder="Add a tag…" value={tagInput}
                onInput={(e) => setTagInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    setCustomTags([...customTags, tagInput.trim()]);
                    setTagInput("");
                  }
                }}
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              <button onClick={() => {
                if (tagInput.trim()) {
                  setCustomTags([...customTags, tagInput.trim()]);
                  setTagInput("");
                }
              }}
                className="px-3 py-2 rounded text-xs shrink-0"
                style={{ background: "var(--color-accent-dark)", color: "var(--color-white)", border: "1px solid var(--color-accent-mid)" }}>
                Add
              </button>
            </div>
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customTags.map((tag, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--color-accent-deeper)", color: "var(--color-accent)", border: "1px solid var(--color-accent-mid)" }}>
                    {tag}
                    <button onClick={() => setCustomTags(customTags.filter((_, idx) => idx !== i))}
                      className="hover:text-white transition-colors" title="Remove tag">×</button>
                  </span>
                ))}
              </div>
            )}
            {customTags.length === 0 && (
              <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                No custom tags yet. Add tags to organize and filter your games.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Personal Review <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(your thoughts & notes)</span>
            </label>
            <textarea
              placeholder="Write your personal review, thoughts, or notes about this game…"
              value={personalReview}
              onInput={(e) => setPersonalReview((e.target as HTMLTextAreaElement).value)}
              rows={4}
              className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
            />
            <p className="mt-1 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
              This review is stored locally and won't be shared.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Manual Metadata Overrides <span style={{ fontWeight: "normal", color: "var(--color-text-dim)" }}>(when scrapers don't work)</span>
            </label>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Developer</label>
                <input type="text" placeholder="e.g. Studio Name" value={manualDeveloper}
                  onInput={(e) => setManualDeveloper((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Publisher</label>
                <input type="text" placeholder="e.g. Publisher Name" value={manualPublisher}
                  onInput={(e) => setManualPublisher((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Genres <span style={{ fontWeight: "normal" }}>(comma-separated)</span></label>
                <input type="text" placeholder="e.g. RPG, Adventure, Open World" value={manualGenres}
                  onInput={(e) => setManualGenres((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Release Date</label>
                <input type="text" placeholder="e.g. 2024-01-15" value={manualReleaseDate}
                  onInput={(e) => setManualReleaseDate((e.target as HTMLInputElement).value)}
                  className="w-full px-3 py-2 rounded text-sm outline-none"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "var(--color-text-dim)" }}>Description</label>
                <textarea
                  placeholder="Game description or overview…"
                  value={manualDescription}
                  onInput={(e) => setManualDescription((e.target as HTMLTextAreaElement).value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
                  style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                />
              </div>
            </div>
            <p className="mt-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
              These fields override scraped metadata. Use when scrapers fail or for custom entries.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Emulator Launch
            </label>
            <div className="rounded p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
              <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--color-text-dim)" }}>
                Emulator Profile
              </label>
              <select
                value={emuProfileId}
                onChange={(e) => setEmuProfileId((e.target as HTMLSelectElement).value)}
                className="w-full px-3 py-2 rounded text-xs outline-none mb-2"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
              >
                <option value="">Disabled (launch executable directly)</option>
                {emulatorProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <label className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--color-text-dim)" }}>
                ROM File
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Path to ROM file..."
                  value={romPath}
                  onInput={(e) => setRomPath((e.target as HTMLInputElement).value)}
                  className="flex-1 px-3 py-2 rounded text-xs outline-none font-mono"
                  style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border-soft)" }}
                />
                <button onClick={pickRom}
                  className="px-2.5 py-2 rounded text-xs shrink-0"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
                  Browse
                </button>
              </div>
              <p className="mt-2 text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                Use an emulator profile to launch this entry as a ROM target instead of a direct executable.
              </p>
            </div>
          </div>

          {(mugenDetected === true || mugenForceSingleCore || !!mugenDgVoodooFolder) && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  MUGEN Engine Compatibility
                </label>
                {mugenDetected && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "var(--color-accent-deep)", color: "var(--color-accent)", border: "1px solid var(--color-accent)" }}>
                    MUGEN detected
                  </span>
                )}
              </div>

              <div className="rounded p-3 mb-2" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={mugenForceSingleCore}
                    onChange={(e) => setMugenForceSingleCore((e.target as HTMLInputElement).checked)}
                    className="mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs font-medium" style={{ color: "var(--color-text)" }}>
                      Force single-core CPU affinity
                    </span>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                      Pins the game process to CPU core 0 only. Prevents MUGEN from crashing on
                      multi-core systems (Windows only).
                    </p>
                  </div>
                </label>
              </div>

              <div className="rounded p-3 mb-2" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-text)" }}>
                  Large Address Aware (LAA) patch
                </p>
                <p className="text-[10px] mb-2" style={{ color: "var(--color-text-dim)" }}>
                  Sets IMAGE_FILE_LARGE_ADDRESS_AWARE in the .exe PE header. Useful for 32-bit MUGEN builds
                  with high-resolution sprites that may crash around character select because of memory limits.
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] px-2 py-0.5 rounded"
                    style={{
                      background: mugenLaaEnabled ? "var(--color-success-bg)" : "var(--color-panel-3)",
                      color: mugenLaaEnabled ? "var(--color-success)" : "var(--color-text-dim)",
                      border: "1px solid var(--color-border-soft)",
                    }}>
                    {mugenLaaEnabled ? "Enabled" : "Disabled"}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                    {platform === "windows" ? "Windows only" : "Unavailable on this platform"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setMugenLaa(true)} disabled={mugenLaaWorking || platform !== "windows"}
                    className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
                    {mugenLaaWorking ? "Working…" : "Enable LAA"}
                  </button>
                  <button onClick={() => setMugenLaa(false)} disabled={mugenLaaWorking || platform !== "windows"}
                    className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
                    Disable LAA
                  </button>
                </div>
                {mugenLaaStatus && (
                  <p className="mt-1.5 text-[10px]"
                    style={{ color: mugenLaaStatus.startsWith("Error") ? "var(--color-error)" : "var(--color-success, var(--color-accent))" }}>
                    {mugenLaaStatus}
                  </p>
                )}
              </div>

              <div className="rounded p-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-text)" }}>
                  dgVoodoo2 graphics wrapper
                </p>
                <p className="text-[10px] mb-2" style={{ color: "var(--color-text-dim)" }}>
                  Copies D3D8/D3D9/D3D11 compatibility DLLs into the game folder to fix
                  graphical glitches on modern Windows. Requires a dgVoodoo2 download.
                </p>
                <div className="flex gap-2 mb-2">
                  <input type="text" placeholder="Path to dgVoodoo2 folder…"
                    value={mugenDgVoodooFolder}
                    onInput={(e) => setMugenDgVoodooFolder((e.target as HTMLInputElement).value)}
                    className="flex-1 px-3 py-1.5 rounded text-xs outline-none font-mono"
                    style={{ background: "var(--color-bg-code)", color: "var(--color-text)", border: "1px solid var(--color-border-soft)" }} />
                  <button onClick={pickDgVoodooFolder}
                    className="px-2.5 py-1.5 rounded text-xs shrink-0"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}>
                    Browse
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={applyDgVoodoo} disabled={dgVoodooWorking}
                    className="px-3 py-1.5 rounded text-xs font-medium"
                    style={{ background: "var(--color-accent-dark)", color: "var(--color-white)", opacity: dgVoodooWorking ? 0.5 : 1 }}>
                    {dgVoodooWorking ? "Working…" : "Apply wrapper"}
                  </button>
                  <button onClick={removeDgVoodoo} disabled={dgVoodooWorking}
                    className="px-3 py-1.5 rounded text-xs"
                    style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)", opacity: dgVoodooWorking ? 0.5 : 1 }}>
                    Remove wrapper
                  </button>
                </div>
                {dgVoodooStatus && (
                  <p className="mt-1.5 text-[10px]"
                    style={{ color: dgVoodooStatus.startsWith("Error") ? "var(--color-error)" : "var(--color-success, var(--color-accent))" }}>
                    {dgVoodooStatus}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 pb-5">
          <button onClick={() => { onSave({}); onClose(); }}
            className="px-4 py-2 rounded text-xs"
            style={{ background: "transparent", color: "var(--color-text-dim)", border: "1px solid var(--color-panel-3)" }}>
            Reset to defaults
          </button>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded text-sm"
              style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button onClick={doSave}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
