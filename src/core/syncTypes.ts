// ─── Sync Types & Pure Helpers ────────────────────────────────────────────────
// Platform-agnostic type declarations and pure utility helpers for the sync
// subsystem.  Tauri invoke wrappers live in src/lib/sync.ts.

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

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function createWebdavConfig(config: WebdavConfig): SyncProviderConfig {
  return { provider: "webdav", config };
}

export function createNextcloudConfig(config: NextcloudConfig): SyncProviderConfig {
  return { provider: "nextcloud", config };
}

export function createS3Config(config: S3Config): SyncProviderConfig {
  return { provider: "s3", config };
}

export function createGitConfig(config: GitConfig): SyncProviderConfig {
  return { provider: "git", config };
}

export function createGoogleDriveConfig(config: GoogleDriveConfig): SyncProviderConfig {
  return { provider: "google-drive", config };
}

export function createDropboxConfig(config: DropboxConfig): SyncProviderConfig {
  return { provider: "dropbox", config };
}

export function isAutoBackupProvider(provider: SyncProviderType): boolean {
  return provider === "google-drive" || provider === "dropbox";
}

export function getSyncProviderLabel(provider: SyncProviderType): string {
  switch (provider) {
    case "webdav":      return "WebDAV";
    case "nextcloud":   return "Nextcloud";
    case "s3":          return "S3";
    case "git":         return "Git";
    case "google-drive": return "Google Drive";
    case "dropbox":     return "Dropbox";
    default:            return provider;
  }
}
