import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Game, SessionEntry } from "../../types";
import {
  type PulseConfig,
  type PeerInfo,
  type RelayCapabilities,
  invokeGetPulseConfig,
  invokeSavePulseConfig,
  invokeStartPulse,
  invokeStopPulse,
  invokeGetPulsePeerId,
  invokeGetPulsePeers,
  onPeersUpdated,
  onRelayCapsUpdated,
  invokeGetActiveRelayCaps,
  generateRoomKey,
  formatPulseElapsed,
  invokeProbRelay,
  WELL_KNOWN_RELAYS,
  RELAY_FEATURE_CHAT,
  RELAY_FEATURE_PROFILES,
  RELAY_FEATURE_TRENDING,
  RELAY_FEATURE_PRESENCE_EVENTS,
  RELAY_FEATURE_AVATAR_UPLOAD,
  relayHasFeature,
} from "../../lib/pulse";
import {
  type TrendingConfig,
  type TrendingEntry,
  type ContributionItem,
  invokeGetTrendingConfig,
  invokeSaveTrendingConfig,
  invokeTrendingFetch,
  invokeTrendingContribute,
  invokeTrendingCooldownSecs,
  computeWeeklyContributions,
  formatCooldown,
} from "../../lib/trending";

// ── Trending Panel ─────────────────────────────────────────────────────────────

