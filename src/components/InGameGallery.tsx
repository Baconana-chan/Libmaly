import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo, useState } from "preact/hooks";

interface ScreenshotItem {
  path: string;
  filename: string;
  tags: string[];
}

export function InGameGallery({
  shots,
  onTake,
  onOpenFolder,
  onExportZip,
  onUpdateTags,
}: {
  shots: ScreenshotItem[];
  onTake: () => void;
  onOpenFolder: () => void;
  onExportZip: () => void;
  onUpdateTags: (filename: string, tags: string[]) => void;
}) {
  const [lightbox, setLightbox] = useState<ScreenshotItem | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  const filteredShots = activeTagFilter
    ? shots.filter((s) => s.tags?.includes(activeTagFilter))
    : shots;

  const allShotTags = useMemo(() => {
    const tags = new Set<string>();
    shots.forEach((s) => s.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [shots]);

  return (
    <section>
      <div className="flex flex-col gap-2 mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs uppercase tracking-widest flex-1" style={{ color: "var(--color-text-muted)" }}>
            In-Game Screenshots{" "}
            {shots.length > 0 && <span style={{ color: "var(--color-text-dim)" }}>({shots.length})</span>}
          </h2>
          <button
            onClick={onTake}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-accent-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-accent-deep)";
              e.currentTarget.style.color = "var(--color-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--color-panel-3)";
              e.currentTarget.style.color = "var(--color-text-muted)";
            }}
            title="Capture game window now (F12 hotkey works while game is running)"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Capture
          </button>
          <button
            onClick={onOpenFolder}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-accent-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--color-accent-deep)";
              e.currentTarget.style.color = "var(--color-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--color-panel-3)";
              e.currentTarget.style.color = "var(--color-text-muted)";
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Folder
          </button>
          <button
            onClick={onExportZip}
            disabled={shots.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-accent-muted)" }}
            onMouseEnter={(e) => {
              if (shots.length > 0) {
                e.currentTarget.style.background = "var(--color-accent-deep)";
                e.currentTarget.style.color = "var(--color-accent)";
              }
            }}
            onMouseLeave={(e) => {
              if (shots.length > 0) {
                e.currentTarget.style.background = "var(--color-panel-3)";
                e.currentTarget.style.color = "var(--color-text-muted)";
              }
            }}
            title="Export all screenshots to a zip archive"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export ZIP
          </button>
        </div>

        {allShotTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            <button
              onClick={() => setActiveTagFilter(null)}
              className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
              style={{
                background: !activeTagFilter ? "var(--color-border-strong)" : "#1a2734",
                color: !activeTagFilter ? "var(--color-white)" : "var(--color-text-muted)",
                border: "1px solid var(--color-panel-3)",
              }}
            >
              ALL
            </button>
            {allShotTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors uppercase tracking-tight"
                style={{
                  background: activeTagFilter === tag ? "var(--color-accent-dark)" : "#1a2734",
                  color: activeTagFilter === tag ? "var(--color-white)" : "#4cb5ff",
                  border: `1px solid ${activeTagFilter === tag ? "#3d8ee6" : "var(--color-panel-3)"}`,
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {shots.length === 0 ? (
        <div className="rounded px-3 py-4 text-center" style={{ background: "var(--color-bg-elev)", border: "1px dashed var(--color-panel-3)" }}>
          <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Press{" "}
            <kbd
              style={{
                background: "var(--color-panel-3)",
                color: "var(--color-text-muted)",
                padding: "1px 5px",
                borderRadius: "3px",
                fontSize: "10px",
              }}
            >
              F12
            </kbd>{" "}
            while a game is running, or click Capture above.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filteredShots.map((s) => (
            <button
              key={s.filename}
              onClick={() => setLightbox(s)}
              className="rounded overflow-hidden flex-shrink-0 relative group"
              style={{ width: "90px", height: "60px", background: "var(--color-bg-deep)" }}
            >
              <img src={convertFileSrc(s.path)} alt={s.filename} className="w-full h-full object-cover" style={{ display: "block" }} />
              {s.tags?.length > 0 && (
                <div className="absolute top-0 right-0 p-0.5 bg-black/60 rounded-bl">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="var(--color-accent)" stroke="var(--color-accent)" strokeWidth="1">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
          {filteredShots.length === 0 && (
            <div className="text-[10px] py-4 text-center w-full" style={{ color: "var(--color-text-dim)" }}>
              No shots match the selected tag.
            </div>
          )}
        </div>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.92)" }}
          onClick={() => setLightbox(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="relative flex flex-col items-center max-w-full max-h-full">
            <div className="relative">
              <img
                src={convertFileSrc(lightbox.path)}
                alt={lightbox.filename}
                style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", display: "block" }}
                className="rounded shadow-2xl"
              />
            </div>

            <div className="w-full max-w-[90vw] mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono" style={{ color: "var(--color-accent-soft)" }}>
                  {lightbox.filename}
                </span>
                <button
                  onClick={() => setLightbox(null)}
                  className="text-xs px-4 py-1.5 rounded font-semibold transition-colors"
                  style={{ background: "var(--color-border)", color: "var(--color-white)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border-strong)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-border)")}
                >
                  CLOSE
                </button>
              </div>

              <div className="bg-[var(--color-bg-elev)] p-3 rounded-lg border border-[var(--color-panel-3)]">
                <div className="flex items-center gap-2 mb-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--color-text-muted)" }}>
                    Labels / Tags
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 items-center">
                  {lightbox.tags?.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-text)] border border-[var(--color-border-strong)] group hover:border-[var(--color-accent)] cursor-default transition-colors"
                    >
                      {t}
                      <button
                        onClick={() => {
                          const next = lightbox.tags.filter((x) => x !== t);
                          onUpdateTags(lightbox.filename, next);
                          setLightbox({ ...lightbox, tags: next });
                        }}
                        className="hover:text-red-400 opacity-60 hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </span>
                  ))}

                  <input
                    type="text"
                    placeholder="Add label (Bug, Ending, Funny...)"
                    className="bg-transparent border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] text-[11px] px-2 py-0.5 rounded outline-none w-48 focus:w-64 focus:border-solid focus:border-[var(--color-accent)] focus:text-[var(--color-white)] transition-all"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = e.currentTarget.value.trim().toLowerCase();
                        if (val && !lightbox.tags?.includes(val)) {
                          const next = [...(lightbox.tags || []), val];
                          onUpdateTags(lightbox.filename, next);
                          setLightbox({ ...lightbox, tags: next });
                        }
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

