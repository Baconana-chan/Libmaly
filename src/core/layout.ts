// ─── Layout Utility Functions ─────────────────────────────────────────────────
// Sidebar width clamping, preset capture, and slug helpers extracted from App.tsx.

import type { LayoutPresetConfig, LayoutViewMode, AppSettings } from "../types";
import { LAYOUT_SIDEBAR_SETTING_KEYS } from "../types";

export function clampSidebarWidthValue(value: number) {
  return Math.max(200, Math.min(600, Math.round(value)));
}

export function captureLayoutPresetConfig(viewMode: LayoutViewMode, sidebarWidth: number, appSettings: AppSettings): LayoutPresetConfig {
  return {
    viewMode,
    sidebarWidth: clampSidebarWidthValue(sidebarWidth),
    sidebarMinimalMode: !!appSettings.sidebarMinimalMode,
    sidebarShowNews: appSettings.sidebarShowNews !== false,
    sidebarShowStats: appSettings.sidebarShowStats !== false,
    sidebarShowSearchTools: appSettings.sidebarShowSearchTools !== false,
    sidebarShowCollections: appSettings.sidebarShowCollections !== false,
    sidebarShowDevelopers: appSettings.sidebarShowDevelopers !== false,
    sidebarShowWishlist: appSettings.sidebarShowWishlist !== false,
    sidebarShowSurpriseButton: appSettings.sidebarShowSurpriseButton !== false,
    sidebarShowGlobalNotes: appSettings.sidebarShowGlobalNotes !== false,
    sidebarShowAddButton: appSettings.sidebarShowAddButton !== false,
    sidebarShowSettingsButton: appSettings.sidebarShowSettingsButton !== false,
    sidebarShowLogsButton: appSettings.sidebarShowLogsButton !== false,
  };
}

export function layoutPresetConfigsEqual(left: LayoutPresetConfig, right: LayoutPresetConfig) {
  if (left.viewMode !== right.viewMode || left.sidebarWidth !== right.sidebarWidth || left.sidebarMinimalMode !== right.sidebarMinimalMode) {
    return false;
  }
  return LAYOUT_SIDEBAR_SETTING_KEYS.every((key) => left[key] === right[key]);
}

export function slugifyLayoutPresetName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
