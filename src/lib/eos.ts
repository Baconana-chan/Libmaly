// src/lib/eos.ts
// TypeScript bindings for the Epic Online Services (EOS) Tauri backend.

import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EosConfig {
  productId:    string;
  sandboxId:    string;
  deploymentId: string;
  clientId:     string;
  enabled:      boolean;
}

export interface EosStatusResult {
  isInitialized: boolean;
  isLoggedIn:    boolean;
  accountId:     string | null;
  sdkVersion:    string | null;
  dllPath:       string | null;
}

export interface OwnershipResult {
  catalogItemId: string;
  owned:         boolean;
}

export interface EosAchievementDef {
  achievementId:    string;
  displayName:      string;
  description:      string;
  isHidden:         boolean;
  lockedIconUrl:    string | null;
  unlockedIconUrl:  string | null;
}

export type EosLoginType = "persistent" | "exchange_code" | "account_portal";

// ── Commands ──────────────────────────────────────────────────────────────────

/** Retrieve the current EOS configuration (excluding the client secret). */
export function eosGetConfig(): Promise<EosConfig> {
  return invoke("eos_get_config");
}

/**
 * Save EOS configuration.
 * @param clientSecret  If provided (non-empty), it is stored in the OS keychain.
 */
export function eosSaveConfig(config: EosConfig, clientSecret?: string): Promise<void> {
  return invoke("eos_save_config", {
    config,
    clientSecret: clientSecret ?? null,
  });
}

/** Returns true if a client secret has been stored in the OS keychain. */
export function eosGetClientSecretSet(): Promise<boolean> {
  return invoke("eos_get_client_secret_set");
}

/**
 * Load the EOS SDK DLL and create the platform instance.
 * Must be called before login/ownership/achievements commands.
 */
export function eosInitialize(): Promise<void> {
  return invoke("eos_initialize");
}

/** Tear down the EOS platform and unregister the tick thread. */
export function eosShutdown(): Promise<void> {
  return invoke("eos_shutdown");
}

/** Returns current initialization and authentication status. */
export function eosGetStatus(): Promise<EosStatusResult> {
  return invoke("eos_get_status");
}

/**
 * Authenticate with Epic Account Services.
 *
 * Recommended flow:
 *   1. Try `"persistent"` (silent re-login from stored token).
 *   2. On failure, fall back to `"account_portal"` (opens Epic login browser).
 *
 * For games launched from Epic Games Launcher, use `"exchange_code"` with
 * the exchange code from the `AUTH_PASSWORD` environment variable.
 *
 * @returns The Epic Account ID string on success.
 */
export function eosLogin(loginType: EosLoginType): Promise<string> {
  return invoke("eos_login", { loginType });
}

/** Log out the currently authenticated Epic Account. */
export function eosLogout(): Promise<void> {
  return invoke("eos_logout");
}

/**
 * Check ownership for a list of EGS catalog item IDs (max 400).
 * The user must be logged in.
 */
export function eosQueryOwnership(catalogItemIds: string[]): Promise<OwnershipResult[]> {
  return invoke("eos_query_ownership", { catalogItemIds });
}

/**
 * Fetch achievement definitions for the configured product.
 * Returns the full catalogue of achievement definitions (no player progress –
 * that requires EOS Connect, which is a future enhancement).
 */
export function eosGetAchievements(): Promise<EosAchievementDef[]> {
  return invoke("eos_get_achievements");
}