function TrendingPanel({
  relayUrl,
  sessions,
  games,
}: {
  relayUrl: string;
  sessions: SessionEntry[];
  games: Game[];
}) {
  const [trendingCfg, setTrendingCfg] = useState<TrendingConfig | null>(null);
  const [entries, setEntries] = useState<TrendingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contributing, setContributing] = useState(false);
  const [cooldownSecs, setCooldownSecs] = useState(0);
  const [previewItems, setPreviewItems] = useState<ContributionItem[] | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Title resolver: path → game name
  const resolveTitle = useCallback(
    (path: string): string | null => {
      return games.find((g) => g.path === path)?.name ?? null;
    },
    [games],
  );

  const load = useCallback(async () => {
    const [cfg, cooldown] = await Promise.all([
      invokeGetTrendingConfig(),
      invokeTrendingCooldownSecs(),
    ]);
    setTrendingCfg(cfg);
    setCooldownSecs(cooldown);
  }, []);

  const fetchTrending = useCallback(async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const result = await invokeTrendingFetch(relayUrl, 20);
      setEntries(result.entries);
    } catch (e) {
      setStatusMsg({ ok: false, text: String(e) });
    } finally {
      setLoading(false);
    }
  }, [relayUrl]);

  useEffect(() => {
    load();
    fetchTrending();
  }, [load, fetchTrending]);

  const handleToggleOptIn = async (enabled: boolean) => {
    if (!trendingCfg) return;
    const next: TrendingConfig = { ...trendingCfg, enabled };
    setTrendingCfg(next);
    await invokeSaveTrendingConfig(next);
  };

  const handlePreview = () => {
    const items = computeWeeklyContributions(sessions, resolveTitle);
    setPreviewItems(items);
  };

  const handleContribute = async () => {
    if (!previewItems || previewItems.length === 0) return;
    setContributing(true);
    setStatusMsg(null);
    try {
      await invokeTrendingContribute(relayUrl, previewItems);
      setStatusMsg({ ok: true, text: "Contributed successfully. Thank you!" });
      setPreviewItems(null);
      const [cfg, cooldown] = await Promise.all([
        invokeGetTrendingConfig(),
        invokeTrendingCooldownSecs(),
      ]);
      setTrendingCfg(cfg);
      setCooldownSecs(cooldown);
      // Refresh list after contributing
      fetchTrending();
    } catch (e) {
      setStatusMsg({ ok: false, text: String(e) });
    } finally {
      setContributing(false);
    }
  };

  const cardStyle: Record<string, string> = {
    marginTop: "14px",
    padding: "12px 14px",
    background: "rgba(55,165,216,.05)",
    border: "1px solid rgba(55,165,216,.2)",
    borderRadius: "8px",
  };

  const rankColor = (rank: number) => {
    if (rank === 1) return "#f0c040";
    if (rank === 2) return "#c0c0c0";
    if (rank === 3) return "#cd7f32";
    return "var(--color-text-muted, #888)";
  };

  if (!trendingCfg) return null;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14 }}>
          <span>🔥</span>
          <span>Global Trending This Week</span>
        </div>
        <button
          onClick={fetchTrending}
          disabled={loading}
          title="Refresh"
          style={{
            background: "none",
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
            fontSize: 14,
            padding: "2px 6px",
          }}
        >
          ↻
        </button>
      </div>

      {/* Trending list */}
      {loading && (
        <div style={{ color: "var(--color-text-muted, #888)", fontSize: 13 }}>Loading…</div>
      )}
      {!loading && entries.length === 0 && (
        <div style={{ color: "var(--color-text-muted, #888)", fontSize: 13 }}>
          No trending data available yet.
        </div>
      )}
      {!loading && entries.length > 0 && (
        <ol style={{ margin: "0 0 10px", padding: "0 0 0 8px", listStyle: "none" }}>
          {entries.map((e) => (
            <li
              key={e.title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 0",
                borderBottom: "1px solid rgba(255,255,255,.06)",
                fontSize: 13,
              }}
            >
              <span style={{ width: 22, textAlign: "right", fontWeight: 700, color: rankColor(e.rank) }}>
                {e.rank}.
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.title}
              </span>
              <span style={{ color: "var(--color-text-muted, #888)", fontSize: 12, whiteSpace: "nowrap" }}>
                {e.totalHoursApprox > 0 ? `~${e.totalHoursApprox.toFixed(1)}h` : ""}
                {e.contributorCount > 0 ? ` · ${e.contributorCount} players` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* Opt-in toggle with privacy notice */}
      <div
        style={{
          marginTop: 10,
          padding: "10px 12px",
          background: "rgba(0,0,0,.15)",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={trendingCfg.enabled}
            onChange={(e) => handleToggleOptIn((e.target as HTMLInputElement).checked)}
          />
          Contribute my anonymous weekly stats
        </label>
        <div style={{ marginTop: 6, color: "var(--color-text-muted, #888)", lineHeight: 1.5 }}>
          What gets shared: <strong>game titles + bucketed hours only.</strong> No peer ID, no file
          paths. At most once per 24 hours. Contributions are aggregated by the relay — raw
          submissions are discarded.
        </div>
      </div>

      {/* Contribution controls (only when opted in) */}
      {trendingCfg.enabled && (
        <div style={{ marginTop: 10 }}>
          {cooldownSecs > 0 ? (
            <div style={{ color: "var(--color-text-muted, #888)", fontSize: 13 }}>
              ⏳ Next contribution available in <strong>{formatCooldown(cooldownSecs)}</strong>.
            </div>
          ) : previewItems === null ? (
            <button
              onClick={handlePreview}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(55,165,216,.4)",
                background: "rgba(55,165,216,.1)",
                color: "var(--color-accent, #37a5d8)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Preview what I'd share
            </button>
          ) : (
            <div>
              {previewItems.length === 0 ? (
                <div style={{ color: "var(--color-text-muted, #888)", fontSize: 13 }}>
                  No qualifying play sessions found this week (need ≥ 0.5 h per game).
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, marginBottom: 6, fontWeight: 600 }}>
                    Preview ({previewItems.length} {previewItems.length === 1 ? "title" : "titles"}):
                  </div>
                  <ul style={{ margin: "0 0 8px", padding: "0 0 0 14px", fontSize: 13 }}>
                    {previewItems.map((item) => (
                      <li key={item.title}>
                        {item.title} — {item.hoursBucket.toFixed(1)} h
                      </li>
                    ))}
                  </ul>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={handleContribute}
                      disabled={contributing}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "none",
                        background: "var(--color-accent, #37a5d8)",
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: contributing ? "not-allowed" : "pointer",
                        opacity: contributing ? 0.6 : 1,
                      }}
                    >
                      {contributing ? "Submitting…" : "Submit anonymized stats"}
                    </button>
                    <button
                      onClick={() => setPreviewItems(null)}
                      disabled={contributing}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,.2)",
                        background: "none",
                        color: "var(--color-text-muted, #888)",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Status message */}
      {statusMsg && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: statusMsg.ok ? "#4caf50" : "#f44336",
          }}
        >
          {statusMsg.text}
        </div>
      )}
    </div>
  );
}

// ── Relay capability probe panel ───────────────────────────────────────────────

