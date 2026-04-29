import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SocialActivity {
  title: string;
  coverUrl: string | null;
  /** Unix seconds when the session started (when known). */
  sessionStart: number | null;
  /** Human-readable label e.g. "Playing via Steam". */
  statusText: string | null;
}

/** A peer record as submitted by one specific provider. */
export interface SocialPeerRecord {
  providerId: string;
  providerPeerId: string;
  displayName: string;
  avatarUrl: string | null;
  activity: SocialActivity | null;
  lastSeen: number;
  online: boolean;
}

/** One entry in a UnifiedPeer's source list. */
export interface SocialSource {
  providerId: string;
  providerPeerId: string;
  lastSeen: number;
  online: boolean;
}

/**
 * Merged peer view across all providers.
 *
 * Multiple sources only appear together when the user has **explicitly linked**
 * those identities — no accidental merging.
 */
export interface UnifiedPeer {
  /** Stable: `"<primary_provider>:<primary_peer_id>"` */
  unifiedId: string;
  displayName: string;
  avatarUrl: string | null;
  activity: SocialActivity | null;
  /** Every provider that currently reports this peer. */
  sources: SocialSource[];
  lastSeen: number;
}

/** User-asserted link between two provider identities. */
export interface SocialIdentityLink {
  providerA: string;
  peerIdA: string;
  providerB: string;
  peerIdB: string;
}

/** Auto-detected suggestion based on matching display names. */
export interface IdentityLinkSuggestion {
  providerA: string;
  peerIdA: string;
  displayNameA: string;
  providerB: string;
  peerIdB: string;
  displayNameB: string;
}

/** Per-provider persisted configuration. */
export interface SocialProviderConfig {
  providerId: string;
  enabled: boolean;
  label: string;
  /** Opaque credential bag (e.g. `apiKey`, `steamId` for Steam). */
  credentials: Record<string, string>;
}

/** Live status summary for a single provider. */
export interface SocialProviderStatus {
  providerId: string;
  /** `"active"` | `"connecting"` | `"disconnected"` | `"error: …"` */
  status: string;
  peerCount: number;
}

// ── Well-known provider IDs ────────────────────────────────────────────────────

export const SOCIAL_PROVIDER_PULSE   = "pulse";
export const SOCIAL_PROVIDER_DISCORD = "discord";
export const SOCIAL_PROVIDER_STEAM   = "steam";

/** Display metadata for built-in providers. */
export const PROVIDER_META: Record<string, { label: string; icon: string; description: string }> = {
  [SOCIAL_PROVIDER_PULSE]: {
    label: "Pulse",
    icon: "📡",
    description: "LAN/relay peer-to-peer activity broadcast. Works without a central server.",
  },
  [SOCIAL_PROVIDER_DISCORD]: {
    label: "Discord",
    icon: "🎮",
    description: "Show which Discord friends are currently playing games (requires Discord to be running).",
  },
  [SOCIAL_PROVIDER_STEAM]: {
    label: "Steam",
    icon: "🎲",
    description: "Poll your Steam friends list via the Steam Web API (requires an API key and your Steam64 ID).",
  },
};

// ── Invoke wrappers ────────────────────────────────────────────────────────────

export const invokeGetUnifiedPeers = (): Promise<UnifiedPeer[]> =>
  invoke<UnifiedPeer[]>("social_get_unified_peers");

export const invokeGetProviderConfigs = (): Promise<SocialProviderConfig[]> =>
  invoke<SocialProviderConfig[]>("social_get_provider_configs");

export const invokeSaveProviderConfig = (config: SocialProviderConfig): Promise<void> =>
  invoke<void>("social_save_provider_config", { config });

export const invokeGetProviderStatuses = (): Promise<SocialProviderStatus[]> =>
  invoke<SocialProviderStatus[]>("social_get_provider_statuses");

export const invokeLinkIdentities = (
  providerA: string,
  peerIdA: string,
  providerB: string,
  peerIdB: string,
): Promise<void> =>
  invoke<void>("social_link_identities", { providerA, peerIdA, providerB, peerIdB });

export const invokeUnlinkIdentities = (
  providerA: string,
  peerIdA: string,
): Promise<void> =>
  invoke<void>("social_unlink_identities", { providerA, peerIdA });

export const invokeGetIdentityLinks = (): Promise<SocialIdentityLink[]> =>
  invoke<SocialIdentityLink[]>("social_get_identity_links");

export const invokeGetLinkSuggestions = (): Promise<IdentityLinkSuggestion[]> =>
  invoke<IdentityLinkSuggestion[]>("social_get_link_suggestions");

export const invokeSteamStart = (apiKey: string, steamId: string): Promise<void> =>
  invoke<void>("social_steam_start", { apiKey, steamId });

export const invokeSteamStop = (): Promise<void> =>
  invoke<void>("social_steam_stop");

// ── Unified activity feed ──────────────────────────────────────────────────────

/** One item in the cross-provider activity feed. */
export interface FeedItem {
  providerId: string;
  displayName: string;
  avatarUrl: string | null;
  gameTitle: string | null;
  coverUrl: string | null;
  sessionStart: number | null;
  statusText: string | null;
  lastSeen: number;
  isOnline: boolean;
}

/** Return all online peers from ALL providers as a flat chronological list. */
export const invokeGetActivityFeed = (): Promise<FeedItem[]> =>
  invoke<FeedItem[]>("social_get_activity_feed");

// ── Event listener ─────────────────────────────────────────────────────────────

/**
 * Subscribe to the unified peer list.  The handler receives the full updated
 * list whenever any provider submits a change.
 * Returns a cleanup function — call it on unmount.
 */
export function onSocialPeersUpdated(
  handler: (peers: UnifiedPeer[]) => void,
): Promise<() => void> {
  return listen<UnifiedPeer[]>("social-peers-updated", (event) => {
    handler(event.payload);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function providerLabel(id: string): string {
  return PROVIDER_META[id]?.label ?? id;
}

export function providerIcon(id: string): string {
  return PROVIDER_META[id]?.icon ?? "🔌";
}

/** True when the provider status string indicates a live connection. */
export function isProviderActive(status: string): boolean {
  return status === "active" || status === "connecting";
}

export function statusColor(status: string): string {
  if (status === "active")      return "var(--color-success)";
  if (status === "connecting")  return "var(--color-warning)";
  if (status.startsWith("error")) return "var(--color-danger)";
  return "var(--color-text-dim)";
}

export function statusDot(status: string): string {
  if (status === "active")      return "🟢";
  if (status === "connecting")  return "🟡";
  if (status.startsWith("error")) return "🔴";
  return "⚫";
}
