import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PulseConfig {
  enabled: boolean;
  /** Display name override. Falls back to "Anonymous" when null. */
  displayName: string | null;
  /** Broadcast the current game title. */
  shareGame: boolean;
  /** Broadcast the game cover URL. */
  shareCover: boolean;
  /** Shared room key — only peers with the same key are shown. */
  roomKey: string;
  /** UDP broadcast port for LAN discovery. */
  lanPort: number;
  /** Enable LAN UDP broadcast. */
  lanEnabled: boolean;
  /** Optional HTTP relay base URL. */
  relayUrl: string | null;
}

export interface GameActivity {
  title: string;
  coverUrl: string | null;
  /** Unix timestamp (seconds) when the session started. */
  sessionStart: number;
}

export interface PeerInfo {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  activity: GameActivity | null;
  /** Unix timestamp (seconds) of the last received beacon. */
  lastSeen: number;
  /** True when the record came via the relay rather than LAN. */
  viaRelay: boolean;
}

// ── Relay capabilities ─────────────────────────────────────────────────────────

/**
 * Capabilities advertised by a relay via GET /pulse/capabilities.
 *
 * Baseline features always included: `["beacon", "peers"]`.
 * Additional optional tokens: `"chat"`, `"profiles"`, `"trending"`,
 * `"presence_events"`, `"avatar_upload"`.
 *
 * `probeStatus`:
 *   200 → relay replied with full capabilities
 *   404 → no /capabilities endpoint (baseline relay, fully supported)
 *   0   → unreachable / timeout
 */
export interface RelayCapabilities {
  name: string | null;
  version: string | null;
  features: string[];
  beaconTtlSecs: number | null;
  maxRoomPeers: number | null;
  description: string | null;
  sourceUrl: string | null;
  probeStatus: number;
}

/**
 * Well-known relay presets shown in the relay URL picker.
 * Users can always type a custom URL — these are suggestions only.
 */
export const WELL_KNOWN_RELAYS: Array<{ label: string; url: string; description: string }> = [
  {
    label: "Libmaly Community Relay",
    url: "https://relay.libmaly.app",
    description: "Official community relay maintained by the Libmaly project.",
  },
  {
    label: "Self-hosted (localhost)",
    url: "http://localhost:8787",
    description: "A locally running relay for development or private use.",
  },
];

// ── Invoke wrappers ────────────────────────────────────────────────────────────

export const invokeGetPulseConfig = (): Promise<PulseConfig> =>
  invoke<PulseConfig>("pulse_get_config");

export const invokeSavePulseConfig = (config: PulseConfig): Promise<void> =>
  invoke<void>("pulse_save_config", { config });

export const invokeGetPulsePeers = (): Promise<PeerInfo[]> =>
  invoke<PeerInfo[]>("pulse_get_peers");

export const invokeStartPulse = (): Promise<void> =>
  invoke<void>("pulse_start_service");

export const invokeStopPulse = (): Promise<void> =>
  invoke<void>("pulse_stop_service");

export const invokeGetPulsePeerId = (): Promise<string> =>
  invoke<string>("pulse_get_peer_id");

/** Notify Pulse of the game cover URL once metadata is resolved. */
export const invokeSetPulseCover = (coverUrl: string | null): Promise<void> =>
  invoke<void>("pulse_set_cover", { coverUrl });

/**
 * Probe a relay's `/pulse/capabilities` endpoint and return the result.
 * Always resolves — never rejects.  Unreachable relays return `probeStatus: 0`
 * with the baseline feature set.  No features are withheld based on the URL.
 * Emits `"relay-caps-updated"` so the UI updates reactively.
 */
export const invokeProbRelay = (url: string): Promise<RelayCapabilities> =>
  invoke<RelayCapabilities>("pulse_probe_relay", { url });

/**
 * Return the last cached capabilities for a relay URL without re-probing.
 * Returns `null` if the relay has never been probed this session.
 */
export const invokeGetRelayCaps = (url: string): Promise<RelayCapabilities | null> =>
  invoke<RelayCapabilities | null>("pulse_get_relay_caps", { url });

/**
 * Return the last cached capabilities for the **currently configured** relay.
 * Returns `null` when no relay is configured or when it has not been probed yet.
 */
export const invokeGetActiveRelayCaps = (): Promise<RelayCapabilities | null> =>
  invoke<RelayCapabilities | null>("pulse_get_active_relay_caps");

// ── Feature negotiation ───────────────────────────────────────────────────────

/** Well-known optional feature tokens a relay may advertise. */
export const RELAY_FEATURE_CHAT             = "chat";
export const RELAY_FEATURE_PROFILES         = "profiles";
export const RELAY_FEATURE_TRENDING         = "trending";
export const RELAY_FEATURE_PRESENCE_EVENTS  = "presence_events";
export const RELAY_FEATURE_AVATAR_UPLOAD    = "avatar_upload";

/**
 * Returns `true` when `caps` includes `feature`.
 * Safe to call with `null` caps — returns `false` in that case.
 */
export function relayHasFeature(caps: RelayCapabilities | null, feature: string): boolean {
  return caps?.features.includes(feature) ?? false;
}

// ── Event listeners ───────────────────────────────────────────────────────────

/**
 * Subscribe to live peer list updates.
 * The handler receives the full current peer list on every change.
 * Returns a cleanup function to call on unmount.
 */
export function onPeersUpdated(handler: (peers: PeerInfo[]) => void): Promise<() => void> {
  return listen<PeerInfo[]>("pulse-peers-updated", (event) => {
    handler(event.payload);
  });
}

/**
 * Subscribe to relay capability updates.
 * Fires whenever the active relay is probed (on service start or manual probe).
 * Returns a cleanup function to call on unmount.
 */
export function onRelayCapsUpdated(
  handler: (caps: RelayCapabilities) => void,
): Promise<() => void> {
  return listen<RelayCapabilities>("relay-caps-updated", (event) => {
    handler(event.payload);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a session duration (seconds since epoch → elapsed string). */
export function formatPulseElapsed(sessionStartSecs: number): string {
  const s = Math.floor(Date.now() / 1000 - sessionStartSecs);
  if (s < 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Generate a random room key (24 alphanumeric characters). */
export function generateRoomKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
