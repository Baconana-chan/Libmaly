import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "preact/hooks";

interface FeedSource {
  url: string;
  name: string;
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

  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      setLoading(true);
      const allItems: RssItem[] = [];
      const feeds = appSettings.rssFeeds || defaultFeeds;

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
                <a href={item.link} target="_blank" rel="noreferrer" className="hover:underline flex-1" style={{ color: "var(--color-text)" }}>
                  {item.title}
                </a>
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
    </div>
  );
}

