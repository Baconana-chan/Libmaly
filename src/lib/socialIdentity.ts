import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

// ── Types ──────────────────────────────────────────────────────────────────────

/** Non-secret identity profile stored on disk. */
export interface SocialIdentityProfile {
  /** Human-readable display name (max 64 chars). */
  displayName: string;
  /** Avatar as a data-URL or base64-encoded image string. Optional. */
  avatarBase64: string | null;
  /** Base64-encoded ED25519 verifying (public) key — 32 bytes. */
  publicKeyB64: string;
  /** Unix seconds when this keypair was first generated. */
  createdAt: number;
}

// ── Invoke wrappers ────────────────────────────────────────────────────────────

/** Return the current identity profile (no private key). */
export const invokeGetIdentityProfile = (): Promise<SocialIdentityProfile> =>
  invoke<SocialIdentityProfile>("identity_get_profile");

/**
 * Compact colon-separated hex fingerprint of the public key, e.g.
 * `ab:cd:ef:12:34:56:78:90`.  Returns null if no keypair exists.
 */
export const invokeGetIdentityFingerprint = (): Promise<string | null> =>
  invoke<string | null>("identity_get_fingerprint");

/** Save display name and avatar without touching the keypair. */
export const invokeSaveIdentityProfile = (
  displayName: string,
  avatarBase64: string | null,
): Promise<void> =>
  invoke<void>("identity_save_profile", { displayName, avatarBase64 });

/**
 * Generate a new ED25519 keypair.
 *
 * ⚠️  Replaces the existing keypair — any relay that knew the old public key
 *    will treat this as a different identity.
 */
export const invokeGenerateIdentityKeys = (): Promise<SocialIdentityProfile> =>
  invoke<SocialIdentityProfile>("identity_generate_keys");

/** Returns true if a private key is stored in the vault. */
export const invokeIdentityHasKeys = (): Promise<boolean> =>
  invoke<boolean>("identity_has_keys");

/**
 * Export the full bundle as a JSON string (includes private key).
 * Returns the JSON — callers must offer the user a save dialog.
 */
export const invokeExportIdentityBundle = (): Promise<string> =>
  invoke<string>("identity_export_bundle");

/**
 * Import an identity from a bundle JSON string.
 * Returns the restored profile on success.
 */
export const invokeImportIdentityBundle = (bundleJson: string): Promise<SocialIdentityProfile> =>
  invoke<SocialIdentityProfile>("identity_import_bundle", { bundleJson });

/** Delete the current identity keypair from the vault and clear the profile. */
export const invokeDeleteIdentity = (): Promise<void> =>
  invoke<void>("identity_delete");

// ── File-dialog helpers ────────────────────────────────────────────────────────

/** Prompt the user to save the bundle to a `.libmaly-identity.json` file. */
export async function exportIdentityToFile(): Promise<void> {
  const bundleJson = await invokeExportIdentityBundle();
  const filePath = await save({
    defaultPath: "my-libmaly-identity.json",
    filters: [{ name: "Libmaly Identity Bundle", extensions: ["json"] }],
  });
  if (!filePath) return; // user cancelled
  await invoke("save_string_to_file", { path: filePath, content: bundleJson });
}

/** Prompt the user to open a bundle file and return the parsed profile. */
export async function importIdentityFromFile(): Promise<SocialIdentityProfile | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Libmaly Identity Bundle", extensions: ["json"] }],
  });
  if (!selected) return null; // user cancelled
  const filePath = typeof selected === "string" ? selected : (selected as string[])[0];
  const bundleJson = await invoke<string>("read_string_from_file", { path: filePath });
  return invokeImportIdentityBundle(bundleJson);
}

// ── Utility helpers ────────────────────────────────────────────────────────────

/** Format a Unix-seconds timestamp as a short locale date string. */
export function formatCreatedAt(secs: number): string {
  if (!secs) return "Unknown";
  return new Date(secs * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
