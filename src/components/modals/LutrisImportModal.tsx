import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "preact/hooks";
import { normalizePathForMatch } from "../../lib/helpers";
import type { Game, LutrisGameEntry } from "../../types";

export function LutrisImportModal({ games, onImport, onClose }: {
  games: Game[];
  onImport: (entries: LutrisGameEntry[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<{ entry: LutrisGameEntry; checked: boolean; exists: boolean }[]>([]);

  useEffect(() => {
    invoke<LutrisGameEntry[]>("import_lutris_games")
      .then((entries) => {
        const normalized = entries
          .filter((e) => !!e.exe)
          .map((e) => {
            const exists = games.some((g) => normalizePathForMatch(g.path) === normalizePathForMatch(e.exe));
            return { entry: e, checked: true, exists };
          });
        setRows(normalized);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [games]);

  const toggle = (exe: string) => {
    setRows((prev) =>
      prev.map((r) => (r.entry.exe === exe ? { ...r, checked: !r.checked } : r))
    );
  };

  const apply = async () => {
    await onImport(rows.filter((r) => r.checked).map((r) => r.entry));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.82)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-[680px] max-h-[82vh] flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <h2 className="font-bold text-sm" style={{ color: "var(--color-white)" }}>Import from Lutris</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm" style={{ color: "var(--color-text-dim)" }}>✕</button>
        </div>
        <div className="px-5 py-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Selected entries will be added to library (if missing) and receive per-game Wine/Proton override.
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
          {loading && <p style={{ color: "var(--color-text-muted)" }}>Reading Lutris database…</p>}
          {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p style={{ color: "var(--color-text-muted)" }}>No Lutris games found.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((r) => (
                <label key={r.entry.exe} className="block rounded p-2 cursor-pointer" style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={() => toggle(r.entry.exe)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{r.entry.name}</p>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: r.exists ? "var(--color-success-bg)" : "var(--color-panel)", color: r.exists ? "var(--color-success)" : "var(--color-text-muted)" }}>
                          {r.exists ? "Exists" : "New"}
                        </span>
                        {r.entry.runner && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--color-panel-3)", color: "var(--color-accent-soft)" }}>
                            {r.entry.runner}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5 break-all font-mono" style={{ color: "var(--color-text-dim)" }}>{r.entry.exe}</p>
                      {r.entry.prefix && (
                        <p className="text-[10px] mt-0.5 break-all font-mono" style={{ color: "var(--color-text-muted)" }}>prefix: {r.entry.prefix}</p>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        {!loading && rows.length > 0 && (
          <div className="flex gap-3 justify-end px-5 py-3 border-t" style={{ borderColor: "var(--color-border-card)" }}>
            <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
              Cancel
            </button>
            <button onClick={apply} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
              Apply {rows.filter((r) => r.checked).length}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
