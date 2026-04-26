import { useState } from "preact/hooks";
import { formatTime } from "../../lib/helpers";
import type { SessionEntry, SessionMood } from "../../types";

export function SessionNoteModal({ session, gameName, onSave, onDismiss }: {
  session: SessionEntry;
  gameName: string;
  onSave: (note: string, mood: SessionMood) => void;
  onDismiss: () => void;
}) {
  const [note, setNote] = useState(session.note);
  const [mood, setMood] = useState<SessionMood>(session.mood || "chill");

  const moodStyles: Record<SessionMood, { label: string; color: string; bg: string }> = {
    hype: { label: "hype", color: "var(--color-warning)", bg: "var(--color-warning-bg)" },
    chill: { label: "chill", color: "var(--color-success)", bg: "var(--color-success-bg)" },
    chaos: { label: "chaos", color: "var(--color-danger)", bg: "var(--color-danger-bg)" },
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-end p-6"
      style={{ pointerEvents: "none" }}>
      <div className="rounded-xl shadow-2xl w-80"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          pointerEvents: "all",
          animation: "slideInUp 0.25s ease-out",
        }}>
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0"
            style={{ background: "var(--color-bg-overlay)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: "var(--color-white)" }}>Session complete</p>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {gameName} · {formatTime(session.duration)}
            </p>
          </div>
          <button onClick={onDismiss} style={{ color: "var(--color-text-dim)" }} className="text-sm">✕</button>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] mb-1.5" style={{ color: "var(--color-text-muted)" }}>Pick a session mood</p>
          <div className="flex gap-2 mb-3">
            {(Object.keys(moodStyles) as SessionMood[]).map((key) => {
              const m = moodStyles[key];
              const isActive = mood === key;
              return (
                <button
                  key={key}
                  onClick={() => setMood(key)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-semibold"
                  style={{
                    background: isActive ? m.bg : "var(--color-panel-2)",
                    color: isActive ? m.color : "var(--color-text-muted)",
                    border: `1px solid ${isActive ? m.color : "var(--color-border)"}`,
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] mb-1.5" style={{ color: "var(--color-text-muted)" }}>Add a session note (optional)</p>
          <textarea
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. finished chapter 3, found secret ending…"
            rows={2}
            className="w-full rounded px-2 py-1.5 text-xs resize-none"
            style={{
              background: "var(--color-bg-overlay)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          <div className="flex gap-2 justify-end mt-2">
            <button onClick={onDismiss} className="px-3 py-1 rounded text-xs"
              style={{ background: "transparent", color: "var(--color-text-dim)" }}>Skip</button>
            <button onClick={() => onSave(note.trim(), mood)}
              className="px-4 py-1 rounded text-xs font-semibold"
              style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
