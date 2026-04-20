import { invoke } from "@tauri-apps/api/core";

export type SyncProviderType = "webdav" | "nextcloud" | "s3" | "git" | "google-drive" | "dropbox";

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
  path: string;
}

export interface NextcloudConfig {
  url: string;
  username: string;
  password: string;
  path: string;
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  endpoint?: string;
  path: string;
}

export interface GitConfig {
  url: string;
  branch: string;
  username?: string;
  password?: string;
  sshKeyPath?: string;
}

export interface GoogleDriveConfig {
  accessToken: string;
  fileName: string;
  clientId?: string;
  refreshToken?: string;
}

export interface DropboxConfig {
  accessToken: string;
  path: string;
  clientId?: string;
  refreshToken?: string;
}

export interface SyncOAuthStartResult {
  authorizationUrl: string;
  providerType: SyncProviderType;
  redirectUri: string;
}

export type SyncProviderConfig =
  | { provider: "webdav"; config: WebdavConfig }
  | { provider: "nextcloud"; config: NextcloudConfig }
  | { provider: "s3"; config: S3Config }
  | { provider: "git"; config: GitConfig }
  | { provider: "google-drive"; config: GoogleDriveConfig }
  | { provider: "dropbox"; config: DropboxConfig };

export interface SyncMetadata {
  lastSyncAt: number;
  lastSyncHash: string;
  providerType: SyncProviderType;
}

export interface SyncResult {
  success: boolean;
  message: string;
  conflictsDetected: boolean;
  entriesSynced: number;
}

export interface SyncConflict {
  key: string;
  localValue: string;
  remoteValue: string;
  baseValue: string;
}

export type SyncConflictResolutionChoice = "local" | "remote" | "base";

export interface SyncConflictPreviewItem {
  key: string;
  label: string;
  resolution: string;
  reason: string;
  localCount: number;
  remoteCount: number;
  baseCount: number;
  localValue: string | null;
  remoteValue: string | null;
  baseValue: string | null;
  requiresManual: boolean;
}

export interface SyncConflictPreviewReport {
  resolvedEntries: Record<string, string>;
  items: SyncConflictPreviewItem[];
  conflictCount: number;
  changedKeys: string[];
}

export interface SyncSaveBackupResult {
  zipPath: string;
  files: number;
  directories: string[];
  remotePath: string;
  providerType: SyncProviderType;
}

/**
 * Configure a sync provider
 */
export async function syncConfigure(config: SyncProviderConfig): Promise<void> {
  return invoke("sync_configure", { config });
}

/**
 * Get the current sync configuration
 */
export async function syncGetConfig(): Promise<SyncProviderConfig | null> {
  return invoke("sync_get_config");
}

/**
 * Upload local state to the configured provider
 */
export async function syncUpload(): Promise<SyncResult> {
  return invoke("sync_upload");
}

/**
 * Download state from the configured provider
 */
export async function syncDownload(): Promise<SyncResult> {
  return invoke("sync_download");
}

/**
 * Resolve sync conflicts with user-provided resolution map
 * @param resolution Map of key -> "local", "remote", or "base"
 */
export async function syncResolveConflicts(resolution: Record<string, SyncConflictResolutionChoice>): Promise<SyncResult> {
  return invoke("sync_resolve_conflicts", { resolution });
}

export async function syncPreviewConflicts(): Promise<SyncConflictPreviewReport> {
  return invoke("sync_preview_conflicts");
}

export async function syncUploadSaveBackup(gamePath: string): Promise<SyncSaveBackupResult> {
  return invoke("sync_upload_save_backup", { gamePath });
}

/**
 * Check if remote state exists
 */
export async function syncCheckRemote(): Promise<boolean> {
  return invoke("sync_check_remote");
}

export async function syncStartOAuth(provider: "google-drive" | "dropbox", clientId: string): Promise<SyncOAuthStartResult> {
  return invoke("sync_start_oauth", { provider, clientId });
}

export async function syncCompleteOAuthCallback(callbackUrl: string): Promise<SyncProviderConfig> {
  return invoke("sync_complete_oauth_callback", { callbackUrl });
}

/**
 * Helper to create a WebDAV configuration
 */
export function createWebdavConfig(config: WebdavConfig): SyncProviderConfig {
  return { provider: "webdav", config };
}

/**
 * Helper to create a Nextcloud configuration
 */
export function createNextcloudConfig(config: NextcloudConfig): SyncProviderConfig {
  return { provider: "nextcloud", config };
}

/**
 * Helper to create an S3 configuration
 */
export function createS3Config(config: S3Config): SyncProviderConfig {
  return { provider: "s3", config };
}

/**
 * Helper to create a Git configuration
 */
export function createGitConfig(config: GitConfig): SyncProviderConfig {
  return { provider: "git", config };
}

/**
 * Helper to create a Google Drive configuration
 */
export function createGoogleDriveConfig(config: GoogleDriveConfig): SyncProviderConfig {
  return { provider: "google-drive", config };
}

/**
 * Helper to create a Dropbox configuration
 */
export function createDropboxConfig(config: DropboxConfig): SyncProviderConfig {
  return { provider: "dropbox", config };
}

export function isAutoBackupProvider(provider: SyncProviderType): boolean {
  return provider === "google-drive" || provider === "dropbox";
}

export function getSyncProviderLabel(provider: SyncProviderType): string {
  switch (provider) {
    case "webdav":
      return "WebDAV";
    case "nextcloud":
      return "Nextcloud";
    case "s3":
      return "S3";
    case "git":
      return "Git";
    case "google-drive":
      return "Google Drive";
    case "dropbox":
      return "Dropbox";
    default:
      return provider;
  }
}
