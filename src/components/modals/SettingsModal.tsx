import { useMemo, useState } from "preact/hooks";
import { open } from "@tauri-apps/plugin-dialog";

interface Game { name: string; path: string; }

type RatingScale = "10" | "10_decimal" | "100" | "5_star" | "3_smiley";
interface AppSettingsLike {
  updateCheckerEnabled: boolean;
  sessionToastEnabled: boolean;
  trayTooltipEnabled: boolean;
  startupWithWindows: boolean;
  themeMode: "dark" | "light" | "oled";
  ratingScale: RatingScale;
  themeScheduleMode: "manual" | "os" | "time";
  dayThemeMode: "light" | "dark";
  nightThemeMode: "dark" | "oled";
  lightStartHour: number;
  darkStartHour: number;
  accentColor: string;
  blurNsfwContent: boolean;
  rssFeeds: { url: string; name: string; enabled?: boolean }[];
  metadataAutoRefetchDays: number;
  autoScreenshotInterval: number;
  saveBackupOnExit: boolean;
  bossKeyEnabled?: boolean;
  bossKeyCode?: number;
  bossKeyAction?: "hide" | "kill";
  bossKeyMuteSystem?: boolean;
  bossKeyFallbackUrl?: string;
}

function normalizePathForMatch(path: string) {
  return path.trim().replace(/\\/g, "/").toLowerCase();
}