function RelayProbePanel({
  relayUrl,
  onUrlChange,
}: {
  relayUrl: string | null;
  onUrlChange: (url: string | null) => void;
}) {
  const [probing, setProbing] = useState(false);
  const [caps, setCaps] = useState<RelayCapabilities | null>(null);
  const probeUrl = useRef<string | null>(null);

  const handleProbe = async () => {
    const url = relayUrl?.trim();
    if (!url) return;
    setProbing(true);
    setCaps(null);
    probeUrl.current = url;
    try {
      const result = await invokeProbRelay(url);
      if (probeUrl.current === url) setCaps(result);
    } finally {
      if (probeUrl.current === url) setProbing(false);
    }
  };

  // Clear probe result when URL changes
  const handleUrlInput = (raw: string) => {
    setCaps(null);
    probeUrl.current = null;
    onUrlChange(raw.trim() || null);
  };

  const inputStyle: preact.JSX.CSSProperties = {
    background: "var(--color-panel-3)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-text)",
    padding: "5px 8px",
    fontSize: 12,
    fontFamily: "monospace",
    flex: 1,
    minWidth: 0,
  };

  const statusColor =
    caps === null ? undefined
    : caps.probeStatus === 0 ? "var(--color-danger)"
    : caps.probeStatus === 404 ? "var(--color-text-muted)"
    : caps.probeStatus >= 200 && caps.probeStatus < 300 ? "var(--color-success)"
    : "var(--color-warning)";

  const statusLabel =
    caps === null ? null
    : caps.probeStatus === 0 ? "⚠ Unreachable"
    : caps.probeStatus === 404 ? "✓ Baseline relay (no /capabilities endpoint)"
    : caps.probeStatus >= 200 && caps.probeStatus < 300 ? "✓ Connected"
    : `⚠ HTTP ${caps.probeStatus}`;

  // Relay presets dropdown
  const [showPresets, setShowPresets] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* URL row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          style={inputStyle}
          type="url"
          value={relayUrl ?? ""}
          placeholder="https://my-relay.example.com"
          onInput={(e) => handleUrlInput((e.target as HTMLInputElement).value)}
        />
        {/* Preset picker */}
        <div style={{ position: "relative" }}>
          <button
            style={{
              padding: "5px 8px",
              fontSize: 11,
              border: "1px solid var(--color-border)",
              borderRadius: 5,
              background: "var(--color-panel-3)",
              cursor: "pointer",
              color: "var(--color-text)",
            }}
            title="Select a known relay"
            onClick={() => setShowPresets((v) => !v)}
          >
            ▾
          </button>
          {showPresets && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                background: "var(--color-panel-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "4px 0",
                zIndex: 50,
                minWidth: 260,
                boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
              }}
            >
              {WELL_KNOWN_RELAYS.map((preset) => (
                <button
                  key={preset.url}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 12px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--color-text)",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--color-panel-3)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "none")}
                  onClick={() => {
                    handleUrlInput(preset.url);
                    setShowPresets(false);
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.label}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 1 }}>{preset.description}</div>
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--color-border)", margin: "4px 0" }} />
              <button
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 12px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  fontSize: 11,
                }}
                onClick={() => { handleUrlInput(""); setShowPresets(false); }}
              >
                Clear (LAN-only mode)
              </button>
            </div>
          )}
        </div>
        {/* Test button */}
        <button
          style={{
            padding: "5px 10px",
            fontSize: 11,
            border: "1px solid var(--color-border)",
            borderRadius: 5,
            background: "var(--color-panel-3)",
            cursor: relayUrl ? "pointer" : "not-allowed",
            opacity: relayUrl ? 1 : 0.5,
            color: "var(--color-text)",
            whiteSpace: "nowrap",
          }}
          disabled={!relayUrl || probing}
          onClick={handleProbe}
          title="Test relay connectivity and capabilities"
        >
          {probing ? "Testing…" : "Test relay"}
        </button>
      </div>

      {/* Probe result */}
      {caps && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--color-panel-2)",
            border: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            gap: 7,
          }}
        >
          {/* Status line */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
            {caps.name && (
              <span style={{ fontSize: 12, color: "var(--color-text)" }}>· {caps.name}</span>
            )}
            {caps.version && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 99,
                  background: "var(--color-panel-3)",
                  color: "var(--color-text-muted)",
                }}
              >
                v{caps.version}
              </span>
            )}
          </div>

          {/* Description */}
          {caps.description && (
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.4 }}>
              {caps.description}
            </div>
          )}

          {/* Features */}
          <div>
            <div style={{ fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>
              Supported features
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {caps.features.map((f) => (
                <span
                  key={f}
                  style={{
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 99,
                    background: "rgba(55,165,216,.14)",
                    color: "var(--color-accent)",
                    border: "1px solid rgba(55,165,216,.25)",
                  }}
                >
                  {FEATURE_LABEL[f] ? `${FEATURE_LABEL[f].icon} ${FEATURE_LABEL[f].label}` : f}
                </span>
              ))}
            </div>
          </div>

          {/* Meta: TTL / max peers / source */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {caps.beaconTtlSecs != null && (
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                Beacon TTL: {caps.beaconTtlSecs}s
              </span>
            )}
            {caps.maxRoomPeers != null && (
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                Max peers/room: {caps.maxRoomPeers}
              </span>
            )}
            {caps.sourceUrl && (
              <a
                href={caps.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 10, color: "var(--color-accent)" }}
              >
                Source ↗
              </a>
            )}
          </div>

          {/* Note: fan-made relays are first-class */}
          {caps.probeStatus !== 0 && (
            <div style={{ fontSize: 10, color: "var(--color-text-dim)", marginTop: 2 }}>
              Any relay implementing the{" "}
              <a
                href="https://github.com/Baconana-chan/Libmaly/wiki/Pulse-Relay"
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--color-accent)" }}
              >
                Pulse relay spec ↗
              </a>{" "}
              is fully supported — no features are locked to the official relay.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Active relay capabilities strip ───────────────────────────────────────────

const FEATURE_LABEL: Record<string, { label: string; icon: string }> = {
  beacon:          { label: "Beacons",      icon: "📡" },
  peers:           { label: "Peer list",    icon: "👥" },
  chat:            { label: "Chat",         icon: "💬" },
  profiles:        { label: "Profiles",     icon: "🪪" },
  trending:        { label: "Trending",     icon: "🔥" },
  presence_events: { label: "Push events",  icon: "⚡" },
  avatar_upload:   { label: "Avatars",      icon: "🖼️" },
};

/** Shows a compact chip strip with all features advertised by the active relay. */
function ActiveRelayCapsBadge({ caps }: { caps: RelayCapabilities }) {
  const statusColor =
    caps.probeStatus === 0                                     ? "var(--color-danger)"
    : caps.probeStatus === 404                                 ? "var(--color-text-muted)"
    : caps.probeStatus >= 200 && caps.probeStatus < 300       ? "var(--color-success)"
    : "var(--color-warning)";

  const statusLabel =
    caps.probeStatus === 0      ? "⚠ Unreachable"
    : caps.probeStatus === 404  ? "✓ Baseline relay"
    : caps.probeStatus >= 200 && caps.probeStatus < 300 ? "✓ Connected"
    : `⚠ HTTP ${caps.probeStatus}`;

  return (
    <div
      style={{
        marginTop: 8,
        padding: "9px 12px",
        background: "var(--color-panel-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
        {caps.name && <span style={{ fontSize: 11, color: "var(--color-text)" }}>· {caps.name}</span>}
        {caps.version && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 99,
              background: "var(--color-panel-3)",
              color: "var(--color-text-muted)",
            }}
          >
            v{caps.version}
          </span>
        )}
        <span style={{ fontSize: 10, color: "var(--color-text-dim)", marginLeft: "auto" }}>
          Active relay features
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {caps.features.map((f) => {
          const meta = FEATURE_LABEL[f];
          return (
            <span
              key={f}
              title={meta?.label ?? f}
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 99,
                background: "rgba(55,165,216,.12)",
                color: "var(--color-accent)",
                border: "1px solid rgba(55,165,216,.22)",
              }}
            >
              {meta ? `${meta.icon} ${meta.label}` : f}
            </span>
          );
        })}
      </div>
      {caps.probeStatus === 404 && (
        <div style={{ fontSize: 10, color: "var(--color-text-dim)" }}>
          This relay doesn't expose a capabilities endpoint — all baseline features are available.
          Optional features (Chat, Trending, etc.) are not advertised and will be hidden.
        </div>
      )}
    </div>
  );
}

