import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "preact/hooks";
import { formatTime } from "../../lib/helpers";
import type { Game, GameCustomization, GameMetadata, SteamEntry } from "../../types";

export function SteamImportModal({ games, metadata, customizations, onImport, onClose }: {
  games: Game[];
  metadata: Record<string, GameMetadata>;
  customizations: Record<string, GameCustomization>;
  onImport: (matched: { path: string; addSecs: number }[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [steamEntries, setSteamEntries] = useState<SteamEntry[]>([]);
  const [error, setError] = useState("");
  const [matched, setMatched] = useState<{ path: string; name: string; steamName: string; addSecs: number; checked: boolean }[]>([]);

  const gamesBySteamAppId = useMemo(() => new Map(
    Object.entries(customizations)
      .map(([path, customization]) => [customization.steamAppId?.trim(), path] as const)
      .filter((entry): entry is [string, string] => !!entry[0]),
  ), [customizations]);

  useEffect(() => {
    invoke<SteamEntry[]>("import_steam_playtime")
      .then((entries) => {
        setSteamEntries(entries);
        // Try to fuzzy-match by name.
        const hits: typeof matched = [];
        for (const e of entries) {
          const byAppIdPath = gamesBySteamAppId.get(e.app_id.trim());
          if (byAppIdPath) {
            const game = games.find((entry) => entry.path === byAppIdPath);
            if (game) {
              hits.push({
                path: game.path,
                name: customizations[game.path]?.displayName ?? metadata[game.path]?.title ?? game.name,
                steamName: e.name,
                addSecs: e.played_minutes * 60,
                checked: true,
              });
              continue;
            }
          }

          const steamLower = e.name.toLowerCase();
          for (const g of games) {
            const gName = (customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name).toLowerCase();
            if (gName === steamLower || steamLower.includes(gName) || gName.includes(steamLower)) {
              hits.push({
                path: g.path,
                name: customizations[g.path]?.displayName ?? metadata[g.path]?.title ?? g.name,
                steamName: e.name,
                addSecs: e.played_minutes * 60,
                checked: true,
              });
              break;
            }
          }
        }
        setMatched(hits);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [customizations, games, gamesBySteamAppId, metadata]);

  const toggle = (path: string) =>
    setMatched((prev) => prev.map((m) => (m.path === path ? { ...m, checked: !m.checked } : m)));

  const handleApply = async () => {
    await onImport(matched.filter((m) => m.checked).map((m) => ({ path: m.path, addSecs: m.addSecs })));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "var(--color-panel-2)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--color-accent)">
              <path d="M12 2C6.48 2 2 6.48 2 12l5.84 2.41c.53-.32 1.14-.51 1.8-.51.07 0 .14 0 .21.01L12 10.5V10.42c0-2.52 2.04-4.58 4.56-4.58 2.52 0 4.56 2.04 4.56 4.58 0 2.52-2.04 4.56-4.56 4.56h-.1l-3.5 2.53c0 .06.01.12.01.18 0 1.89-1.53 3.42-3.42 3.42-1.67 0-3.07-1.2-3.36-2.79L2.17 14C3.14 18.55 7.15 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-base" style={{ color: "var(--color-white)" }}>Import Steam Playtime</h2>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Read playtime from Steam userdata/localconfig.vdf</p>
          </div>
          <button onClick={onClose} className="ml-auto text-xl" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {loading && (
            <div className="flex items-center justify-center h-24 gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent)" }} />
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>Reading Steam data…</span>
            </div>
          )}
          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && steamEntries.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              No Steam playtime data was found. Make sure Steam is installed and that this Steam account has recorded playtime for at least one launched title.
            </p>
          )}
          {!loading && !error && matched.length > 0 && (
            <div>
              <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
                Found {matched.length} matching game{matched.length !== 1 ? "s" : ""}. Select which to import:
              </p>
              <div className="space-y-2">
                {matched.map((m) => (
                  <label key={m.path} className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer"
                    style={{ background: "var(--color-panel-2)" }}>
                    <input type="checkbox" checked={m.checked} onChange={() => toggle(m.path)}
                      className="rounded" style={{ accentColor: "var(--color-accent)" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{m.name}</p>
                      <p className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                        Steam: "{m.steamName}" · {formatTime(m.addSecs)}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
          {!loading && !error && steamEntries.length > 0 && matched.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: "var(--color-text-muted)" }}>
              Found {steamEntries.length} Steam entries but none match your library by name.
            </p>
          )}
        </div>

        {!loading && matched.length > 0 && (
          <div className="flex gap-3 justify-end px-6 py-4 border-t shrink-0" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-4 py-2 rounded text-sm"
              style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>Cancel</button>
            <button onClick={handleApply}
              className="px-5 py-2 rounded text-sm font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
              Apply {matched.filter((m) => m.checked).length} import{matched.filter((m) => m.checked).length !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
