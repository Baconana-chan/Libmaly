import { useEffect, useRef, useState } from "preact/hooks";
import { BUILTIN_MAP_PROVIDERS, type GameMapLink, type MapProvider, type MapProviderCategory } from "../../types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildUrl(template: string, identifier: string): string {
  if (!template || !identifier.trim()) return template;
  return template.replace(/\{title\}/g, encodeURIComponent(identifier.trim()));
}

function newId(): string {
  return `map_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const CATEGORY_LABELS: Record<MapProviderCategory, string> = {
  interactive: "🗺 Interactive",
  wiki:        "📖 Wiki",
  guide:       "📋 Guide",
  custom:      "🔗 Custom",
};

const CATEGORY_ORDER: MapProviderCategory[] = ["interactive", "wiki", "guide", "custom"];

// ─── component ───────────────────────────────────────────────────────────────

interface Props {
  displayTitle: string;
  mapLinks: GameMapLink[];
  extraProviders?: MapProvider[];
  onSave: (links: GameMapLink[]) => void;
  onClose: () => void;
}

export function GameMapsModal({ displayTitle, mapLinks, extraProviders = [], onSave, onClose }: Props) {
  const allProviders = [...BUILTIN_MAP_PROVIDERS, ...extraProviders];

  const [links, setLinks]                 = useState<GameMapLink[]>(mapLinks);
  const [selectedProviderId, setSelected] = useState<string>("mapgenie");
  const [identifier, setIdentifier]       = useState("");
  const [customUrl, setCustomUrl]         = useState("");
  const [label, setLabel]                 = useState("");
  const [addError, setAddError]           = useState("");

  const backdropRef = useRef<HTMLDivElement>(null);

  const selectedProvider = allProviders.find((p) => p.id === selectedProviderId);
  const isCustom         = selectedProviderId === "custom";
  const previewUrl       = isCustom ? customUrl : buildUrl(selectedProvider?.urlTemplate ?? "", identifier);

  // auto-fill label when provider or identifier changes
  useEffect(() => {
    if (!label || label.startsWith(selectedProvider?.name ?? "__")) {
      const base = isCustom ? "Custom" : (selectedProvider?.name ?? "");
      setLabel(identifier.trim() ? `${base} — ${identifier.trim()}` : base);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProviderId, identifier]);

  const handleAdd = () => {
    setAddError("");
    const resolvedUrl = isCustom ? customUrl.trim() : previewUrl;
    if (!resolvedUrl) { setAddError("Enter a URL or identifier."); return; }
    try { new URL(resolvedUrl); } catch {
      setAddError("That doesn't look like a valid URL.");
      return;
    }
    const newLink: GameMapLink = {
      id:         newId(),
      providerId: selectedProviderId,
      label:      label.trim() || (selectedProvider?.name ?? "Map"),
      url:        resolvedUrl,
      addedAt:    Date.now(),
    };
    const next = [...links, newLink];
    setLinks(next);
    onSave(next);
    // reset form
    setIdentifier("");
    setCustomUrl("");
    setLabel(selectedProvider?.name ?? "");
  };

  const handleRemove = (id: string) => {
    const next = links.filter((l) => l.id !== id);
    setLinks(next);
    onSave(next);
  };

  // group built-ins by category for the picker
  const byCategory = CATEGORY_ORDER.reduce<Record<string, MapProvider[]>>(
    (acc, cat) => {
      acc[cat] = allProviders.filter((p) => p.category === cat);
      return acc;
    },
    {} as Record<string, MapProvider[]>,
  );

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl flex flex-col"
        style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)", width: "680px", maxHeight: "88vh" }}
      >
        {/* header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 shrink-0 border-b" style={{ borderColor: "var(--color-border-card)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
            <line x1="9" y1="3" x2="9" y2="18" />
            <line x1="15" y1="6" x2="15" y2="21" />
          </svg>
          <span className="font-bold flex-1" style={{ color: "var(--color-white)" }}>Maps — {displayTitle}</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs"
            style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>

          {/* ── attached links ── */}
          <section>
            <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
              Attached maps ({links.length})
            </h2>
            {links.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>No maps linked yet. Add one below.</p>
            ) : (
              <div className="space-y-1.5">
                {links.map((link) => {
                  const prov = allProviders.find((p) => p.id === link.providerId);
                  return (
                    <div
                      key={link.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}
                    >
                      <span className="text-sm flex-shrink-0">🗺</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>{link.label}</p>
                        <p className="text-[10px] truncate" style={{ color: "var(--color-text-dim)" }}>{link.url}</p>
                      </div>
                      {prov && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                        >
                          {prov.name}
                        </span>
                      )}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-shrink-0 px-2 py-1 rounded text-[11px]"
                        style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                        title="Open in browser"
                      >
                        ↗
                      </a>
                      <button
                        onClick={() => handleRemove(link.id)}
                        className="flex-shrink-0 px-2 py-1 rounded text-[11px]"
                        style={{ background: "var(--color-panel-3)", color: "var(--color-danger)", border: "1px solid var(--color-border)" }}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── add a map link ── */}
          <section>
            <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>
              Add a map link
            </h2>

            {/* provider grid grouped by category */}
            <div className="space-y-3 mb-4">
              {CATEGORY_ORDER.map((cat) => {
                const providers = byCategory[cat];
                if (!providers || providers.length === 0) return null;
                return (
                  <div key={cat}>
                    <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--color-text-dim)" }}>
                      {CATEGORY_LABELS[cat]}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setSelected(p.id); setAddError(""); }}
                          className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
                          style={{
                            background: selectedProviderId === p.id ? "var(--color-accent-dark)" : "var(--color-panel-3)",
                            color:      selectedProviderId === p.id ? "var(--color-white)"       : "var(--color-text-muted)",
                            border:     `1px solid ${selectedProviderId === p.id ? "var(--color-accent)" : "var(--color-border-strong)"}`,
                          }}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* form */}
            <div
              className="rounded-lg p-4 space-y-3"
              style={{ background: "var(--color-bg-elev)", border: "1px solid var(--color-border-soft)" }}
            >
              {isCustom ? (
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>URL</label>
                  <input
                    type="url"
                    value={customUrl}
                    onInput={(e) => { setCustomUrl((e.target as HTMLInputElement).value); setAddError(""); }}
                    placeholder="https://example.com/game-name/maps"
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
                    Game identifier
                    <span className="ml-1 opacity-70">(replaces <code className="font-mono">{"{title}"}</code> in the template)</span>
                  </label>
                  <input
                    type="text"
                    value={identifier}
                    onInput={(e) => { setIdentifier((e.target as HTMLInputElement).value); setAddError(""); }}
                    placeholder={`e.g. ${displayTitle.toLowerCase().replace(/\s+/g, "-")}`}
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                  />
                  {previewUrl && (
                    <p className="mt-1 text-[10px] font-mono break-all" style={{ color: "var(--color-text-dim)" }}>
                      → {previewUrl}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Label</label>
                <input
                  type="text"
                  value={label}
                  onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
                  placeholder="e.g. MapGenie — Elden Ring"
                  className="w-full rounded px-3 py-1.5 text-xs outline-none"
                  style={{ background: "var(--color-bg)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                />
              </div>

              {addError && (
                <p className="text-xs" style={{ color: "var(--color-danger)" }}>{addError}</p>
              )}

              <div className="flex items-center justify-between">
                <div />
                <button
                  type="button"
                  onClick={handleAdd}
                  className="px-4 py-1.5 rounded text-xs font-semibold"
                  style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
                >
                  Add link
                </button>
              </div>
            </div>
          </section>

          {/* ── usage hint ── */}
          <p className="text-[11px]" style={{ color: "var(--color-text-dim)" }}>
            Linked maps open in your default browser. Use any provider above or paste a direct URL with "Custom URL".
          </p>
        </div>
      </div>
    </div>
  );
}
