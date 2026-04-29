/**
 * Decentralized Sharing — Nostr and Mastodon/ActivityPub bindings.
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DShareConfig {
  nostrRelays: string[];
  mastodonInstanceUrl: string | null;
  mastodonAccessToken: string | null;
  mastodonVisibility: string;
  nostrPubkeyHex: string;
}

export interface DSharePost {
  gameTitle: string;
  rating: number | null;
  reviewText: string | null;
  screenshotPath: string | null;
  extraTags: string[];
  mastodonVisibility: string | null;
}

export interface RelayResult {
  relayUrl: string;
  success: boolean;
  error: string | null;
}

export interface DShareResult {
  nostrPublished: boolean;
  nostrEventId: string | null;
  nostrRelayResults: RelayResult[];
  nostrError: string | null;
  mastodonPublished: boolean;
  mastodonUrl: string | null;
  mastodonError: string | null;
}

// ── Command wrappers ──────────────────────────────────────────────────────────

export const dshareGetConfig = (): Promise<DShareConfig> =>
  invoke<DShareConfig>("dshare_get_config");

export const dshareSaveConfig = (config: DShareConfig): Promise<void> =>
  invoke<void>("dshare_save_config", { config });

export const dshareGetNostrPubkey = (): Promise<string> =>
  invoke<string>("dshare_get_nostr_pubkey");

export const dsharePreviewContent = (post: DSharePost): Promise<string> =>
  invoke<string>("dshare_preview_content", { post });

export const dsharePublish = (
  post: DSharePost,
  platforms: string[]
): Promise<DShareResult> =>
  invoke<DShareResult>("dshare_publish", { post, platforms });
