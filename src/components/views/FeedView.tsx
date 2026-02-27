import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "preact/hooks";

interface FeedSource {
  url: string;
  name: string;
  enabled?: boolean;
}

interface AppSettingsLike {
  rssFeeds: FeedSource[];
}

interface WishlistItemLike {
  id: string;
}

interface ToggleWishlistPayload {
  id: string;
  title: string;
  source: string;
  releaseStatus: string;
}

interface RssItem {
  id: string;
  sourceName: string;
  title: string;
  link: string;
  pubDate: number;
  description: string;
}

interface GameMetadata {
  source: string;
  source_url: string;
  title?: string;
  version?: string;
  developer?: string;
  overview?: string;
  overview_html?: string;
  cover_url?: string;
  screenshots: string[];
  tags: string[];
  release_date?: string;
}

function detectMetadataSource(url: string): "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku" | null {
  const lower = url.toLowerCase();
  if (lower.includes("f95zone.to")) return "f95";
  if (lower.includes("dlsite.com")) return "dlsite";
  if (lower.includes("vndb.org")) return "vndb";
  if (lower.includes("mangagamer.com")) return "mangagamer";
  if (lower.includes("johren.net")) return "johren";
  if (lower.includes("fakku.net")) return "fakku";
  return null;
}

export function FeedView({
  appSettings,
  wishlist,
  defaultFeeds,
  onToggleWishlist,
}: {
  appSettings: AppSettingsLike;
  wishlist: WishlistItemLike[];
  defaultFeeds: FeedSource[];
  onToggleWishlist: (item: ToggleWishlistPayload) => void;
}) {
  const [items, setItems] = useState<RssItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewItem, setPreviewItem] = useState<RssItem | null>(null);
  const [previewMeta, setPreviewMeta] = useState<GameMetadata | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewShot, setPreviewShot] = useState(0);
  const [previewLightboxImage, setPreviewLightboxImage] = useState<string | null>(null);
  const previewReqIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      setLoading(true);
      const allItems: RssItem[] = [];
      const feeds = (appSettings.rssFeeds || defaultFeeds).filter((f) => f.enabled !== false);

      for (const feed of feeds) {
        if (!feed.url.trim()) continue;
        try {
          const xmlText = await invoke<string>("fetch_rss", { url: feed.url });
          const parser = new DOMParser();
          const doc = parser.parseFromString(xmlText, "text/xml");
          const itemNodes = doc.querySelectorAll("item");
          for (const node of itemNodes) {
            const title = node.querySelector("title")?.textContent || "No Title";
            const link = node.querySelector("link")?.textContent || "";
            const desc = node.querySelector("description")?.textContent || "";
            const pubDateStr = node.querySelector("pubDate")?.textContent;
            const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : 0;
            const guid = node.querySelector("guid")?.textContent || link || title;
            allItems.push({
              sourceName: feed.name || "Unknown Source",
              title,
              link,
              description: desc,
              pubDate,
              id: guid,
            });
          }
        } catch (e) {
          console.error("Failed to fetch RSS for", feed.name, e);
        }
      }
      if (!active) return;
      allItems.sort((a, b) => b.pubDate - a.pubDate);
      setItems(allItems);
      setLoading(false);
    };
    fetchAll();
    return () => {
      active = false;
    };
  }, [appSettings.rssFeeds, defaultFeeds]);

  const openInBrowser = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const openMetadataPreview = async (item: RssItem) => {
    setPreviewItem(item);
    setPreviewMeta(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewShot(0);

    const reqId = ++previewReqIdRef.current;
    const source = detectMetadataSource(item.link);
    if (!source) {
      setPreviewLoading(false);
      setPreviewError("In-app preview supports F95zone, DLsite, VNDB, MangaGamer, Johren and FAKKU links.");
      return;
    }

    const cmd =
      source === "f95" ? "fetch_f95_metadata"
        : source === "dlsite" ? "fetch_dlsite_metadata"
          : source === "vndb" ? "fetch_vndb_metadata"
            : source === "mangagamer" ? "fetch_mangagamer_metadata"
              : source === "johren" ? "fetch_johren_metadata"
                : "fetch_fakku_metadata";
    try {
      const meta = await invoke<GameMetadata>(cmd, { url: item.link });
      if (previewReqIdRef.current !== reqId) return;
      setPreviewMeta(meta);
    } catch (e: any) {
      if (previewReqIdRef.current !== reqId) return;
      setPreviewError(e?.toString?.() || "Failed to load metadata.");
    } finally {
      if (previewReqIdRef.current === reqId) setPreviewLoading(false);
    }
  };

  useEffect(() => {
    const shotCount = previewMeta?.screenshots?.length || 0;
    if (previewShot >= shotCount) setPreviewShot(0);
  }, [previewMeta, previewShot]);

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold mb-8" style={{ color: "var(--color-white)", textShadow: "0 2px 8px rgba(0,0,0,.9)" }}>
          News &amp; Updates
        </h1>
        {loading ? (
          <div className="flex justify-center p-12">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-center py-12" style={{ color: "var(--color-text-muted)" }}>
            No updates found in your configured feeds.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="p-5 rounded-lg text-left" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded" style={{ background: "var(--color-border)", color: "var(--color-accent)" }}>
                  {item.sourceName}
                </span>
                <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                  {item.pubDate > 0 ? new Date(item.pubDate).toLocaleString() : ""}
                </span>
              </div>
              <h2 className="text-lg font-bold mb-2 leading-tight flex items-start justify-between gap-4">
                <button
                  onClick={() => void openMetadataPreview(item)}
                  className="text-left hover:underline flex-1"
                  style={{ color: "var(--color-text)" }}
                >
                  {item.title}
                </button>
                <button
                  onClick={() => openInBrowser(item.link)}
                  className="flex-shrink-0 px-2 h-8 rounded text-xs transition-colors"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}
                  title="Open original page in browser"
                >
                  Open
                </button>
                <button
                  onClick={() => {
                    const statusMatch = item.title.match(/\[(Completed|Abandoned|On Hold|WIP|Alpha|Beta|Demo|Early Access)[^\]]*\]/i);
                    const releaseStatus = statusMatch ? statusMatch[1] : "Unknown";
                    onToggleWishlist({
                      id: item.link || item.id,
                      title: item.title,
                      source: item.sourceName,
                      releaseStatus,
                    });
                  }}
                  className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
                  style={{
                    background: wishlist.some((w) => w.id === (item.link || item.id)) ? "#1a2c1a" : "var(--color-panel-3)",
                    color: wishlist.some((w) => w.id === (item.link || item.id)) ? "var(--color-success)" : "var(--color-text-muted)",
                  }}
                  title={wishlist.some((w) => w.id === (item.link || item.id)) ? "Remove from wishlist" : "Add to wishlist"}
                >
                  {wishlist.some((w) => w.id === (item.link || item.id)) ? "★" : "+"}
                </button>
              </h2>
              <div
                className="text-sm prose prose-invert max-w-none opacity-80"
                style={{ color: "var(--color-text-muted)" }}
                dangerouslySetInnerHTML={{ __html: item.description }}
              />
            </div>
          ))
        )}
      </div>

      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.82)" }} onClick={() => setPreviewItem(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-lg p-5"
            style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", scrollbarWidth: "thin", scrollbarColor: "var(--color-border) transparent" }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-[11px] uppercase font-bold tracking-wider mb-1" style={{ color: "var(--color-text-muted)" }}>
                  News Preview
                </p>
                <h3 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>
                  {previewMeta?.title || previewItem.title}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openInBrowser(previewItem.link)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-strong)" }}
                >
                  Open in Browser
                </button>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="px-3 py-1.5 rounded text-xs"
                  style={{ background: "var(--color-border)", color: "var(--color-text)" }}
                >
                  Close
                </button>
              </div>
            </div>

            {previewLoading ? (
              <div className="flex justify-center p-10">
                <div className="w-8 h-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
              </div>
            ) : previewError ? (
              <div className="rounded p-4 text-sm" style={{ background: "var(--color-bg-elev)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-soft)" }}>
                {previewError}
              </div>
            ) : previewMeta ? (
              <div className="space-y-4">
                {(previewMeta.cover_url || (previewMeta.screenshots?.length || 0) > 0) && (
                  <section>
                    <div className="rounded overflow-hidden mb-2" style={{ background: "var(--color-bg-deep)" }}>
                      <button
                        onClick={() => {
                          const active = previewMeta.screenshots?.[previewShot] || previewMeta.cover_url || null;
                          setPreviewLightboxImage(active);
                        }}
                        className="block w-full"
                        title="Open full size"
                      >
                        <img
                          src={previewMeta.screenshots?.[previewShot] || previewMeta.cover_url}
                          alt={previewMeta.title || "metadata preview"}
                          className="w-full object-contain"
                          style={{ maxHeight: "340px" }}
                        />
                      </button>
                    </div>
                    {(previewMeta.screenshots?.length || 0) > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {previewMeta.screenshots.map((shot, i) => (
                          <button
                            key={`${shot}-${i}`}
                            onClick={() => setPreviewShot(i)}
                            className="rounded overflow-hidden"
                            style={{ width: "90px", height: "58px", opacity: i === previewShot ? 1 : 0.55, outline: i === previewShot ? "2px solid var(--color-accent)" : "none" }}
                          >
                            <img src={shot} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {(previewMeta.overview_html || previewMeta.overview) && (
                  <section>
                    <h4 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
                      Overview
                    </h4>
                    {previewMeta.overview_html ? (
                      <div
                        className="text-sm leading-relaxed dlsite-overview"
                        style={{ color: "var(--color-text-soft)" }}
                        dangerouslySetInnerHTML={{ __html: previewMeta.overview_html }}
                      />
                    ) : (
                      <div className="text-sm leading-relaxed" style={{ color: "var(--color-text-soft)" }}>
                        {previewMeta.overview?.split("\n\n").map((para, i) => (
                          <p key={i} className={i > 0 ? "mt-3" : ""}>
                            {para}
                          </p>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div><span style={{ color: "var(--color-text-muted)" }}>Source:</span> <span style={{ color: "var(--color-text)" }}>{previewMeta.source.toUpperCase()}</span></div>
                  {previewMeta.developer && <div><span style={{ color: "var(--color-text-muted)" }}>Developer:</span> <span style={{ color: "var(--color-text)" }}>{previewMeta.developer}</span></div>}
                  {previewMeta.version && <div><span style={{ color: "var(--color-text-muted)" }}>Version:</span> <span style={{ color: "var(--color-text)" }}>{previewMeta.version}</span></div>}
                  {previewMeta.release_date && <div><span style={{ color: "var(--color-text-muted)" }}>Released:</span> <span style={{ color: "var(--color-text)" }}>{previewMeta.release_date}</span></div>}
                </section>

                {(previewMeta.tags?.length || 0) > 0 && (
                  <section>
                    <h4 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--color-text-muted)" }}>
                      Tags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {previewMeta.tags.map((tag) => (
                        <span key={tag} className="inline-block text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-border-soft)", color: "var(--color-accent-soft)", border: "1px solid #264d68" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div className="rounded p-4 text-sm" style={{ background: "var(--color-bg-elev)", color: "var(--color-text-muted)", border: "1px solid var(--color-border-soft)" }}>
                No metadata found.
              </div>
            )}
          </div>
        </div>
      )}

      {previewLightboxImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.92)" }} onClick={() => setPreviewLightboxImage(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative flex flex-col items-center max-w-full max-h-full">
            <img src={previewLightboxImage} alt="preview full" style={{ maxWidth: "92vw", maxHeight: "84vh", objectFit: "contain", display: "block" }} className="rounded shadow-2xl" />
            <button
              onClick={() => setPreviewLightboxImage(null)}
              className="mt-4 text-xs px-4 py-1.5 rounded font-semibold"
              style={{ background: "var(--color-border)", color: "var(--color-white)" }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

