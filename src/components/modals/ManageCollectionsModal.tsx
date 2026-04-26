import { useState } from "preact/hooks";
import { COLLECTION_COLORS } from "../../lib/constants";
import type { Collection } from "../../types";

export function ManageCollectionsModal({ gamePath, displayTitle, collections, onToggle, onCreate, onClose }: {
  gamePath: string;
  displayTitle: string;
  collections: Collection[];
  onToggle: (collectionId: string, gamePath: string, add: boolean) => void;
  onCreate: (name: string, color: string) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLLECTION_COLORS[0]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim(), newColor);
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-xl shadow-2xl w-96 flex flex-col" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border-strong)", maxHeight: "72vh" }}>
        <div className="flex items-center gap-2 px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="font-bold flex-1 text-sm truncate" style={{ color: "var(--color-white)" }}>Collections — {displayTitle}</span>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: "var(--color-text-muted)" }}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
          {collections.length === 0 && !creating && (
            <p className="px-5 py-5 text-sm text-center" style={{ color: "var(--color-text-muted)" }}>No collections yet.</p>
          )}
          {collections.map((col) => {
            const inCol = col.gamePaths.includes(gamePath);
            return (
              <label key={col.id} className="flex items-center gap-3 px-5 py-2.5 cursor-pointer"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-subtle)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: col.color }} />
                <span className="flex-1 text-sm" style={{ color: "var(--color-text)" }}>{col.name}</span>
                <span className="text-[10px] mr-1" style={{ color: "var(--color-text-dim)" }}>{col.gamePaths.length}</span>
                <input type="checkbox" checked={inCol}
                  onChange={(e) => onToggle(col.id, gamePath, e.currentTarget.checked)}
                  style={{ accentColor: col.color, width: "14px", height: "14px", cursor: "pointer" }} />
              </label>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t shrink-0" style={{ borderColor: "var(--color-bg-deep)" }}>
          {creating ? (
            <div className="space-y-2">
              <input autoFocus placeholder="Collection name…" value={newName}
                onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setCreating(false); }}
                className="w-full px-3 py-1.5 rounded text-xs outline-none"
                style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }} />
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Color:</span>
                {COLLECTION_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewColor(c)}
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{
                      background: c, outline: newColor === c ? "2px solid var(--color-white)" : "none", outlineOffset: "1px",
                      transform: newColor === c ? "scale(1.25)" : "scale(1)", transition: "transform 0.1s"
                    }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleCreate}
                  className="flex-1 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Create</button>
                <button onClick={() => setCreating(false)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full py-1.5 rounded text-xs flex items-center justify-center gap-1.5"
              style={{ background: "var(--color-panel-alt)", color: "var(--color-text-muted)", border: "1px dashed var(--color-border-strong)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border-strong)"; e.currentTarget.style.color = "var(--color-text-muted)"; }}>
              + New Collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
