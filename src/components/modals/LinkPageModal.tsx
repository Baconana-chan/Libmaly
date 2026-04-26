import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import type { AppSettings, GameMetadata, SearchResultItem } from "../../types";

export function LinkPageModal({
  gameName,
  gamePath,
  onClose,
  onFetched,
  f95LoggedIn,
  onOpenF95Login,
  ghostGames,
  appSettings,
  detectMetadataSourceFromUrl,
  metadataSourceLabel,
  invokeMetadataForUrl,
}: {
  gameName: string;
  gamePath: string;
  onClose: () => void;
  onFetched: (meta: GameMetadata) => void;
  f95LoggedIn: boolean;
  onOpenF95Login: () => void;
  ghostGames: Record<string, boolean>;
  appSettings: AppSettings;
  detectMetadataSourceFromUrl: (url: string) => string | null;
  metadataSourceLabel: (source?: string) => string;
  invokeMetadataForUrl: (url: string) => Promise<GameMetadata>;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<"all" | "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku">(appSettings.preferredMetadataSource || "all");
  const [selectedSearchEngine, setSelectedSearchEngine] = useState<"duckduckgo" | "google" | "bing" | "brave">(appSettings.preferredSearchEngine || "duckduckgo");

  const src = detectMetadataSourceFromUrl(url);

  const [suggestions, setSuggestions] = useState<SearchResultItem[] | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [query, setQuery] = useState(gameName);

  const fetchSuggestions = () => {
    setIsLoadingSuggestions(true);
    invoke<SearchResultItem[]>("search_suggest_links", { query, searchEngine: selectedSearchEngine })
      .then((res) => setSuggestions(res))
      .catch((e) => { console.error("suggestions err", e); setSuggestions([]); })
      .finally(() => setIsLoadingSuggestions(false));
  };

  useEffect(() => {
    fetchSuggestions();
    // eslint-disable-next-line
  }, [gameName, selectedSearchEngine]);

  const doFetch = async (targetUrl = url) => {
    if (!targetUrl) return;
    if (ghostGames[gamePath]) {
      setError("Ghost mode is enabled for this game - no network requests allowed.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const meta = await invokeMetadataForUrl(targetUrl.trim());
      onFetched(meta);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="rounded-lg p-6 w-[480px] shadow-2xl" style={{ background: "var(--color-panel)", border: "1px solid var(--color-border)" }}>
        <h2 className="text-lg font-bold mb-1" style={{ color: "var(--color-white)" }}>{t('game.link.title')}</h2>
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          {t('game.link.hint', { name: gameName })}
        </p>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Preferred source:</span>
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource((e.target as HTMLSelectElement).value as typeof selectedSource)}
            className="px-2 py-1 rounded text-xs outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
          >
            <option value="all">All</option>
            <option value="f95">F95zone</option>
            <option value="dlsite">DLsite</option>
            <option value="vndb">VNDB</option>
            <option value="mangagamer">MangaGamer</option>
            <option value="johren">Johren</option>
            <option value="fakku">FAKKU</option>
          </select>
          <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>Search engine:</span>
          <select
            value={selectedSearchEngine}
            onChange={(e) => setSelectedSearchEngine((e.target as HTMLSelectElement).value as typeof selectedSearchEngine)}
            className="px-2 py-1 rounded text-xs outline-none"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
          >
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="brave">Brave</option>
          </select>
        </div>
        <div className="flex gap-2 mb-4">
          {(["f95", "dlsite", "vndb", "mangagamer", "johren", "fakku"] as const).map((s) => (
            <span key={s} className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{
                background: src === s
                  ? (s === "f95"
                    ? "var(--color-warning)"
                    : s === "dlsite"
                      ? "var(--color-danger-strong)"
                      : s === "vndb"
                        ? "var(--color-accent-dark)"
                        : s === "mangagamer"
                          ? "#7c5cff"
                          : s === "johren"
                            ? "#5a6bff"
                            : "#da4c96")
                  : "var(--color-border-soft)",
                color: src === s ? (s === "f95" ? "var(--color-black-strong)" : "var(--color-white)") : "var(--color-text-muted)",
              }}>
              {metadataSourceLabel(s)}
            </span>
          ))}
        </div>
        <input type="text"
          placeholder={t('game.link.url_placeholder')}
          value={url}
          onInput={(e) => { setUrl((e.target as HTMLInputElement).value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && doFetch()}
          className="w-full px-3 py-2 rounded text-sm outline-none mb-3"
          style={{ background: "var(--color-panel-2)", color: "var(--color-text)", border: "1px solid var(--color-border)" }} />
        {src === "f95" && !f95LoggedIn && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded"
            style={{ background: "var(--color-warning-bg-2)", border: "1px solid var(--color-warning-border)" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span className="text-xs flex-1" style={{ color: "var(--color-warning)" }}>{t('game.link.f95_login_hint')}</span>
            <button onClick={onOpenF95Login} className="text-xs underline" style={{ color: "var(--color-warning)" }}>{t('settings.accounts.sign_in', { name: "" }).trim()}</button>
          </div>
        )}
        {!url && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] uppercase text-[var(--color-text-muted)] font-bold tracking-widest flex-1">{t('game.link.suggestions')}</p>
              <input type="text" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                className="bg-[var(--color-panel-2)] border border-[var(--color-border)] text-[11px] px-2 py-0.5 rounded outline-none text-[var(--color-text)]"
                placeholder={t('common.search')}
                onKeyDown={(e) => e.key === "Enter" && fetchSuggestions()} />
              <button onClick={fetchSuggestions} disabled={isLoadingSuggestions} className="bg-[var(--color-border)] hover:bg-[var(--color-border-strong)] text-[11px] px-2 py-0.5 rounded text-[var(--color-text)] disabled:opacity-50">
                {isLoadingSuggestions ? t('game.link.searching') : t('common.search')}
              </button>
            </div>
            {isLoadingSuggestions ? (
              <p className="text-xs text-[var(--color-text-muted)]">{t('game.link.searching')}</p>
            ) : suggestions && suggestions.length > 0 ? (
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {suggestions.map((s) => (
                  <div key={s.url} onClick={() => doFetch(s.url)}
                    className="group flex gap-3 p-2 rounded cursor-pointer transition-colors"
                    style={{ background: "var(--color-panel-2)", border: "1px solid var(--color-border-soft)" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--color-bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "var(--color-panel-2)"}>
                    {s.cover_url ? (
                      <img src={s.cover_url} alt="" className="w-10 h-10 object-cover rounded" />
                    ) : (
                      <div className="w-10 h-10 rounded flex items-center justify-center font-bold" style={{ background: "var(--color-panel)", color: "var(--color-accent)" }}>
                        {s.source[0]}
                      </div>
                    )}
                    <div className="flex flex-col flex-1 min-w-0 justify-center">
                      <p className="text-xs text-[var(--color-text)] truncate font-medium group-hover:text-[var(--color-white)]" title={s.title}>{s.title}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)] uppercase">{s.source}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : suggestions && suggestions.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">{t('game.link.no_suggestions')}</p>
            ) : null}
          </div>
        )}
        {error && <p className="text-xs mb-2" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3 justify-end mt-2">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-panel-2)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>{t('common.migration.cancel')}</button>
          <button onClick={() => doFetch()} disabled={loading || !url.trim()}
            className="px-5 py-2 rounded text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}>
            {loading
              ? <><span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />{t('game.link.fetching')}</>
              : t('game.link.fetch')}
          </button>
        </div>
      </div>
    </div>
  );
}
