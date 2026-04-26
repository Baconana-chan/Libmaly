// ─── Profile Storage Snapshot Utilities ──────────────────────────────────────
// Functions to read a complete profile snapshot from storage and build
// serialised snapshot entries for the Tauri snapshot command. Extracted from
// App.tsx to keep storage logic co-located with the storage layer.

import { appStorageGetItem, loadCache } from "./appStorage";
import {
  SK_GAMES, SK_MTIMES, SK_FOLDERS, SK_STATS, SK_META, SK_HIDDEN, SK_FAVS, SK_GHOST,
  SK_CUSTOM, SK_NOTES, SK_ACHIEVEMENTS, SK_COLLECTIONS, SK_LAUNCH, SK_RECENT, SK_ORDER,
  SK_SESSION_LOG, SK_WISHLIST, SK_HISTORY, SK_SETTINGS, SK_PATH, SK_VIEW_MODE, SK_SIDEBAR_WIDTH,
  DEFAULT_SETTINGS, DEFAULT_LAUNCH_CONFIG,
} from "./constants";
import { normalizeAchievementsMap } from "./gameAchievements";
import { mergeDefaultRssFeeds } from "./helpers";
import type {
  ProfileStorageSnapshot, AppSettings, Game, LibraryFolder,
} from "../types";

export function readProfileStorageSnapshot(): ProfileStorageSnapshot {
  const cachedSettings = loadCache(SK_SETTINGS, DEFAULT_SETTINGS) as Partial<AppSettings>;
  return {
    libraryFolders: (() => {
      const stored = loadCache<LibraryFolder[]>(SK_FOLDERS, []);
      if (stored.length > 0) return stored;
      const legacy = appStorageGetItem(SK_PATH);
      return legacy ? [{ path: legacy }] : [];
    })(),
    games: loadCache<Game[]>(SK_GAMES, []),
    stats: loadCache(SK_STATS, {}),
    metadata: loadCache(SK_META, {}),
    hiddenGames: loadCache(SK_HIDDEN, {}),
    favGames: loadCache(SK_FAVS, {}),
    ghostGames: loadCache(SK_GHOST, {}),
    customizations: loadCache(SK_CUSTOM, {}),
    notes: loadCache(SK_NOTES, {}),
    achievements: normalizeAchievementsMap(loadCache(SK_ACHIEVEMENTS, {})),
    collections: loadCache(SK_COLLECTIONS, []),
    launchConfig: loadCache(SK_LAUNCH, DEFAULT_LAUNCH_CONFIG),
    recentGames: loadCache(SK_RECENT, []),
    customOrder: loadCache(SK_ORDER, {}),
    sessionLog: loadCache(SK_SESSION_LOG, []),
    wishlist: loadCache(SK_WISHLIST, []),
    history: loadCache(SK_HISTORY, {}),
    appSettings: {
      ...DEFAULT_SETTINGS,
      ...cachedSettings,
      rssFeeds: mergeDefaultRssFeeds(cachedSettings.rssFeeds),
    },
    dirMtimes: loadCache(SK_MTIMES, []),
    viewMode: loadCache(SK_VIEW_MODE, "list"),
    sidebarWidth: loadCache(SK_SIDEBAR_WIDTH, 256),
  };
}

export function buildSnapshotEntries(payload: Omit<ProfileStorageSnapshot, "viewMode" | "sidebarWidth" | "recentGames" | "customOrder"> & {
  recentGames: ProfileStorageSnapshot["recentGames"];
  customOrder: ProfileStorageSnapshot["customOrder"];
  dirMtimes: ProfileStorageSnapshot["dirMtimes"];
}) {
  return {
    [SK_GAMES]: JSON.stringify(payload.games),
    [SK_MTIMES]: JSON.stringify(payload.dirMtimes),
    [SK_FOLDERS]: JSON.stringify(payload.libraryFolders),
    [SK_STATS]: JSON.stringify(payload.stats),
    [SK_META]: JSON.stringify(payload.metadata),
    [SK_HIDDEN]: JSON.stringify(payload.hiddenGames),
    [SK_FAVS]: JSON.stringify(payload.favGames),
    [SK_GHOST]: JSON.stringify(payload.ghostGames),
    [SK_CUSTOM]: JSON.stringify(payload.customizations),
    [SK_NOTES]: JSON.stringify(payload.notes),
    [SK_ACHIEVEMENTS]: JSON.stringify(payload.achievements),
    [SK_COLLECTIONS]: JSON.stringify(payload.collections),
    [SK_LAUNCH]: JSON.stringify(payload.launchConfig),
    [SK_RECENT]: JSON.stringify(payload.recentGames),
    [SK_ORDER]: JSON.stringify(payload.customOrder),
    [SK_SESSION_LOG]: JSON.stringify(payload.sessionLog),
    [SK_WISHLIST]: JSON.stringify(payload.wishlist),
    [SK_HISTORY]: JSON.stringify(payload.history),
    [SK_SETTINGS]: JSON.stringify(payload.appSettings),
  };
}
