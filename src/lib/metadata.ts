// ─── Metadata — Tauri platform adapter ───────────────────────────────────────
// All pure utility functions live in src/core/metadataUtils.ts.
// This module re-exports everything from there and adds the Tauri invoke wrappers.

import { invoke } from "@tauri-apps/api/core";
import type { GameMetadata } from "../types";

export * from "../core/metadataUtils";

// ─── Tauri invoke wrappers ────────────────────────────────────────────────────

export async function invokeMetadataForUrl(url: string) {
  return invoke<GameMetadata>("fetch_metadata_for_url", { url });
}

export async function invokeMetadataBySource(source: string, url: string) {
  return invoke<GameMetadata>("fetch_metadata_by_source", { source, url });
}