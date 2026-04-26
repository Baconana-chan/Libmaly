import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { normalizePathForMatch } from "../../lib/helpers";
import type { EpicLegendaryStatus, EpicOwnedGame, Game, GameCustomization } from "../../types";

export function EpicLegendaryImportModal({ games, customizations, onImport, onClose }: {
  games: Game[];
  customizations: Record<string, GameCustomization>;
  onImport: (entries: EpicOwnedGame[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<EpicLegendaryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [entries, setEntries] = useState<EpicOwnedGame[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const existingPaths = useMemo(
    () => new Set(games.map((g) => normalizePathForMatch(g.path))),
    [games],
  );

  const existingAppNames = useMemo(
    () => new Set(
      Object.values(customizations)
        .map((value) => value.epicAppName?.trim().toLowerCase())
        .filter((value): value is string => !!value),
    ),
    [customizations],
  );

  const loadLibrary = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const nextStatus = await invoke<EpicLegendaryStatus>("epic_legendary_status");
      setStatus(nextStatus);
      if (!nextStatus.available || !nextStatus.authenticated) {
        setEntries([]);
        if (nextStatus.lastError) setError(nextStatus.lastError);
        return;
      }

      const owned = await invoke<EpicOwnedGame[]>("fetch_epic_owned_games");
      setEntries(owned);
      setCheckedKeys((prev) => {
        const next = { ...prev };
        for (const entry of owned) {
          const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `epic:${entry.app_name.toLowerCase()}`;
          const existsByPath = !!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe));
          if (!existsByPath && !existingAppNames.has(entry.app_name.toLowerCase()) && !(selectionKey in next)) {
            next[selectionKey] = true;
          }
        }
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [existingAppNames, existingPaths]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const selected = entries.filter((entry) => {
    const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `epic:${entry.app_name.toLowerCase()}`;
    return !!checkedKeys[selectionKey];
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[780px] max-h-[84vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "#1d1f27" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f4f5f7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3h8l3 4v12l-7 2-7-2V7l3-4z" />
              <path d="M9.5 8h5" />
              <path d="M9.5 12h5" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import Epic Games Store Library</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Use Legendary to read your Epic ownership list, import installed games, and keep uninstalled titles as Legendary-backed placeholders.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          <div className="mb-4 rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Legendary Bridge</div>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Legendary is the bridge Libmaly uses for Epic ownership sync and authenticated launch. Installed entries get a direct Legendary launch bridge; uninstalled entries stay available as placeholders.
                </p>
              </div>
              <button
                onClick={() => { void loadLibrary(); }}
                disabled={refreshing}
                className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: "#222936", color: "#bfd2ff", border: "1px solid #46506a" }}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
              <div style={{ color: "var(--color-text)" }}>
                Status: {status?.available ? (status.authenticated ? `Signed in${status.displayName ? ` as ${status.displayName}` : ""}` : "Legendary found, login required") : "Legendary not found"}
              </div>
              {status?.version && <div style={{ color: "var(--color-text-dim)" }}>Version: {status.version}</div>}
              {status?.executablePath && (
                <div className="break-all" style={{ color: "var(--color-text-dim)" }}>Executable: {status.executablePath}</div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={async () => {
                  setAuthing(true);
                  setError("");
                  try {
                    await invoke("epic_legendary_auth");
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setAuthing(false);
                  }
                }}
                disabled={authing}
                className="px-3 py-2 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: "#2d2532", color: "#ffc2d5", border: "1px solid #7a4a5f" }}
              >
                {authing ? "Opening login..." : "Sign in with Legendary"}
              </button>
              <button
                onClick={() => { void openUrl(status?.installUrl || "https://github.com/derrod/legendary/releases/latest"); }}
                className="px-3 py-2 rounded text-xs font-semibold"
                style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                Install Legendary
              </button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Checking Legendary and loading Epic library…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && entries.length === 0 && status?.authenticated && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No Epic titles were returned by Legendary yet.
            </p>
          )}
          {!loading && entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
                {entries.length} Epic title{entries.length !== 1 ? "s" : ""} found.
              </p>
              {entries.map((entry) => {
                const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `epic:${entry.app_name.toLowerCase()}`;
                const exists = (!!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe))) || existingAppNames.has(entry.app_name.toLowerCase());
                return (
                  <label key={entry.app_name} className="flex items-start gap-3 rounded-lg px-3 py-2 cursor-pointer"
                    style={{ background: "var(--color-panel-2)", opacity: exists ? 0.65 : 1 }}>
                    <input
                      type="checkbox"
                      checked={!!checkedKeys[selectionKey]}
                      disabled={exists}
                      onChange={() => setCheckedKeys((prev) => ({ ...prev, [selectionKey]: !prev[selectionKey] }))}
                      className="mt-1 rounded"
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{entry.title}</p>
                      <p className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>
                        {entry.app_name}{entry.exe ? ` · ${entry.exe}` : " · not installed locally"}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                        {exists
                          ? "Already in your library"
                          : entry.installed
                            ? "Will be imported with Legendary launch enabled"
                            : "Will be imported as an uninstalled Epic title with an Install via Legendary action"}
                      </p>
                      {entry.version && (
                        <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                          Version: {entry.version}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {!loading && entries.length > 0 && (
          <div className="flex gap-3 justify-end px-6 py-4 border-t shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-4 py-2 rounded text-sm"
              style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button
              onClick={async () => {
                await onImport(selected);
                onClose();
              }}
              disabled={selected.length === 0}
              className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50"
              style={{ background: "#202630", color: "#f4f5f7", border: "1px solid #505766" }}
            >
              Import {selected.length} Epic title{selected.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
