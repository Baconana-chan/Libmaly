import { invoke } from "@tauri-apps/api/core";

type StorageBootstrap = {
  portable: boolean;
  entries: Record<string, string>;
};

let initialized = false;
let portableMode = false;
const portableEntries = new Map<string, string>();
let flushTimer: number | null = null;

function hasTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function schedulePortableFlush() {
  if (!portableMode || !hasTauri()) return;
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const entries = Object.fromEntries(portableEntries.entries());
    invoke("persist_storage_snapshot", { entries }).catch(() => {});
  }, 200);
}

export async function initAppStorage() {
  if (initialized) return;
  initialized = true;
  if (!hasTauri()) return;

  try {
    const bootstrap = await invoke<StorageBootstrap>("get_storage_bootstrap");
    if (!bootstrap?.portable) return;
    portableMode = true;
    for (const [k, v] of Object.entries(bootstrap.entries || {})) {
      portableEntries.set(k, v);
    }

    // First portable run migration: copy current localStorage into portable file.
    if (portableEntries.size === 0) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          const val = localStorage.getItem(key);
          if (val !== null) portableEntries.set(key, val);
        }
      } catch {}
      schedulePortableFlush();
    }
  } catch {
    portableMode = false;
  }
}

export function appStorageGetItem(key: string): string | null {
  if (portableMode) {
    return portableEntries.get(key) ?? null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function appStorageSetItem(key: string, value: string) {
  if (portableMode) {
    portableEntries.set(key, value);
    schedulePortableFlush();
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {}
}

