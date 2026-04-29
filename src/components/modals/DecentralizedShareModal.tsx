/**
 * DecentralizedShareModal — publish game reviews, ratings & screenshots
 * to Nostr (BIP340 / WebSocket relays) and Mastodon/ActivityPub.
 *
 * Compose tab : game info fields, platform toggles, live preview, Publish button
 * Settings tab: Nostr relays, Mastodon instance + token, visibility
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import type { JSX } from "preact";
import {
  type DShareConfig,
  type DSharePost,
  type DShareResult,
  dshareGetConfig,
  dshareSaveConfig,
  dshareGetNostrPubkey,
  dsharePreviewContent,
  dsharePublish,
} from "../../lib/decentralizedShare";

// ── Style constants ───────────────────────────────────────────────────────────

const overlay: JSX.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9200,
  background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const dialog: JSX.CSSProperties = {
  background: "var(--color-panel)", border: "1px solid var(--color-border)",
  borderRadius: 14, width: "min(780px,95vw)", height: "min(660px,92vh)",
  display: "flex", flexDirection: "column", overflow: "hidden",
  boxShadow: "0 24px 80px rgba(0,0,0,.5)",
};

const topBar: JSX.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 18px", borderBottom: "1px solid var(--color-border)",
  flexShrink: 0, gap: 10,
};

const tabBar: JSX.CSSProperties = {
  display: "flex", padding: "0 18px",
  borderBottom: "1px solid var(--color-border)", flexShrink: 0, gap: 4,
};

const bodyScroll: JSX.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "18px 20px",
};

const fieldLabel: JSX.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)",
  marginBottom: 4, display: "block",
};

const inputStyle: JSX.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 13,
  background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
  borderRadius: 7, color: "var(--color-text)", outline: "none",
  boxSizing: "border-box",
};

const textAreaStyle: JSX.CSSProperties = {
  ...inputStyle, resize: "vertical", minHeight: 80, fontFamily: "inherit",
};

const btnBase: JSX.CSSProperties = {
  padding: "5px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
  border: "1px solid var(--color-border)", background: "var(--color-panel-2)",
  color: "var(--color-text)",
};

const btnAccent: JSX.CSSProperties = {
  padding: "7px 18px", fontSize: 13, borderRadius: 7, cursor: "pointer",
  border: "none", background: "var(--color-accent)", color: "#fff",
  fontWeight: 700,
};

const section: JSX.CSSProperties = { display: "flex", flexDirection: "column", gap: 14 };

const previewBox: JSX.CSSProperties = {
  background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
  borderRadius: 8, padding: "10px 12px", fontSize: 12,
  fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.6,
  color: "var(--color-text)", minHeight: 60,
};

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 14px", fontSize: 12, fontWeight: active ? 700 : 400,
        color: active ? "var(--color-accent)" : "var(--color-text-muted)",
        background: "none", border: "none", cursor: "pointer",
        borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

// ── Rating picker ─────────────────────────────────────────────────────────────

function RatingPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (r: number | null) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onClick={() => onChange(value === n ? null : n)}
          style={{
            width: 32, height: 32, borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: "pointer", border: "1px solid var(--color-border)",
            background: value === n ? "var(--color-accent)" : "var(--color-panel-2)",
            color: value === n ? "#fff" : "var(--color-text)",
          }}
        >
          {n}
        </button>
      ))}
      {value !== null && (
        <button
          onClick={() => onChange(null)}
          title="Clear rating"
          style={{ ...btnBase, padding: "0 8px", fontSize: 11 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ── Platform toggle ───────────────────────────────────────────────────────────

function PlatformToggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
        background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
        borderRadius: 8, padding: "10px 14px",
      }}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        style={{ marginTop: 2, accentColor: "var(--color-accent)" }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>{description}</div>
      </div>
    </label>
  );
}

// ── Relay list editor ─────────────────────────────────────────────────────────

function RelayListEditor({
  relays,
  onChange,
}: {
  relays: string[];
  onChange: (r: string[]) => void;
}) {
  const [newRelay, setNewRelay] = useState("");

  const add = () => {
    const url = newRelay.trim();
    if (url && !relays.includes(url)) {
      onChange([...relays, url]);
      setNewRelay("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {relays.map((r) => (
        <div key={r} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{
              flex: 1, fontSize: 12, fontFamily: "monospace",
              background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
              borderRadius: 6, padding: "5px 9px", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {r}
          </span>
          <button
            onClick={() => onChange(relays.filter((x) => x !== r))}
            style={{ ...btnBase, padding: "4px 8px", color: "var(--color-danger)", flexShrink: 0 }}
            title="Remove relay"
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          placeholder="wss://relay.example.com"
          value={newRelay}
          onChange={(e) => setNewRelay((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={{ ...inputStyle, flex: 1, fontSize: 12 }}
        />
        <button onClick={add} style={{ ...btnBase, flexShrink: 0 }}>
          Add
        </button>
      </div>
    </div>
  );
}

// ── Result banner ─────────────────────────────────────────────────────────────

function ResultBanner({ result }: { result: DShareResult }) {
  const nostrOk = result.nostrPublished;
  const mastodonOk = result.mastodonPublished;

  return (
    <div
      style={{
        background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
        borderRadius: 9, padding: "12px 14px", display: "flex",
        flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13 }}>Publish Results</div>

      {/* Nostr */}
      {(result.nostrRelayResults.length > 0 || result.nostrError) && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>
            Nostr {nostrOk ? "✅" : "❌"}
          </div>
          {result.nostrEventId && (
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--color-text-muted)", wordBreak: "break-all" }}>
              Event ID: {result.nostrEventId}
            </div>
          )}
          {result.nostrRelayResults.map((rr) => (
            <div
              key={rr.relayUrl}
              style={{ fontSize: 11, marginTop: 2, display: "flex", gap: 6 }}
            >
              <span>{rr.success ? "✓" : "✗"}</span>
              <span style={{ fontFamily: "monospace" }}>{rr.relayUrl}</span>
              {rr.error && (
                <span style={{ color: "var(--color-danger)" }}>{rr.error}</span>
              )}
            </div>
          ))}
          {result.nostrError && (
            <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 2 }}>
              {result.nostrError}
            </div>
          )}
        </div>
      )}

      {/* Mastodon */}
      {(result.mastodonPublished || result.mastodonError) && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 4 }}>
            Mastodon {mastodonOk ? "✅" : "❌"}
          </div>
          {result.mastodonUrl && (
            <a
              href={result.mastodonUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: "var(--color-accent)", wordBreak: "break-all" }}
            >
              {result.mastodonUrl}
            </a>
          )}
          {result.mastodonError && (
            <div style={{ fontSize: 11, color: "var(--color-danger)" }}>
              {result.mastodonError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compose tab ───────────────────────────────────────────────────────────────

function ComposeTab({
  initialData,
  config,
}: {
  initialData: DShareInitialData;
  config: DShareConfig;
}) {
  const [gameTitle, setGameTitle] = useState(initialData.gameTitle ?? "");
  const [rating, setRating] = useState<number | null>(initialData.rating ?? null);
  const [reviewText, setReviewText] = useState(initialData.review ?? "");
  const [screenshotPath, setScreenshotPath] = useState(initialData.screenshotPath ?? "");
  const [extraTags, setExtraTags] = useState("");
  const [publishNostr, setPublishNostr] = useState(true);
  const [publishMastodon, setPublishMastodon] = useState(
    !!(config.mastodonInstanceUrl && config.mastodonAccessToken)
  );
  const [preview, setPreview] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<DShareResult | null>(null);
  const [error, setError] = useState("");

  const buildPost = useCallback((): DSharePost => ({
    gameTitle,
    rating,
    reviewText: reviewText.trim() || null,
    screenshotPath: screenshotPath.trim() || null,
    extraTags: extraTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    mastodonVisibility: null,
  }), [gameTitle, rating, reviewText, screenshotPath, extraTags]);

  // Live preview
  useEffect(() => {
    if (!gameTitle.trim()) {
      setPreview("");
      return;
    }
    const post = buildPost();
    dsharePreviewContent(post)
      .then(setPreview)
      .catch(() => setPreview(""));
  }, [gameTitle, rating, reviewText, extraTags, buildPost]);

  const handlePublish = async () => {
    if (!gameTitle.trim()) {
      setError("Game title is required.");
      return;
    }
    const platforms: string[] = [];
    if (publishNostr) platforms.push("nostr");
    if (publishMastodon) platforms.push("mastodon");
    if (platforms.length === 0) {
      setError("Select at least one platform.");
      return;
    }
    setError("");
    setPublishing(true);
    setResult(null);
    try {
      const r = await dsharePublish(buildPost(), platforms);
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div style={section}>
      {/* Game title */}
      <div>
        <span style={fieldLabel}>Game Title *</span>
        <input
          type="text"
          placeholder="Enter game title…"
          value={gameTitle}
          onChange={(e) => setGameTitle((e.target as HTMLInputElement).value)}
          style={inputStyle}
        />
      </div>

      {/* Rating */}
      <div>
        <span style={fieldLabel}>Rating (optional)</span>
        <RatingPicker value={rating} onChange={setRating} />
      </div>

      {/* Review */}
      <div>
        <span style={fieldLabel}>Review (optional)</span>
        <textarea
          placeholder="Share your thoughts…"
          value={reviewText}
          onChange={(e) => setReviewText((e.target as HTMLTextAreaElement).value)}
          style={textAreaStyle}
          rows={4}
        />
      </div>

      {/* Screenshot path (Mastodon only) */}
      {publishMastodon && (
        <div>
          <span style={fieldLabel}>Screenshot Path (optional, Mastodon only)</span>
          <input
            type="text"
            placeholder="Absolute path to image file…"
            value={screenshotPath}
            onChange={(e) => setScreenshotPath((e.target as HTMLInputElement).value)}
            style={inputStyle}
          />
        </div>
      )}

      {/* Extra tags */}
      <div>
        <span style={fieldLabel}>Extra Hashtags (comma-separated, optional)</span>
        <input
          type="text"
          placeholder="rpg, indie, steam…"
          value={extraTags}
          onChange={(e) => setExtraTags((e.target as HTMLInputElement).value)}
          style={inputStyle}
        />
      </div>

      {/* Platform selection */}
      <div>
        <span style={fieldLabel}>Publish to</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PlatformToggle
            id="toggle-nostr"
            label="📻 Nostr"
            description="Publishes a kind:1 note to your configured relays"
            checked={publishNostr}
            onChange={setPublishNostr}
          />
          <PlatformToggle
            id="toggle-mastodon"
            label="🐘 Mastodon / ActivityPub"
            description="Posts a status on your Mastodon-compatible instance"
            checked={publishMastodon}
            onChange={setPublishMastodon}
          />
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div>
          <span style={fieldLabel}>Preview</span>
          <div style={previewBox}>{preview}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "8px 12px", borderRadius: 7, fontSize: 12,
            background: "rgba(192,57,43,.15)", color: "var(--color-danger)",
            border: "1px solid rgba(192,57,43,.3)",
          }}
        >
          {error}
        </div>
      )}

      {/* Result */}
      {result && <ResultBanner result={result} />}

      {/* Publish */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handlePublish}
          disabled={publishing}
          style={{ ...btnAccent, opacity: publishing ? 0.6 : 1 }}
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────────

function SettingsTab({
  config,
  onSaved,
}: {
  config: DShareConfig;
  onSaved: (c: DShareConfig) => void;
}) {
  const [relays, setRelays] = useState<string[]>(config.nostrRelays);
  const [instanceUrl, setInstanceUrl] = useState(config.mastodonInstanceUrl ?? "");
  const [token, setToken] = useState(config.mastodonAccessToken ?? "");
  const [visibility, setVisibility] = useState(config.mastodonVisibility);
  const [nostrPubkey, setNostrPubkey] = useState(config.nostrPubkeyHex);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    dshareGetNostrPubkey()
      .then(setNostrPubkey)
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setErr("");
    const updated: DShareConfig = {
      nostrRelays: relays,
      mastodonInstanceUrl: instanceUrl.trim() || null,
      mastodonAccessToken: token.trim() || null,
      mastodonVisibility: visibility,
      nostrPubkeyHex: nostrPubkey,
    };
    try {
      await dshareSaveConfig(updated);
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const copyPubkey = () => {
    if (nostrPubkey) {
      navigator.clipboard.writeText(nostrPubkey).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }
  };

  return (
    <div style={section}>
      {/* Nostr pubkey */}
      <div>
        <span style={fieldLabel}>My Nostr Public Key (npub hex)</span>
        <div style={{ display: "flex", gap: 6 }}>
          <span
            style={{
              flex: 1, fontFamily: "monospace", fontSize: 11,
              background: "var(--color-panel-2)", border: "1px solid var(--color-border)",
              borderRadius: 6, padding: "6px 10px", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: "var(--color-text-muted)",
            }}
            title={nostrPubkey}
          >
            {nostrPubkey || "Not yet generated — will be created on first publish"}
          </span>
          <button onClick={copyPubkey} style={btnBase} title="Copy pubkey">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
          Your private key is stored securely in the OS keychain and never leaves this device.
        </div>
      </div>

      {/* Nostr relays */}
      <div>
        <span style={fieldLabel}>Nostr Relays</span>
        <RelayListEditor relays={relays} onChange={setRelays} />
      </div>

      {/* Mastodon */}
      <div>
        <span style={fieldLabel}>Mastodon Instance URL</span>
        <input
          type="text"
          placeholder="https://mastodon.social"
          value={instanceUrl}
          onChange={(e) => setInstanceUrl((e.target as HTMLInputElement).value)}
          style={inputStyle}
        />
      </div>
      <div>
        <span style={fieldLabel}>Mastodon Access Token</span>
        <input
          type="password"
          placeholder="Paste your Bearer token here…"
          value={token}
          onChange={(e) => setToken((e.target as HTMLInputElement).value)}
          style={inputStyle}
        />
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
          Get your token from: <em>Account Settings → Development → New application</em>
        </div>
      </div>
      <div>
        <span style={fieldLabel}>Default Visibility</span>
        <select
          value={visibility}
          onChange={(e) => setVisibility((e.target as HTMLSelectElement).value)}
          style={{ ...inputStyle, width: "auto", paddingRight: 28 }}
        >
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Followers only</option>
          <option value="direct">Direct</option>
        </select>
      </div>

      {err && (
        <div
          style={{
            padding: "7px 12px", borderRadius: 7, fontSize: 12,
            background: "rgba(192,57,43,.15)", color: "var(--color-danger)",
            border: "1px solid rgba(192,57,43,.3)",
          }}
        >
          {err}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ ...btnAccent, opacity: saving ? 0.6 : 1 }}
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export interface DShareInitialData {
  gameTitle?: string;
  rating?: number;
  review?: string;
  screenshotPath?: string;
}

export interface DecentralizedShareModalProps {
  initialData?: DShareInitialData;
  onClose: () => void;
}

export function DecentralizedShareModal({
  initialData = {},
  onClose,
}: DecentralizedShareModalProps) {
  const [tab, setTab] = useState<"compose" | "settings">("compose");
  const [config, setConfig] = useState<DShareConfig>({
    nostrRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
    mastodonInstanceUrl: null,
    mastodonAccessToken: null,
    mastodonVisibility: "public",
    nostrPubkeyHex: "",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dshareGetConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>📡</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Share to Nostr / Mastodon</div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                Decentralized social sharing
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ ...btnBase, fontSize: 16, padding: "2px 9px", lineHeight: 1 }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div style={tabBar}>
          <TabBtn label="Compose" active={tab === "compose"} onClick={() => setTab("compose")} />
          <TabBtn label="Settings" active={tab === "settings"} onClick={() => setTab("settings")} />
        </div>

        {/* Body */}
        <div style={bodyScroll}>
          {loading ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: 13, padding: 20 }}>
              Loading…
            </div>
          ) : tab === "compose" ? (
            <ComposeTab initialData={initialData} config={config} />
          ) : (
            <SettingsTab config={config} onSaved={setConfig} />
          )}
        </div>
      </div>
    </div>
  );
}
