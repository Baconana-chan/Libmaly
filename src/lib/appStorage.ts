import { invoke } from "@tauri-apps/api/core";

type StorageBootstrap = {
  unified: boolean;
  entries: Record<string, string>;
};

let initialized = false;
let unifiedMode = false;
const unifiedEntries = new Map<string, string>();
let flushTimer: number | null = null;
let activeProfileId = "default";

const GLOBAL_STORAGE_KEYS = new Set<string>([
  "libmaly_last_seen_version",
]);

function hasTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function profileStorageKey(key: string) {
  if (GLOBAL_STORAGE_KEYS.has(key)) return key;
  return `libmaly_profile::${activeProfileId}::${key}`;
}

function shouldUseLegacyFallback(key: string) {
  return activeProfileId === "default" && !GLOBAL_STORAGE_KEYS.has(key);
}

function scheduleUnifiedFlush() {
  if (!unifiedMode || !hasTauri()) return;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const entries = Object.fromEntries(unifiedEntries.entries());
    invoke("persist_storage_snapshot", { entries }).catch(() => {});
  }, 200);
}

export async function initAppStorage() {
  if (initialized) return;
  initialized = true;
  if (!hasTauri()) return;

  try {
    const bootstrap = await invoke<StorageBootstrap>("get_storage_bootstrap");
    if (!bootstrap?.unified) return;
    unifiedMode = true;
    for (const [k, v] of Object.entries(bootstrap.entries || {})) {
      unifiedEntries.set(k, v);
    }

    // First run migration: copy current localStorage into unified state store.
    if (unifiedEntries.size === 0) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          const val = localStorage.getItem(key);
          if (val !== null) unifiedEntries.set(key, val);
        }
      } catch {}
      scheduleUnifiedFlush();
    }
  } catch {
    unifiedMode = false;
  }
}

export function setAppStorageProfile(profileId: string) {
  const trimmed = (profileId || "").trim();
  activeProfileId = trimmed || "default";
}

export function getAppStorageProfile() {
  return activeProfileId;
}

export function appStorageGetItem(key: string): string | null {
  const scopedKey = profileStorageKey(key);
  if (unifiedMode) {
    const value = unifiedEntries.get(scopedKey);
    if (value !== undefined) return value;
    if (shouldUseLegacyFallback(key)) {
      return unifiedEntries.get(key) ?? null;
    }
    return null;
  }
  try {
    const value = localStorage.getItem(scopedKey);
    if (value !== null) return value;
    if (shouldUseLegacyFallback(key)) {
      return localStorage.getItem(key);
    }
    return null;
  } catch {
    return null;
  }
}

export function appStorageSetItem(key: string, value: string) {
  const scopedKey = profileStorageKey(key);
  if (unifiedMode) {
    unifiedEntries.set(scopedKey, value);
    scheduleUnifiedFlush();
    return;
  }
  try {
    localStorage.setItem(scopedKey, value);
  } catch {}
}

export function appStorageRemoveItem(key: string) {
  const scopedKey = profileStorageKey(key);
  if (unifiedMode) {
    unifiedEntries.delete(scopedKey);
    if (shouldUseLegacyFallback(key)) {
      unifiedEntries.delete(key);
    }
    scheduleUnifiedFlush();
    return;
  }
  try {
    localStorage.removeItem(scopedKey);
    if (shouldUseLegacyFallback(key)) {
      localStorage.removeItem(key);
    }
  } catch {}
}
