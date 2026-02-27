import { useState, useEffect, useRef, useMemo } from "preact/hooks";

interface GameLite {
  name: string;
  path: string;
}

interface MetaLite {
  title?: string;
  developer?: string;
  cover_url?: string;
  tags?: string[];
}

export function CommandPalette({
  isOpen,
  onClose,
  games,
  metadata,
  notes,
  onSelect,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
}: {
  isOpen: boolean;
  onClose: () => void;
  games: GameLite[];
  metadata: Record<string, MetaLite>;
  notes: Record<string, string>;
  onSelect: (g: GameLite) => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return games
      .filter((g) => {
        if (g.name.toLowerCase().includes(q)) return true;
        const meta = metadata[g.path];
        if (meta) {
          if (meta.developer?.toLowerCase().includes(q)) return true;
          if (meta.tags?.some((t) => t.toLowerCase().includes(q))) return true;
        }
        if (notes[g.path]?.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 15);
  }, [games, metadata, notes, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[600px] rounded-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
      >
        <div
          className="flex items-center px-4 py-3 border-b"
          style={{ borderColor: "var(--color-border-soft)" }}
        >
          <button
            onClick={onBack}
            disabled={!canGoBack}
            className="w-7 h-7 rounded text-sm disabled:opacity-40"
            style={{ color: "var(--color-text-muted)" }}
            title="Back (Alt+Left)"
          >
            ←
          </button>
          <button
            onClick={onForward}
            disabled={!canGoForward}
            className="w-7 h-7 rounded text-sm disabled:opacity-40"
            style={{ color: "var(--color-text-muted)" }}
            title="Forward (Alt+Right)"
          >
            →
          </button>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent px-3 text-[15px] outline-none"
            style={{ color: "var(--color-white)" }}
            placeholder="Search games, tags, developers, notes... (Ctrl+K)"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
              }
              if (e.key === "Enter" && results.length > 0) {
                onSelect(results[0]);
                onClose();
              }
            }}
          />
        </div>
        {results.length > 0 && (
          <div
            className="py-2 max-h-[400px] overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
          >
            {results.map((g) => (
              <button
                key={g.path}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-border)] text-left transition-colors"
                onClick={() => {
                  onSelect(g);
                  onClose();
                }}
              >
                <div
                  className="w-8 h-8 rounded shrink-0 bg-[var(--color-bg-code)] border border-[var(--color-border-soft)] overflow-hidden flex items-center justify-center font-bold text-xs"
                  style={{ color: "var(--color-white)" }}
                >
                  {metadata[g.path]?.cover_url ? (
                    <img src={metadata[g.path].cover_url} className="w-full h-full object-cover" alt="" />
                  ) : (
                    g.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--color-text)" }}>
                    {metadata[g.path]?.title ?? g.name}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: "var(--color-text-muted)" }}>
                    {metadata[g.path]?.developer || "Unknown Developer"}
                    {metadata[g.path]?.tags?.length
                      ? ` · ${metadata[g.path]?.tags?.slice(0, 3).join(", ")}`
                      : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>
            No results found for "{query}"
          </div>
        )}
      </div>
    </div>
  );
}

