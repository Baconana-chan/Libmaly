import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { loadCache, saveCache } from "../../lib/appStorage";
import { SK_STEAM_PROFILE_REF, SK_STEAM_WEB_API_KEY } from "../../lib/constants";
import { normalizePathForMatch, formatTime } from "../../lib/helpers";
import type { Game, GameCustomization, SteamLibraryEntry, SteamOwnedGame } from "../../types";

export function SteamLibraryImportModal({ games, customizations, onImport, onClose }: {
  games: Game[];
  customizations: Record<string, GameCustomization>;
  onImport: (entries: SteamOwnedGame[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<SteamOwnedGame[]>([]);
  const [error, setError] = useState("");
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [steamApiKey, setSteamApiKey] = useState(() => loadCache(SK_STEAM_WEB_API_KEY, ""));
  const [steamProfileRef, setSteamProfileRef] = useState(() => loadCache(SK_STEAM_PROFILE_REF, ""));
  const [fetchingOwned, setFetchingOwned] = useState(false);

  const existingPaths = useMemo(
    () => new Set(games.map((g) => normalizePathForMatch(g.path))),
    [games],
  );

  const existingAppIds = useMemo(
    () => new Set(
      Object.values(customizations)
        .map((value) => value.steamAppId?.trim())
        .filter((value): value is string => !!value),
    ),
    [customizations],
  );

  const mergeEntries = useCallback((incoming: SteamOwnedGame[]) => {
    setEntries((prev) => {
      const byAppId = new Map(prev.map((entry) => [entry.app_id, entry]));
      for (const entry of incoming) {
        const previous = byAppId.get(entry.app_id);
        byAppId.set(entry.app_id, {
          ...previous,
          ...entry,
          name: entry.name || previous?.name || `App ${entry.app_id}`,
          played_minutes: entry.played_minutes ?? previous?.played_minutes ?? 0,
          installed: entry.installed || previous?.installed || false,
          install_dir: entry.install_dir ?? previous?.install_dir ?? null,
          library_dir: entry.library_dir ?? previous?.library_dir ?? null,
          manifest_path: entry.manifest_path ?? previous?.manifest_path ?? null,
          exe: entry.exe ?? previous?.exe ?? null,
        });
      }
      return Array.from(byAppId.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  useEffect(() => {
    invoke<SteamLibraryEntry[]>("import_steam_library")
      .then((found) => {
        const mapped = found.map<SteamOwnedGame>((entry) => ({
          app_id: entry.app_id,
          name: entry.name,
          played_minutes: 0,
          installed: true,
          install_dir: entry.install_dir,
          library_dir: entry.library_dir,
          manifest_path: entry.manifest_path,
          exe: entry.exe,
        }));
        mergeEntries(mapped);

        const nextChecked: Record<string, boolean> = {};
        for (const entry of mapped) {
          const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
          const existsByPath = !!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe));
          if (!existsByPath && !existingAppIds.has(entry.app_id)) {
            nextChecked[selectionKey] = true;
          }
        }
        setCheckedKeys((prev) => ({ ...nextChecked, ...prev }));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [existingAppIds, existingPaths, mergeEntries]);

  const fetchOwnedLibrary = async () => {
    const trimmedKey = steamApiKey.trim();
    const trimmedProfile = steamProfileRef.trim();
    if (!trimmedKey || !trimmedProfile) {
      setError("Enter both a Steam Web API key and a SteamID / profile URL first.");
      return;
    }

    setFetchingOwned(true);
    setError("");
    try {
      const owned = await invoke<SteamOwnedGame[]>("fetch_steam_owned_games", {
        apiKey: trimmedKey,
        profileRef: trimmedProfile,
      });
      saveCache(SK_STEAM_WEB_API_KEY, trimmedKey);
      saveCache(SK_STEAM_PROFILE_REF, trimmedProfile);
      mergeEntries(owned);
      setCheckedKeys((prev) => {
        const next = { ...prev };
        for (const entry of owned) {
          const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
          const existsByPath = !!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe));
          if (!existsByPath && !existingAppIds.has(entry.app_id) && !(selectionKey in next)) {
            next[selectionKey] = true;
          }
        }
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setFetchingOwned(false);
    }
  };

  const selected = entries.filter((entry) => {
    const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
    return !!checkedKeys[selectionKey];
  });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[760px] max-h-[82vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "var(--color-panel-2)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-accent)">
              <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import Steam Library & Owned Games</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Import installed Steam games from local manifests, and optionally fetch your owned Steam library via Web API for uninstalled titles.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          <div className="mb-4 rounded-lg p-3 space-y-3" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border)" }}>
            <div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-text-dim)" }}>Owned Library via Steam Web API</div>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Optional: enter a Steam Web API key plus your SteamID64, vanity name, or Steam Community profile URL to import titles you own but have not installed locally yet.
              </p>
            </div>
            <input
              type="password"
              value={steamApiKey}
              onChange={(e) => setSteamApiKey((e.target as HTMLInputElement).value)}
              placeholder="Steam Web API key"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            />
            <input
              type="text"
              value={steamProfileRef}
              onChange={(e) => setSteamProfileRef((e.target as HTMLInputElement).value)}
              placeholder="SteamID64, vanity name, or https://steamcommunity.com/id/..."
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", color: "var(--color-text)" }}
            />
            <button
              onClick={() => { void fetchOwnedLibrary(); }}
              disabled={fetchingOwned}
              className="w-full py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: "#16263c", color: "#9ed2ff", border: "1px solid #2f4f76" }}
            >
              {fetchingOwned ? "Loading owned Steam library..." : "Load Owned Steam Library"}
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Reading Steam manifests…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No Steam titles found yet. Local manifests will appear automatically, or you can fetch your owned library above.
            </p>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs mb-2" style={{ color: "var(--color-text-muted)" }}>
                {entries.length} Steam title{entries.length !== 1 ? "s" : ""} found.
              </p>
              {entries.map((entry) => {
                const selectionKey = entry.exe ? normalizePathForMatch(entry.exe) : `appid:${entry.app_id}`;
                const exists = (!!entry.exe && existingPaths.has(normalizePathForMatch(entry.exe))) || existingAppIds.has(entry.app_id);
                return (
                  <label key={entry.app_id} className="flex items-start gap-3 rounded-lg px-3 py-2 cursor-pointer"
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
                      <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{entry.name}</p>
                      <p className="text-[10px] break-all" style={{ color: "var(--color-text-dim)" }}>
                        AppID {entry.app_id}{entry.exe ? ` · ${entry.exe}` : " · not installed locally"}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                        {exists
                          ? "Already in your library"
                          : entry.installed
                            ? "Will be imported with Steam launch bridge enabled"
                            : "Will be imported as an uninstalled Steam title with an Install via Steam action"}
                      </p>
                      {entry.played_minutes > 0 && (
                        <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                          Steam playtime: {formatTime(entry.played_minutes * 60)}
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
              style={{ background: "#1a3050", color: "var(--color-accent)", border: "1px solid #2a5080" }}
            >
              Import {selected.length} Steam title{selected.length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
