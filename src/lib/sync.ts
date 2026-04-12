import { invoke } from "@tauri-apps/api/core";

export type SyncProviderType = "webdav" | "nextcloud" | "s3" | "git";

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

export type SyncProviderConfig =
  | { provider: "webdav"; config: WebdavConfig }
  | { provider: "nextcloud"; config: NextcloudConfig }
  | { provider: "s3"; config: S3Config }
  | { provider: "git"; config: GitConfig };

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
 * @param resolution Map of key -> "local" or "remote"
 */
export async function syncResolveConflicts(resolution: Record<string, string>): Promise<SyncResult> {
  return invoke("sync_resolve_conflicts", { resolution });
}

/**
 * Check if remote state exists
 */
export async function syncCheckRemote(): Promise<boolean> {
  return invoke("sync_check_remote");
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
