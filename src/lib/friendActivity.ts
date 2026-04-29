import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FriendEntry {
  peerId: string;
  nickname: string | null;
  addedAt: number;
  note: string | null;
}

export interface FriendActivityEntry {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  gameTitle: string | null;
  coverUrl: string | null;
  sessionStart: number | null;
  isOnline: boolean;
  lastSeen: number | null;
  viaRelay: boolean;
  note: string | null;
  addedAt: number;
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

export function invokeFriendsList(): Promise<FriendEntry[]> {
  return invoke<FriendEntry[]>("friends_list");
}

export function invokeFriendsAdd(
  peerId: string,
  nickname?: string,
  note?: string,
): Promise<void> {
  return invoke<void>("friends_add", {
    peerId,
    nickname: nickname ?? null,
    note: note ?? null,
  });
}

export function invokeFriendsRemove(peerId: string): Promise<void> {
  return invoke<void>("friends_remove", { peerId });
}

export function invokeFriendsUpdate(
  peerId: string,
  nickname?: string,
  note?: string,
): Promise<void> {
  return invoke<void>("friends_update", {
    peerId,
    nickname: nickname ?? null,
    note: note ?? null,
  });
}

export function invokeFriendsGetActivity(): Promise<FriendActivityEntry[]> {
  return invoke<FriendActivityEntry[]>("friends_get_activity");
}

export function invokeFriendsGetNowPlaying(): Promise<FriendActivityEntry[]> {
  return invoke<FriendActivityEntry[]>("friends_get_now_playing");
}

// ── Event subscription ────────────────────────────────────────────────────────

/** Subscribe to Pulse peer-map updates so friend activity refreshes live. */
export function onPeersUpdated(handler: () => void): Promise<UnlistenFn> {
  return listen("pulse-peers-updated", handler);
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Returns a human-readable "playing for Xh Ym" string.
 * Falls back to "just started" for sessions under a minute.
 */
export function formatSessionDuration(sessionStartSecs: number): string {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - sessionStartSecs);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  if (h === 0 && m === 0) return "just started";
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Shorten a peer ID for display (first 8 chars, upper-cased, no separators).
 * e.g. "a1b2c3d4e5f6g7h8" → "A1B2C3D4"
 */
export function shortPeerId(peerId: string): string {
  return peerId.slice(0, 8).toUpperCase();
}
