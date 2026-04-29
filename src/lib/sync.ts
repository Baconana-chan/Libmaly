// ─── Sync — Tauri platform adapter ───────────────────────────────────────────
// Pure types and helper functions live in src/core/syncTypes.ts.
// This module re-exports everything from there and adds the Tauri invoke wrappers.

import { invoke } from "@tauri-apps/api/core";

export * from "../core/syncTypes";
import type {
  SyncProviderConfig,
  SyncResult,
  SyncConflictResolutionChoice,
  SyncConflictPreviewReport,
  SyncSaveBackupResult,
  SyncOAuthStartResult,
} from "../core/syncTypes";

// ─── Tauri invoke wrappers ────────────────────────────────────────────────────

export async function syncConfigure(config: SyncProviderConfig): Promise<void> {
  return invoke("sync_configure", { config });
}

export async function syncGetConfig(): Promise<SyncProviderConfig | null> {
  return invoke("sync_get_config");
}

export async function syncUpload(): Promise<SyncResult> {
  return invoke("sync_upload");
}

export async function syncDownload(): Promise<SyncResult> {
  return invoke("sync_download");
}

export async function syncResolveConflicts(resolution: Record<string, SyncConflictResolutionChoice>): Promise<SyncResult> {
  return invoke("sync_resolve_conflicts", { resolution });
}

export async function syncPreviewConflicts(): Promise<SyncConflictPreviewReport> {
  return invoke("sync_preview_conflicts");
}

export async function syncUploadSaveBackup(gamePath: string): Promise<SyncSaveBackupResult> {
  return invoke("sync_upload_save_backup", { gamePath });
}

export async function syncCheckRemote(): Promise<boolean> {
  return invoke("sync_check_remote");
}

export async function syncStartOAuth(provider: "google-drive" | "dropbox", clientId: string): Promise<SyncOAuthStartResult> {
  return invoke("sync_start_oauth", { provider, clientId });
}

export async function syncCompleteOAuthCallback(callbackUrl: string): Promise<SyncProviderConfig> {
  return invoke("sync_complete_oauth_callback", { callbackUrl });
}