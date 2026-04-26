import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

export function NotesModal({ displayTitle, initialNote, onSave, onClose }: {
  displayTitle: string;
  initialNote: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialNote);
  const [preview, setPreview] = useState(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    const t = setTimeout(() => saveRef.current(text), 600);
    return () => clearTimeout(t);
  }, [text]);

  const renderedHtml = useMemo(() => marked.parse(text || "") as string, [text]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) { onSave(text); onClose(); } }}>
      <div className="rounded-lg shadow-2xl flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", width: "760px", height: "76vh" }}>

        <div className="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="font-bold flex-1" style={{ color: "var(--color-white)" }}>Notes — {displayTitle}</span>
          <div className="flex rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
            <button onClick={() => setPreview(false)}
              className="px-3 py-1 text-xs"
              style={{ background: !preview ? "var(--color-accent-dark)" : "var(--color-panel-2)", color: !preview ? "var(--color-white)" : "var(--color-text-muted)" }}>
              Edit
            </button>
            <button onClick={() => setPreview(true)}
              className="px-3 py-1 text-xs"
              style={{ background: preview ? "var(--color-accent-dark)" : "var(--color-panel-2)", color: preview ? "var(--color-white)" : "var(--color-text-muted)" }}>
              Preview
            </button>
          </div>
          <button onClick={() => { onSave(text); onClose(); }}
            className="ml-1 text-xs px-3 py-1.5 rounded"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}>Close</button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {!preview ? (
            <textarea
              className="w-full h-full p-4 text-sm outline-none resize-none font-mono"
              style={{
                background: "var(--color-panel-deep)", color: "var(--color-text)",
                scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent",
                lineHeight: "1.65",
              }}
              placeholder={"# Game Notes\n\nWrite anything here — Markdown is supported.\n\n- Quest progress\n- Tips & secrets\n- Save locations\n"}
              value={text}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            />
          ) : (
            <div
              className="w-full h-full overflow-y-auto p-5 text-sm markdown-body"
              style={{ background: "var(--color-panel-deep)", color: "var(--color-text)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
              dangerouslySetInnerHTML={{ __html: renderedHtml || "<p style=\"opacity:0.3\">Nothing to preview yet.</p>" }}
            />
          )}
        </div>

        <div className="flex items-center px-5 py-2 shrink-0 border-t" style={{ borderColor: "var(--color-border-card)" }}>
          <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
            Supports Markdown · Auto-saved as you type · {text.length} chars
          </span>
        </div>
      </div>
    </div>
  );
}
