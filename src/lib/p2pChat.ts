/**
 * Encrypted P2P Chat — TypeScript bindings and types.
 *
 * Crypto is handled entirely in Rust (X25519 ECDH + ChaCha20-Poly1305 + ED25519).
 * This module only wraps the Tauri commands.
 */

import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatConfig {
  enabled: boolean;
  relayUrl: string | null;
  roomKey: string | null;
  myX25519PubB64: string;
}

/** A known peer whose X25519 public key is stored locally. */
export interface ChatContact {
  fingerprint: string;
  name: string;
  x25519PubB64: string;
  addedAt: number; // unix secs
}

/** A single message record as stored on disk. */
export interface ChatMessage {
  id: string;
  peerFingerprint: string;
  peerName: string;
  direction: "sent" | "received";
  plaintext: string;
  timestamp: number; // unix secs
  /** "delivered" | "pending" | "failed" | "read" */
  status: string;
}

/** Summary shown in the conversation list. */
export interface ConversationSummary {
  peerFingerprint: string;
  peerName: string;
  lastMessage: string;
  lastTimestamp: number;
  unreadCount: number;
}

// ── Command wrappers ──────────────────────────────────────────────────────────

export const chatGetConfig = (): Promise<ChatConfig> =>
  invoke<ChatConfig>("chat_get_config");

export const chatSaveConfig = (config: ChatConfig): Promise<void> =>
  invoke<void>("chat_save_config", { config });

export const chatGetMyX25519Pub = (): Promise<string> =>
  invoke<string>("chat_get_my_x25519_pub");

export const chatGetContacts = (): Promise<ChatContact[]> =>
  invoke<ChatContact[]>("chat_get_contacts");

export const chatSaveContact = (
  fingerprint: string,
  name: string,
  x25519PubB64: string
): Promise<void> =>
  invoke<void>("chat_save_contact", { fingerprint, name, x25519PubB64 });

export const chatRemoveContact = (fingerprint: string): Promise<void> =>
  invoke<void>("chat_remove_contact", { fingerprint });

export const chatGetConversations = (): Promise<ConversationSummary[]> =>
  invoke<ConversationSummary[]>("chat_get_conversations");

export const chatGetMessages = (peerFingerprint: string): Promise<ChatMessage[]> =>
  invoke<ChatMessage[]>("chat_get_messages", { peerFingerprint });

export const chatSendMessage = (
  recipientFingerprint: string,
  plaintext: string
): Promise<void> =>
  invoke<void>("chat_send_message", { recipientFingerprint, plaintext });

export const chatFetchRemote = (): Promise<number> =>
  invoke<number>("chat_fetch_remote");

export const chatMarkRead = (peerFingerprint: string): Promise<void> =>
  invoke<void>("chat_mark_read", { peerFingerprint });

export const chatDeleteConversation = (peerFingerprint: string): Promise<void> =>
  invoke<void>("chat_delete_conversation", { peerFingerprint });