function normalizePathNoCase(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function remapPathByRoot(path: string, oldRoot: string, newRoot: string): string | null {
  const src = normalizePathNoCase(path);
  const oldN = normalizePathNoCase(oldRoot);
  const newN = normalizePathNoCase(newRoot);
  const srcL = src.toLowerCase();
  const oldL = oldN.toLowerCase();
  if (!(srcL === oldL || srcL.startsWith(`${oldL}/`))) return null;
  const suffix = src.slice(oldN.length);
  const mappedUnix = `${newN}${suffix}`;
  const preferBackslash = newRoot.includes("\\") && !newRoot.includes("/");
  return preferBackslash ? mappedUnix.replace(/\//g, "\\") : mappedUnix;
}

function normalizeHexColor(input: string, fallback: string) {
  const x = (input || "").trim();
  const hex = x.startsWith("#") ? x : `#${x}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

function MigrationWizardModal({
  games,
  onApply,
  onClose,
}: {
  games: Game[];
  onApply: (oldRoot: string, newRoot: string) => Promise<number>;
  onClose: () => void;
}) {
  const [oldRoot, setOldRoot] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const matchedCount = useMemo(() => {
    if (!oldRoot.trim()) return 0;
    return games.filter((g) => remapPathByRoot(g.path, oldRoot, newRoot || oldRoot) !== null).length;
  }, [games, oldRoot, newRoot]);

  const pickFolder = async (mode: "old" | "new") => {
    const selected = await open({ directory: true, multiple: false }).catch(() => null);
    if (!selected || typeof selected !== "string") return;
    if (mode === "old") setOldRoot(selected);
    else setNewRoot(selected);
  };

  const apply = async () => {
    setError("");
    if (!oldRoot.trim() || !newRoot.trim()) {
      setError("Choose both old and new folders.");
      return;
    }
    if (normalizePathForMatch(oldRoot) === normalizePathForMatch(newRoot)) {
      setError("Old and new folder are the same.");
      return;
    }
    if (matchedCount === 0) {
      setError("No games found under the selected old folder.");
      return;
    }
    setWorking(true);
    try {
      const moved = await onApply(oldRoot, newRoot);
      alert(`Migration finished. Updated ${moved} game path(s).`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-xl shadow-2xl w-[640px] max-w-[92vw] max-h-[85vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Migration Wizard: Move Game Folder</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          <p>
            Use this after moving game files on disk. LIBMALY will rewrite internal paths and keep stats, metadata, notes, collections, history, and ratings.
          </p>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Old folder (before move)</label>
            <div className="flex gap-2">
              <input
                value={oldRoot}
                onInput={(e) => setOldRoot((e.target as HTMLInputElement).value)}
                placeholder="D:\\Games\\OldFolder"
                className="flex-1 px-2.5 py-2 rounded outline-none bg-transparent border text-sm"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
              />
              <button onClick={() => pickFolder("old")} className="px-3 py-2 rounded text-xs font-semibold"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>Browse</button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>New folder (after move)</label>
            <div className="flex gap-2">
              <input
                value={newRoot}
                onInput={(e) => setNewRoot((e.target as HTMLInputElement).value)}
                placeholder="E:\\Games\\NewFolder"
                className="flex-1 px-2.5 py-2 rounded outline-none bg-transparent border text-sm"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
              />
              <button onClick={() => pickFolder("new")} className="px-3 py-2 rounded text-xs font-semibold"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>Browse</button>
            </div>
          </div>
          <div className="rounded p-2.5" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
            <p style={{ color: "var(--color-text-muted)" }}>
              Matched games: <span style={{ color: "var(--color-accent)" }}>{matchedCount}</span>
            </p>
          </div>
          {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
            Cancel
          </button>
          <button onClick={apply} disabled={working} className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {working ? "Migrating..." : "Apply Migration"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({
  f95LoggedIn, dlsiteLoggedIn, fakkuLoggedIn, libraryFolders, syncState, platform, launchConfig,
  appUpdate, appSettings,
  defaultSettings,
  onF95Login, onF95Logout, onDLsiteLogin, onDLsiteLogout, onFakkuLogin, onFakkuLogout, onRemoveFolder,
  onRescanAll, onWineSettings, onSteamImport, onLutrisImport, onPlayniteImport, onGogImport, onAppUpdate, onSaveSettings, onOpenMigrationWizard, onClose,
  onExportCSV, onExportHTML, onExportCloudState, onImportCloudState, onBatchMetadataRefresh, batchRefreshStatus
}: {
  f95LoggedIn: boolean; dlsiteLoggedIn: boolean; fakkuLoggedIn: boolean; libraryFolders: { path: string }[]; syncState: string;
  platform: string; launchConfig: { enabled: boolean; runner: string };
  appUpdate: { version: string } | null; appSettings: AppSettingsLike;
  defaultSettings: AppSettingsLike;
  onF95Login: () => void; onF95Logout: () => void;
  onDLsiteLogin: () => void; onDLsiteLogout: () => void;
  onFakkuLogin: () => void; onFakkuLogout: () => void;
  onRemoveFolder: (p: string) => void;
  onRescanAll: () => void; onWineSettings: () => void; onSteamImport: () => void; onLutrisImport: () => void; onPlayniteImport: () => void; onGogImport: () => void;
  onAppUpdate: () => void; onSaveSettings: (s: AppSettingsLike) => void; onOpenMigrationWizard: () => void; onClose: () => void;
  onExportCSV: () => void; onExportHTML: () => void; onExportCloudState: () => void; onImportCloudState: () => void;
  onBatchMetadataRefresh: () => void;
  batchRefreshStatus: string | null;
}) {
  const [tab, setTab] = useState<"general" | "scanner" | "import" | "rss" | "wine">("general");
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "scanner", label: "Scanner" },
    { id: "import", label: "Import" },
    { id: "rss", label: "RSS Feeds" },
    ...(platform !== "windows" ? [{ id: "wine" as const, label: "Wine / Proton" }] : []),
  ];
  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: 480, maxHeight: "80vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--color-border-soft)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <h2 className="font-bold text-base flex-1" style={{ color: "var(--color-white)" }}>Settings</h2>
          <button onClick={onClose} style={{ color: "var(--color-text-dim)", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5 px-4 pt-3 flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-t text-xs font-medium"
              style={{
                background: tab === t.id ? "var(--color-bg-elev)" : "transparent",
                color: tab === t.id ? "var(--color-accent)" : "var(--color-text-dim)",
                borderBottom: tab === t.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          style={{ background: "var(--color-bg-elev)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>

          {tab === "general" && (
            <>
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>F95zone</h3>
                {f95LoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-warning)" }} />
                      <span className="text-sm" style={{ color: "var(--color-warning)" }}>Logged in</span>
                    </div>
                    <button onClick={onF95Logout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "var(--color-warning-bg)", color: "var(--color-warning)", border: "1px solid var(--color-warning-border)" }}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onF95Login(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "var(--color-panel)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                    </svg>
                    Sign in to F95zone
                  </button>
                )}
              </section>

              {/* DLsite */}
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>DLsite</h3>
                {dlsiteLoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-danger-strong)" }} />
                      <span className="text-sm" style={{ color: "var(--color-danger-strong)" }}>Logged in</span>
                    </div>
                    <button onClick={onDLsiteLogout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-strong)", border: "1px solid #6a2020" }}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onDLsiteLogin(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "var(--color-panel)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{ background: "var(--color-danger-strong)", color: "var(--color-white)" }}>DL</div>
                    Sign in to DLsite
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>age-gate bypass</span>
                  </button>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>FAKKU</h3>
                {fakkuLoggedIn ? (
                  <div className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "#da4c96" }} />
                      <span className="text-sm" style={{ color: "#da4c96" }}>Logged in</span>
                    </div>
                    <button onClick={onFakkuLogout}
                      className="text-xs px-3 py-1 rounded"
                      style={{ background: "#3b1f2f", color: "#da4c96", border: "1px solid #6a2d4b" }}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { onClose(); onFakkuLogin(); }}
                    className="w-full py-2 rounded-lg text-sm text-left px-3 flex items-center gap-2"
                    style={{ background: "var(--color-panel)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                    <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{ background: "#da4c96", color: "var(--color-white)" }}>FK</div>
                    Sign in to FAKKU
                    <span className="ml-auto text-[9px]" style={{ color: "var(--color-text-dim)" }}>age-check bypass</span>
                  </button>
                )}
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>System & Notifications</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.startupWithWindows}
                    onChange={(e) => onSaveSettings({ ...appSettings, startupWithWindows: e.currentTarget.checked })} />
                  Start minimized in tray with Windows
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.updateCheckerEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, updateCheckerEnabled: e.currentTarget.checked })} />
                  Check for game updates (F95/DLsite)
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.sessionToastEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, sessionToastEnabled: e.currentTarget.checked })} />
                  Show system notification on session end
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.trayTooltipEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, trayTooltipEnabled: e.currentTarget.checked })} />
                  Live session duration in tray tooltip
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  <input type="checkbox" checked={appSettings.blurNsfwContent}
                    onChange={(e) => onSaveSettings({ ...appSettings, blurNsfwContent: e.currentTarget.checked })} />
                  Blur adult/NSFW covers (Click to reveal)
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Rating scale
                  <select
                    value={appSettings.ratingScale}
                    onChange={(e) => onSaveSettings({ ...appSettings, ratingScale: (e.currentTarget.value as RatingScale) })}
                    className="ml-2 px-2 py-1 rounded text-xs outline-none"
                    style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                  >
                    <option value="10">10 Point (5/10)</option>
                    <option value="10_decimal">10 Point Decimal (5.5/10)</option>
                    <option value="100">100 Point (55/100)</option>
                    <option value="5_star">5 Star (3/5)</option>
                    <option value="3_smiley">3 Point Smiley</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title="Automatically take a screenshot while a game is running">
                  Auto-screenshot interval (mins)
                  <input type="number" min="0" className="w-12 px-1 py-1 bg-transparent border rounded outline-none text-center ml-2"
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    value={appSettings.autoScreenshotInterval || 0}
                    onChange={e => onSaveSettings({ ...appSettings, autoScreenshotInterval: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  <span className="text-[10px] ml-2" style={{ color: "var(--color-text-dim)" }}>(0 to disable)</span>
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title="Create a ZIP backup of detected save files when a game session ends">
                  <input
                    type="checkbox"
                    checked={appSettings.saveBackupOnExit}
                    onChange={(e) => onSaveSettings({ ...appSettings, saveBackupOnExit: e.currentTarget.checked })}
                  />
                  Backup save files automatically on game exit
                </label>
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Appearance</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Theme schedule
                  <select
                    className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                    style={{ borderColor: "var(--color-border)" }}
                    value={appSettings.themeScheduleMode || "manual"}
                    onChange={(e) => onSaveSettings({ ...appSettings, themeScheduleMode: e.currentTarget.value as "manual" | "os" | "time" })}
                  >
                    <option value="manual" style={{ background: "var(--color-panel-2)" }}>Manual</option>
                    <option value="os" style={{ background: "var(--color-panel-2)" }}>Follow OS</option>
                    <option value="time" style={{ background: "var(--color-panel-2)" }}>By Time</option>
                  </select>
                </label>
                {(appSettings.themeScheduleMode || "manual") === "manual" && (
                  <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    Theme
                    <select
                      className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                      style={{ borderColor: "var(--color-border)" }}
                      value={appSettings.themeMode || "dark"}
                      onChange={(e) => onSaveSettings({ ...appSettings, themeMode: e.currentTarget.value as "dark" | "light" | "oled" })}
                    >
                      <option value="dark" style={{ background: "var(--color-panel-2)" }}>Dark</option>
                      <option value="light" style={{ background: "var(--color-panel-2)" }}>Light</option>
                      <option value="oled" style={{ background: "var(--color-panel-2)" }}>OLED Black</option>
                    </select>
                  </label>
                )}
                {(appSettings.themeScheduleMode || "manual") === "time" && (
                  <>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      Day theme
                      <select
                        className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }}
                        value={appSettings.dayThemeMode || "light"}
                        onChange={(e) => onSaveSettings({ ...appSettings, dayThemeMode: e.currentTarget.value as "light" | "dark" })}
                      >
                        <option value="light" style={{ background: "var(--color-panel-2)" }}>Light</option>
                        <option value="dark" style={{ background: "var(--color-panel-2)" }}>Dark</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      Night theme
                      <select
                        className="ml-2 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }}
                        value={appSettings.nightThemeMode || "dark"}
                        onChange={(e) => onSaveSettings({ ...appSettings, nightThemeMode: e.currentTarget.value as "dark" | "oled" })}
                      >
                        <option value="dark" style={{ background: "var(--color-panel-2)" }}>Dark</option>
                        <option value="oled" style={{ background: "var(--color-panel-2)" }}>OLED Black</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      Light starts at
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="ml-2 w-14 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }}
                        value={Math.max(0, Math.min(23, appSettings.lightStartHour ?? defaultSettings.lightStartHour))}
                        onChange={(e) => onSaveSettings({ ...appSettings, lightStartHour: Math.max(0, Math.min(23, parseInt(e.currentTarget.value) || 0)) })}
                      />
                      <span className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>00-23</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      Dark starts at
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="ml-2 w-14 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }}
                        value={Math.max(0, Math.min(23, appSettings.darkStartHour ?? defaultSettings.darkStartHour))}
                        onChange={(e) => onSaveSettings({ ...appSettings, darkStartHour: Math.max(0, Math.min(23, parseInt(e.currentTarget.value) || 0)) })}
                      />
                      <span className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>00-23</span>
                    </label>
                  </>
                )}
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Accent color
                  <input
                    type="color"
                    className="ml-2 w-8 h-6 border rounded cursor-pointer"
                    style={{ borderColor: "var(--color-border)", background: "transparent" }}
                    value={normalizeHexColor(appSettings.accentColor || defaultSettings.accentColor, defaultSettings.accentColor)}
                    onChange={(e) => onSaveSettings({ ...appSettings, accentColor: e.currentTarget.value })}
                  />
                  <input
                    type="text"
                    className="ml-1 w-24 bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)] font-mono text-xs"
                    style={{ borderColor: "var(--color-border)" }}
                    value={normalizeHexColor(appSettings.accentColor || defaultSettings.accentColor, defaultSettings.accentColor)}
                    onChange={(e) => onSaveSettings({ ...appSettings, accentColor: normalizeHexColor(e.currentTarget.value, defaultSettings.accentColor) })}
                  />
                </label>
              </section>

              <section className="space-y-3 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Panic Button (Boss Key)</h3>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-muted)" }} title="Press a global hotkey to instantly hide the game and open something else.">
                  <input type="checkbox" checked={appSettings.bossKeyEnabled}
                    onChange={(e) => onSaveSettings({ ...appSettings, bossKeyEnabled: e.currentTarget.checked })} />
                  Enable Panic Button
                </label>
                {appSettings.bossKeyEnabled && (
                  <div className="pl-6 space-y-3 mt-2">
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      Hotkey:
                      <select value={appSettings.bossKeyCode || 0x7A}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyCode: parseInt(e.currentTarget.value) })}
                        className="bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]" style={{ borderColor: "var(--color-border)" }}>
                        {[...Array(11)].map((_, i) => (
                          <option key={i} value={0x70 + i} style={{ background: "var(--color-panel-2)" }}>F{i + 1}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      Action:
                      <select value={appSettings.bossKeyAction || "hide"}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyAction: e.currentTarget.value as "hide" | "kill" })}
                        className="bg-transparent border rounded px-2 py-1 outline-none text-[var(--color-text)]" style={{ borderColor: "var(--color-border)" }}>
                        <option value="hide" style={{ background: "var(--color-panel-2)" }}>Hide Window (Smooth, but audio keeps playing)</option>
                        <option value="kill" style={{ background: "var(--color-panel-2)" }}>Force Close Game (Stops audio instantly)</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      <input type="checkbox" checked={appSettings.bossKeyMuteSystem}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyMuteSystem: e.currentTarget.checked })} />
                      Also mute system volume (Shows Windows volume overlay)
                    </label>
                    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                      Fallback App / URL:
                      <input type="text" placeholder="e.g. notepad.exe or https://google.com" className="bg-transparent border rounded px-2 py-1 outline-none flex-1 text-[var(--color-text)]"
                        style={{ borderColor: "var(--color-border)" }} value={appSettings.bossKeyFallbackUrl || ""}
                        onChange={(e) => onSaveSettings({ ...appSettings, bossKeyFallbackUrl: e.currentTarget.value })} />
                    </label>
                  </div>
                )}
              </section>

              <section className="space-y-4 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Export Library</h3>
                <div className="flex gap-2">
                  <button onClick={onExportCSV} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>CSV Spreadsheet</button>
                  <button onClick={onExportHTML} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>HTML Webpage</button>
                </div>
                <div className="flex gap-2">
                  <button onClick={onExportCloudState} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>
                    Export Cloud JSON
                  </button>
                  <button onClick={onImportCloudState} className="flex-1 py-2 rounded text-xs font-semibold" style={{ background: "var(--color-panel-3)", color: "var(--color-text)" }}>
                    Import Cloud JSON
                  </button>
                </div>
                <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                  Includes library folders, games, stats, metadata, notes, collections, wishlist and related local state.
                </p>
              </section>

              <section className="space-y-2 mt-4 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Library Folders</h3>
                <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
                  {libraryFolders.length === 0 ? (
                    <p className="px-3 py-3 text-xs" style={{ color: "var(--color-text-dim)" }}>No folders added yet.</p>
                  ) : (
                    libraryFolders.map((f) => {
                      const label = f.path.replace(/\\/g, "/").split("/").pop() ?? f.path;
                      return (
                        <div key={f.path} className="flex items-center gap-2 px-3 py-2 border-b last:border-0"
                          style={{ borderColor: "var(--color-border-soft)" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span className="flex-1 text-xs truncate" style={{ color: "var(--color-text-muted)" }} title={f.path}>{label}</span>
                          <button onClick={() => onRemoveFolder(f.path)}
                            className="text-[11px] px-1.5 rounded"
                            style={{ color: "var(--color-text-dim)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-danger)")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-dim)")}>×</button>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {appUpdate && (
                <section className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Updates</h3>
                  <button onClick={() => { onClose(); onAppUpdate(); }}
                    className="w-full py-2 rounded-lg text-sm px-3 flex items-center gap-2 font-semibold"
                    style={{ background: "var(--color-success-bg)", color: "var(--color-success)", border: "1px solid var(--color-success-border)" }}>
                    ↑ v{appUpdate.version} available — click to install
                  </button>
                </section>
              )}
            </>
          )}

          {tab === "rss" && (
            <section className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>RSS Feeds</h3>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Track game updates and discovering new releases.</p>
              <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                VNDB feeds are provided via <span style={{ color: "var(--color-text-muted)" }}>vndb-rss</span> proxy endpoints.
              </p>

              <div className="space-y-2">
                {(appSettings.rssFeeds || defaultSettings.rssFeeds).map((feed, idx) => (
                  <div key={idx} className="flex gap-2 p-3 rounded" style={{ background: "var(--color-panel-alt)", border: "1px solid var(--color-border)" }}>
                    <div className="flex-1 space-y-2">
                      <label className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
                        <input
                          type="checkbox"
                          checked={feed.enabled !== false}
                          onChange={(e) => {
                            const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds)];
                            nextFeeds[idx] = { ...feed, enabled: e.currentTarget.checked };
                            onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                          }}
                        />
                        Enabled
                      </label>
                      <input type="text" value={feed.name} placeholder="Feed Name"
                        className="w-full bg-transparent text-sm font-semibold outline-none" style={{ color: "var(--color-text)" }}
                        onChange={(e) => {
                          const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds)];
                          nextFeeds[idx] = { ...feed, name: (e.target as HTMLInputElement).value };
                          onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                        }} />
                      <input type="text" value={feed.url} placeholder="Feed URL"
                        className="w-full bg-transparent text-xs w-full outline-none" style={{ color: "var(--color-text-muted)" }}
                        onChange={(e) => {
                          const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds)];
                          nextFeeds[idx] = { ...feed, url: (e.target as HTMLInputElement).value };
                          onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                        }} />
                    </div>
                    <button onClick={() => {
                      const nextFeeds = (appSettings.rssFeeds || defaultSettings.rssFeeds).filter((_, i) => i !== idx);
                      onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                    }}
                      className="text-[var(--color-danger)] hover:text-white mt-1" style={{ width: 24, height: 24 }}>✕</button>
                  </div>
                ))}

                <button onClick={() => {
                  const nextFeeds = [...(appSettings.rssFeeds || defaultSettings.rssFeeds), { name: "New Feed", url: "", enabled: true }];
                  onSaveSettings({ ...appSettings, rssFeeds: nextFeeds });
                }}
                  className="w-full py-2 flex items-center justify-center gap-2 rounded text-sm text-[var(--color-text)] hover:text-white"
                  style={{ border: "1px dashed var(--color-border)" }}>
                  + Add RSS Feed
                </button>
              </div>
            </section>
          )}

          {tab === "scanner" && (
            <section className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Library Scanner</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Force a full re-scan of all library folders. Use this if new games were added to the folders outside of LIBMALY, or if some entries are missing.
                </p>
                <button onClick={() => { onRescanAll(); onClose(); }}
                  disabled={syncState !== "idle"}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: "var(--color-border)", color: "var(--color-text)", border: "1px solid #3d7a9b" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Force Rescan All Folders
                </button>
                <button onClick={() => { onClose(); onOpenMigrationWizard(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h18" /><path d="M3 17h18" /><path d="M7 3l-4 4 4 4" /><path d="M17 13l4 4-4 4" />
                  </svg>
                  Move Game Folder (Migration Wizard)
                </button>
              </div>

              <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Metadata Refetch</h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Update metadata for all currently linked games (runs in the background).
                </p>
                <button onClick={onBatchMetadataRefresh} disabled={!!batchRefreshStatus}
                  className="w-full py-2.5 rounded text-sm font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)", border: "1px solid var(--color-accent-mid)" }}>
                  {batchRefreshStatus || "Refetch All Linked Games"}
                </button>
                <label className="flex items-center gap-2 text-sm mt-3" style={{ color: "var(--color-text-muted)" }}>
                  Auto-refetch metadata older than
                  <input type="number" min="0" className="w-12 px-1 py-1 bg-transparent border rounded outline-none text-center"
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                    value={appSettings.metadataAutoRefetchDays || 0}
                    onChange={e => onSaveSettings({ ...appSettings, metadataAutoRefetchDays: Math.max(0, parseInt(e.currentTarget.value) || 0) })} />
                  days (0 to disable)
                </label>
              </div>
            </section>
          )}

          {tab === "import" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Steam Playtime Import</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Read playtime data from Steam's <code style={{ color: "var(--color-code-accent)" }}>localconfig.vdf</code> and pre-fill hours for games that match titles in your library. Only overrides your tracked time if Steam's value is higher.
              </p>
              <button onClick={() => { onSteamImport(); onClose(); }}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: "#1a3050", color: "var(--color-accent)", border: "1px solid #2a5080" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e3a60")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#1a3050")}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
                </svg>
                Import from Steam…
              </button>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>Lutris Import</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Import Lutris game entries and apply their Wine prefix/runner as per-game override.
                </p>
                <button
                  onClick={() => { onLutrisImport(); onClose(); }}
                  className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{ background: "#2a1f3a", color: "#b08ee8", border: "1px solid #5a3a8a" }}
                >
                  Import from Lutris…
                </button>
              </div>

              <div className="pt-3 border-t" style={{ borderColor: "var(--color-border-soft)" }}>
                <h3 className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--color-text-dim)" }}>Playnite / GOG Galaxy</h3>
                <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Read installed games from existing launcher databases and merge them into your library.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { onPlayniteImport(); onClose(); }}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "#2a2440", color: "#bca8ff", border: "1px solid #4b3f79" }}
                  >
                    Import Playnite…
                  </button>
                  <button
                    onClick={() => { onGogImport(); onClose(); }}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "#1e293f", color: "#89c4ff", border: "1px solid #3a567d" }}
                  >
                    Import GOG Galaxy…
                  </button>
                </div>
              </div>
            </section>
          )}

          {tab === "wine" && platform !== "windows" && (
            <section className="space-y-3">
              <h3 className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Wine / Proton</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Configure the Wine or Proton runtime used to launch Windows games on Linux or macOS.
              </p>
              <button onClick={() => { onWineSettings(); onClose(); }}
                className="w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{
                  background: launchConfig.enabled ? "#2a1f3a" : "var(--color-panel)",
                  color: launchConfig.enabled ? "#b08ee8" : "var(--color-text-muted)",
                  border: `1px solid ${launchConfig.enabled ? "#5a3a8a" : "var(--color-border)"}`,
                }}>
                🍷 {launchConfig.enabled ? `${launchConfig.runner.charAt(0).toUpperCase() + launchConfig.runner.slice(1)} active — Change…` : "Configure Wine / Proton…"}
              </button>
            </section>
          )}
        </div>
      </div>
    </div >
  );
}

// ─── Version Timeline ─────────────────────────────────────────────────────────

// ─── Game Detail ──────────────────────────────────────────────────────────────

// ─── Main App ─────────────────────────────────────────────────────────────────

export { MigrationWizardModal, SettingsModal };
