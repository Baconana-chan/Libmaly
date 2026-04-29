// ─── Libmaly Shared Core ──────────────────────────────────────────────────────
//
// Platform-agnostic data logic that can be consumed by any surface — Tauri
// desktop, future mobile (Capacitor / React Native) or web — without pulling
// in layout code or platform-specific APIs.
//
// Import from this barrel for convenience:
//   import { formatTime, mergeMetadataSnapshots } from "../core";
//
// Tauri-specific adapters (invoke wrappers, storage) live in src/lib/ and
// should NOT be imported from here.

export * from "./constants";
export * from "./gameAchievements";
export * from "./helpers";
export * from "./game";
export * from "./layout";
export * from "./mediaPlaybackKnowledge";
export * from "./scanner";
export * from "./shaderCache";
export * from "./winetricksSupport";
export * from "./syncTypes";
export * from "./metadataUtils";