/** Placeholder card shown for relay features that are supported but not yet fully implemented. */
function RelayFeatureSection({
  icon,
  title,
  description,
  placeholder,
}: {
  icon: string;
  title: string;
  description: string;
  placeholder: string;
}) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: "10px 14px",
        background: "rgba(55,165,216,.04)",
        border: "1px dashed rgba(55,165,216,.3)",
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>{title}</span>
        <span
          style={{
            fontSize: 9,
            padding: "1px 5px",
            borderRadius: 99,
            background: "rgba(55,165,216,.18)",
            color: "var(--color-accent)",
            border: "1px solid rgba(55,165,216,.3)",
          }}
        >
          relay feature
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>{description}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-dim)", fontStyle: "italic" }}>{placeholder}</div>
    </div>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function PeerCard({ peer, tick }: { peer: PeerInfo; tick: number }) {
  void tick;
  const elapsed = peer.activity ? formatPulseElapsed(peer.activity.sessionStart) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "var(--color-panel-2)",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--color-panel-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        {peer.avatarUrl ? (
          <img src={peer.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          "🎮"
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {peer.displayName}
        </div>
        {peer.activity ? (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {peer.activity.title}
            {elapsed && <span style={{ marginLeft: 6, opacity: 0.65 }}>· {elapsed}</span>}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", opacity: 0.6 }}>Online</div>
        )}
      </div>

      {/* Source badge */}
      <div
        style={{
          fontSize: 9,
          padding: "2px 5px",
          borderRadius: 4,
          background: peer.viaRelay ? "rgba(216,168,53,.18)" : "rgba(55,165,216,.15)",
          color: peer.viaRelay ? "var(--color-warning)" : "var(--color-accent)",
          flexShrink: 0,
        }}
      >
        {peer.viaRelay ? "relay" : "lan"}
      </div>
    </div>
  );
}

// ── Main settings tab ──────────────────────────────────────────────────────────

export function PulseTab({
  sessions = [],
  games = [],
}: {
  sessions?: SessionEntry[];
  games?: Game[];
} = {}) {
  const [cfg, setCfg] = useState<PulseConfig | null>(null);
  const [peerId, setPeerId] = useState<string>("");
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [activeCaps, setActiveCaps] = useState<RelayCapabilities | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showRoomKey, setShowRoomKey] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    invokeGetPulseConfig().then(setCfg);
    invokeGetPulsePeerId().then(setPeerId);
    invokeGetPulsePeers().then(setPeers);
    invokeGetActiveRelayCaps().then(setActiveCaps);

    const unsubPeers = onPeersUpdated(setPeers);
    const unsubCaps  = onRelayCapsUpdated(setActiveCaps);
    const interval   = setInterval(() => setTick((t) => t + 1), 5000);

    return () => {
      unsubPeers.then((f) => f());
      unsubCaps.then((f) => f());
      clearInterval(interval);
    };
  }, []);

  if (!cfg) return <div style={{ padding: 20, color: "var(--color-text-muted)" }}>Loading…</div>;

  const update = <K extends keyof PulseConfig>(key: K, val: PulseConfig[K]) =>
    setCfg((prev) => prev ? { ...prev, [key]: val } : prev);

  const handleApply = async () => {
    if (!cfg) return;
    setSaving(true);
    setStatus(null);
    try {
      await invokeSavePulseConfig(cfg);
      if (cfg.enabled) {
        await invokeStopPulse();
        await invokeStartPulse();
        setStatus({ ok: true, msg: "Pulse started." });
      } else {
        await invokeStopPulse();
        setStatus({ ok: true, msg: "Pulse stopped." });
      }
    } catch (e: unknown) {
      setStatus({ ok: false, msg: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const rowStyle: preact.JSX.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid var(--color-border)",
  };

  const inputStyle: preact.JSX.CSSProperties = {
    background: "var(--color-panel-3)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-text)",
    padding: "5px 8px",
    fontSize: 12,
    width: 220,
    fontFamily: "monospace",
  };

  const sectionLabelStyle: preact.JSX.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--color-text-muted)",
    padding: "14px 0 4px",
  };

  const onlinePeers = peers.filter((p) => !!p.activity);
  const idlePeers = peers.filter((p) => !p.activity);

  return (
    <div style={{ padding: "0 4px" }}>
      {/* ── Header status ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 10px",
            borderRadius: 99,
            fontSize: 11,
            fontWeight: 600,
            background: cfg.enabled ? "rgba(91,168,91,.18)" : "rgba(100,120,140,.15)",
            color: cfg.enabled ? "var(--color-success)" : "var(--color-text-muted)",
          }}
        >
          <span style={{ fontSize: 8 }}>●</span>
          {cfg.enabled ? "Enabled" : "Disabled"}
        </div>
        {peers.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {peers.length} friend{peers.length !== 1 ? "s" : ""} online
          </div>
        )}
      </div>

      {/* ── Enable toggle ── */}
      <div style={rowStyle}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Enable Pulse</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
            Broadcast your activity and discover friends on the local network.
          </div>
        </div>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => update("enabled", (e.target as HTMLInputElement).checked)}
        />
      </div>

      {/* ── Identity ── */}
      <div style={sectionLabelStyle}>Identity</div>

      <div style={rowStyle}>
        <label style={{ fontSize: 12 }}>Display name</label>
        <input
          style={inputStyle}
          value={cfg.displayName ?? ""}
          placeholder="Anonymous"
          onInput={(e) => update("displayName", (e.target as HTMLInputElement).value || null)}
        />
      </div>

      {/* ── Privacy ── */}
      <div style={sectionLabelStyle}>Privacy</div>

      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 12 }}>Share game title</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
            Let friends see what you're playing.
          </div>
        </div>
        <input
          type="checkbox"
          checked={cfg.shareGame}
          onChange={(e) => update("shareGame", (e.target as HTMLInputElement).checked)}
        />
      </div>

      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 12 }}>Share cover art</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
            Include the game cover URL in broadcasts.
          </div>
        </div>
        <input
          type="checkbox"
          checked={cfg.shareCover}
          onChange={(e) => update("shareCover", (e.target as HTMLInputElement).checked)}
        />
      </div>

      {/* ── Room key ── */}
      <div style={sectionLabelStyle}>Room Key</div>

      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
        Only Libmaly instances sharing the same room key will see each other.
        Leave empty to see all Libmaly users on your LAN.
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          style={{ ...inputStyle, flex: 1, width: "auto" }}
          type={showRoomKey ? "text" : "password"}
          value={cfg.roomKey}
          placeholder="(empty = open room)"
          onInput={(e) => update("roomKey", (e.target as HTMLInputElement).value)}
        />
        <button
          style={{ padding: "5px 8px", fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 5, background: "var(--color-panel-3)", cursor: "pointer", color: "var(--color-text)" }}
          onClick={() => setShowRoomKey((v) => !v)}
          title={showRoomKey ? "Hide" : "Show"}
        >
          {showRoomKey ? "🙈" : "👁"}
        </button>
        <button
          style={{ padding: "5px 8px", fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 5, background: "var(--color-panel-3)", cursor: "pointer", color: "var(--color-text)" }}
          onClick={() => update("roomKey", generateRoomKey())}
          title="Generate random key"
        >
          🎲
        </button>
        {cfg.roomKey && (
          <button
            style={{ padding: "5px 8px", fontSize: 11, border: "1px solid var(--color-border)", borderRadius: 5, background: "var(--color-panel-3)", cursor: "pointer", color: "var(--color-text)" }}
            onClick={() => navigator.clipboard.writeText(cfg.roomKey)}
            title="Copy to clipboard"
          >
            📋
          </button>
        )}
      </div>

      {/* ── LAN ── */}
      <div style={sectionLabelStyle}>Local Network (LAN)</div>

      <div style={rowStyle}>
        <div>
          <div style={{ fontSize: 12 }}>UDP broadcast</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
            Discover friends on the same Wi-Fi / router. Zero-config.
          </div>
        </div>
        <input
          type="checkbox"
          checked={cfg.lanEnabled}
          onChange={(e) => update("lanEnabled", (e.target as HTMLInputElement).checked)}
        />
      </div>

      <div style={rowStyle}>
        <label style={{ fontSize: 12 }}>UDP port</label>
        <input
          style={{ ...inputStyle, width: 90 }}
          type="number"
          min={1024}
          max={65535}
          value={cfg.lanPort}
          onInput={(e) => update("lanPort", parseInt((e.target as HTMLInputElement).value) || 39511)}
        />
      </div>

      {/* ── Relay ── */}
      <div style={sectionLabelStyle}>Relay (Optional)</div>

      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 10 }}>
        Connect to any self-hosted or community relay to see friends across different networks.
        The relay only forwards beacons — it has no persistent storage.
        Leave empty to use LAN-only mode.
      </div>

      <RelayProbePanel
        relayUrl={cfg.relayUrl}
        onUrlChange={(url) => update("relayUrl", url)}
      />

      {/* ── Active relay capabilities strip ── */}
      {cfg.relayUrl && activeCaps && (
        <ActiveRelayCapsBadge caps={activeCaps} />
      )}

      {/* ── Feature-gated sections (shown only when relay advertises support) ── */}
      {relayHasFeature(activeCaps, RELAY_FEATURE_CHAT) && (
        <RelayFeatureSection
          icon="💬"
          title="Chat"
          description="Send messages to friends in the same room via this relay."
          placeholder="Chat is supported by this relay — full UI coming soon."
        />
      )}
      {relayHasFeature(activeCaps, RELAY_FEATURE_TRENDING) && cfg.relayUrl && (
        <TrendingPanel
          relayUrl={cfg.relayUrl}
          sessions={sessions}
          games={games}
        />
      )}
      {relayHasFeature(activeCaps, RELAY_FEATURE_PROFILES) && (
        <RelayFeatureSection
          icon="🪪"
          title="Peer Profiles"
          description="View and update your public profile on this relay."
          placeholder="Profiles are supported by this relay — full UI coming soon."
        />
      )}
      {relayHasFeature(activeCaps, RELAY_FEATURE_PRESENCE_EVENTS) && (
        <RelayFeatureSection
          icon="⚡"
          title="Push Presence"
          description="Instant presence updates via server-sent events (no polling)."
          placeholder="Push presence is supported by this relay — auto-enabled."
        />
      )}
      {relayHasFeature(activeCaps, RELAY_FEATURE_AVATAR_UPLOAD) && (
        <RelayFeatureSection
          icon="🖼️"
          title="Avatar Upload"
          description="Upload a custom avatar to this relay for friends to see."
          placeholder="Avatar upload is supported by this relay — full UI coming soon."
        />
      )}

      {/* ── Apply button ── */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={handleApply}
          disabled={saving}
          style={{
            padding: "7px 18px",
            borderRadius: 6,
            border: "none",
            background: "var(--color-accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 13,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Applying…" : "Apply & Restart"}
        </button>
        {status && (
          <span style={{ fontSize: 12, color: status.ok ? "var(--color-success)" : "var(--color-danger-strong)" }}>
            {status.msg}
          </span>
        )}
      </div>

      {/* ── Peer ID ── */}
      {peerId && (
        <div style={{ marginTop: 18, padding: "10px 12px", background: "var(--color-panel-2)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>Your Peer ID (stable, share with friends if needed)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>
              {peerId}
            </code>
            <button
              style={{ padding: "3px 7px", fontSize: 10, border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-panel-3)", cursor: "pointer", color: "var(--color-text)", flexShrink: 0 }}
              onClick={() => navigator.clipboard.writeText(peerId)}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* ── Live peer list preview ── */}
      {peers.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={sectionLabelStyle}>Friends Online Now</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {onlinePeers.map((p) => <PeerCard key={p.peerId} peer={p} tick={tick} />)}
            {idlePeers.map((p) => <PeerCard key={p.peerId} peer={p} tick={tick} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compact sidebar friends list ───────────────────────────────────────────────

export function PulseSidebarSection({ peers }: { peers: PeerInfo[] }) {
  if (peers.length === 0) {
    return (
      <div style={{ padding: "6px 12px", fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>
        No friends online
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
      {peers.map((peer) => {
        const elapsed = peer.activity ? formatPulseElapsed(peer.activity.sessionStart) : null;
        return (
          <div
            key={peer.peerId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 12px",
              cursor: "default",
            }}
            title={peer.activity ? `${peer.activity.title}${elapsed ? ` — ${elapsed}` : ""}` : "Online"}
          >
            {/* Avatar */}
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "var(--color-panel-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {peer.avatarUrl ? (
                <img src={peer.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                "🎮"
              )}
            </div>

            {/* Name + game */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {peer.displayName}
              </div>
              {peer.activity && (
                <div style={{ fontSize: 10, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {peer.activity.title}
                  {elapsed && <span style={{ marginLeft: 4, opacity: 0.55 }}>{elapsed}</span>}
                </div>
              )}
            </div>

            {/* Online dot */}
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: peer.activity ? "var(--color-success)" : "var(--color-text-muted)",
                flexShrink: 0,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
