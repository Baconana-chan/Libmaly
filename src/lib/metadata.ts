// ─── Metadata Utility Functions ───────────────────────────────────────────────
// Pure utility functions for merging, normalising, and post-processing
// game metadata snapshots. Extracted from App.tsx.

import { invoke } from "@tauri-apps/api/core";
import type {
  GameMetadata,
  MetadataSourceSnapshot,
  MetadataSourceLink,
  MetadataCleanupRule,
  MetadataPostProcessingConfig,
} from "../types";
import { METADATA_SOURCE_PRIORITY } from "../types";

// ─── Invoke helpers ───────────────────────────────────────────────────────────

export async function invokeMetadataForUrl(url: string) {
  return invoke<GameMetadata>("fetch_metadata_for_url", { url });
}

export async function invokeMetadataBySource(source: string, url: string) {
  return invoke<GameMetadata>("fetch_metadata_by_source", { source, url });
}

// ─── String utilities ─────────────────────────────────────────────────────────

export function metadataSourceRank(source?: string | null, customOrder?: string[]) {
  const normalized = (source || "").trim().toLowerCase();
  if (customOrder && customOrder.length > 0) {
    const idx = customOrder.indexOf(normalized);
    return idx === -1 ? customOrder.length + 1 : idx;
  }
  const idx = METADATA_SOURCE_PRIORITY.indexOf(normalized as typeof METADATA_SOURCE_PRIORITY[number]);
  return idx === -1 ? METADATA_SOURCE_PRIORITY.length + 1 : idx;
}

export function isNonEmptyMetadataString(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function sanitizeMetadataString(value?: string | null) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (/^\{\{[\s\S]+\}\}$/.test(normalized)) return undefined;
  return normalized;
}

export function sanitizeMetadataStringArray(values?: string[] | null) {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = sanitizeMetadataString(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

// ─── Snapshot normalisation ───────────────────────────────────────────────────

export function normalizeMetadataSnapshot(snapshot: MetadataSourceSnapshot): MetadataSourceSnapshot {
  return {
    ...snapshot,
    source: snapshot.source.trim().toLowerCase(),
    source_label: snapshot.source_label?.trim() || undefined,
    source_url: snapshot.source_url.trim(),
    title: sanitizeMetadataString(snapshot.title),
    version: sanitizeMetadataString(snapshot.version),
    developer: sanitizeMetadataString(snapshot.developer),
    publisher: sanitizeMetadataString(snapshot.publisher),
    overview: sanitizeMetadataString(snapshot.overview),
    overview_html: sanitizeMetadataString(snapshot.overview_html),
    cover_url: sanitizeMetadataString(snapshot.cover_url),
    engine: sanitizeMetadataString(snapshot.engine),
    os: sanitizeMetadataString(snapshot.os),
    language: sanitizeMetadataString(snapshot.language),
    censored: sanitizeMetadataString(snapshot.censored),
    release_date: sanitizeMetadataString(snapshot.release_date),
    last_updated: sanitizeMetadataString(snapshot.last_updated),
    rating: sanitizeMetadataString(snapshot.rating),
    price: sanitizeMetadataString(snapshot.price),
    circle: sanitizeMetadataString(snapshot.circle),
    series: sanitizeMetadataString(snapshot.series),
    author: sanitizeMetadataString(snapshot.author),
    illustration: sanitizeMetadataString(snapshot.illustration),
    voice_actor: sanitizeMetadataString(snapshot.voice_actor),
    music: sanitizeMetadataString(snapshot.music),
    age_rating: sanitizeMetadataString(snapshot.age_rating),
    product_format: sanitizeMetadataString(snapshot.product_format),
    file_format: sanitizeMetadataString(snapshot.file_format),
    file_size: sanitizeMetadataString(snapshot.file_size),
    screenshots: sanitizeMetadataStringArray(snapshot.screenshots),
    tags: sanitizeMetadataStringArray(snapshot.tags),
    genres: sanitizeMetadataStringArray(snapshot.genres),
    relations: sanitizeMetadataStringArray(snapshot.relations),
  };
}

export function metadataSnapshotFromMeta(meta: GameMetadata): MetadataSourceSnapshot | null {
  if (!isNonEmptyMetadataString(meta.source)) return null;
  return normalizeMetadataSnapshot({
    source: meta.source,
    source_label: meta.source_label,
    source_url: meta.source_url || "",
    fetchedAt: meta.fetchedAt,
    title: meta.title,
    version: meta.version,
    developer: meta.developer,
    publisher: meta.publisher,
    genres: meta.genres,
    overview: meta.overview,
    overview_html: meta.overview_html,
    cover_url: meta.cover_url,
    screenshots: meta.screenshots || [],
    tags: meta.tags || [],
    relations: meta.relations,
    engine: meta.engine,
    os: meta.os,
    language: meta.language,
    censored: meta.censored,
    release_date: meta.release_date,
    last_updated: meta.last_updated,
    rating: meta.rating,
    price: meta.price,
    circle: meta.circle,
    series: meta.series,
    author: meta.author,
    illustration: meta.illustration,
    voice_actor: meta.voice_actor,
    music: meta.music,
    age_rating: meta.age_rating,
    product_format: meta.product_format,
    file_format: meta.file_format,
    file_size: meta.file_size,
  });
}

export function metadataSnapshotsFromMeta(meta?: GameMetadata | null): MetadataSourceSnapshot[] {
  if (!meta) return [];
  const next = new Map<string, MetadataSourceSnapshot>();
  const snapshots = meta.source_snapshots ? Object.values(meta.source_snapshots) : [];
  for (const snapshot of snapshots) {
    if (!isNonEmptyMetadataString(snapshot?.source)) continue;
    const normalized = normalizeMetadataSnapshot(snapshot);
    next.set(normalized.source, normalized);
  }
  if (next.size === 0) {
    const fallback = metadataSnapshotFromMeta(meta);
    if (fallback) next.set(fallback.source, fallback);
  }
  return Array.from(next.values()).sort((a, b) => metadataSourceRank(a.source) - metadataSourceRank(b.source));
}

export function buildMetadataSourceLinks(snapshots: MetadataSourceSnapshot[]): MetadataSourceLink[] {
  return snapshots
    .filter((snapshot) => isNonEmptyMetadataString(snapshot.source_url))
    .map((snapshot) => ({ source: snapshot.source, source_label: snapshot.source_label, source_url: snapshot.source_url, fetchedAt: snapshot.fetchedAt }))
    .sort((a, b) => metadataSourceRank(a.source) - metadataSourceRank(b.source));
}

// ─── Field picking / merging ──────────────────────────────────────────────────

export function pickMetadataStringField(
  snapshotsBySource: Map<string, MetadataSourceSnapshot>,
  field:
    | "title"
    | "version"
    | "developer"
    | "publisher"
    | "overview"
    | "overview_html"
    | "cover_url"
    | "engine"
    | "os"
    | "language"
    | "censored"
    | "release_date"
    | "last_updated"
    | "rating"
    | "price"
    | "circle"
    | "series"
    | "author"
    | "illustration"
    | "voice_actor"
    | "music"
    | "age_rating"
    | "product_format"
    | "file_format"
    | "file_size",
  preferredSources?: readonly string[],
  customOrder?: string[],
): string | undefined {
  const baseFallback = customOrder && customOrder.length > 0
    ? customOrder
    : [...METADATA_SOURCE_PRIORITY];
  const order = [
    ...(preferredSources ?? []),
    ...baseFallback,
    ...Array.from(snapshotsBySource.keys()),
  ];
  const seen = new Set<string>();
  for (const source of order) {
    if (seen.has(source)) continue;
    seen.add(source);
    const candidate = snapshotsBySource.get(source)?.[field];
    if (isNonEmptyMetadataString(typeof candidate === "string" ? candidate : undefined)) {
      return candidate;
    }
  }
  return undefined;
}

export function mergeMetadataArrayField(
  snapshotsBySource: Map<string, MetadataSourceSnapshot>,
  field: "screenshots" | "tags" | "genres" | "relations",
  preferredSources?: readonly string[],
  customOrder?: string[],
) {
  const baseFallback = customOrder && customOrder.length > 0
    ? customOrder
    : [...METADATA_SOURCE_PRIORITY];
  const order = [
    ...(preferredSources ?? []),
    ...baseFallback,
    ...Array.from(snapshotsBySource.keys()),
  ];
  const seenSources = new Set<string>();
  const seenValues = new Set<string>();
  const next: string[] = [];
  for (const source of order) {
    if (seenSources.has(source)) continue;
    seenSources.add(source);
    const values = snapshotsBySource.get(source)?.[field];
    if (!Array.isArray(values)) continue;
    for (const rawValue of values) {
      const value = (rawValue || "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seenValues.has(key)) continue;
      seenValues.add(key);
      next.push(value);
    }
  }
  return next;
}

export function resolveFieldSourceOrder(
  field: string,
  defaultPreferred: string[],
  config?: MetadataPostProcessingConfig,
): { preferred: string[]; customOrder: string[] } {
  const globalOrder = config?.globalSourceOrder.length ? config.globalSourceOrder : [];
  const fieldOverride = config?.fieldSourceOverrides.find(
    (o) => o.field === field || o.field === "*",
  );
  const preferred = fieldOverride?.sources.length
    ? fieldOverride.sources
    : defaultPreferred;
  return { preferred, customOrder: globalOrder };
}

export function mergeMetadataSnapshots(
  inputSnapshots: MetadataSourceSnapshot[],
  config?: MetadataPostProcessingConfig,
): GameMetadata {
  const globalOrder = config?.globalSourceOrder.length ? config.globalSourceOrder : [];
  const snapshots = inputSnapshots
    .filter((snapshot) => isNonEmptyMetadataString(snapshot.source))
    .map(normalizeMetadataSnapshot);
  const snapshotsBySource = new Map<string, MetadataSourceSnapshot>();
  for (const snapshot of snapshots) {
    snapshotsBySource.set(snapshot.source, snapshot);
  }
  const rank = (src: string) => metadataSourceRank(src, globalOrder.length ? globalOrder : undefined);
  const aggregatedSources = Array.from(snapshotsBySource.keys()).sort((a, b) => rank(a) - rank(b));
  const sourceLinks = buildMetadataSourceLinks(Array.from(snapshotsBySource.values()));
  const primaryLink = sourceLinks[0] ?? null;
  const fetchedAt = Array.from(snapshotsBySource.values()).reduce<number | undefined>((latest, snapshot) => {
    if (!snapshot.fetchedAt) return latest;
    return latest ? Math.max(latest, snapshot.fetchedAt) : snapshot.fetchedAt;
  }, undefined);

  const pick = (field: Parameters<typeof pickMetadataStringField>[1], def: string[]) => {
    const { preferred, customOrder } = resolveFieldSourceOrder(field, def, config);
    return pickMetadataStringField(snapshotsBySource, field, preferred, customOrder);
  };
  const arr = (field: "screenshots" | "tags" | "genres" | "relations", def: string[]) => {
    const { preferred, customOrder } = resolveFieldSourceOrder(field, def, config);
    return mergeMetadataArrayField(snapshotsBySource, field, preferred, customOrder);
  };

  const merged: GameMetadata = {
    source: primaryLink?.source ?? aggregatedSources[0] ?? "",
    source_label: primaryLink?.source_label ?? snapshotsBySource.get(primaryLink?.source ?? aggregatedSources[0] ?? "")?.source_label,
    source_url: primaryLink?.source_url ?? "",
    fetchedAt,
    title: pick("title", ["f95", "dlsite", "vndb"]),
    version: pick("version", ["f95", "dlsite", "mangagamer", "johren", "fakku", "vndb"]),
    developer: pick("developer", ["dlsite", "f95", "mangagamer", "johren", "fakku", "vndb"]),
    publisher: pick("publisher", ["dlsite", "vndb", "igdb", "rawg", "mobygames"]),
    genres: arr("genres", ["vndb", "igdb", "rawg", "mobygames"]),
    overview: pick("overview", ["dlsite", "f95", "fakku", "mangagamer", "johren", "vndb"]),
    overview_html: pick("overview_html", ["dlsite", "fakku", "mangagamer", "johren"]),
    cover_url: pick("cover_url", ["vndb", "dlsite", "f95", "fakku", "igdb", "rawg", "mobygames"]),
    screenshots: arr("screenshots", ["vndb", "dlsite", "f95", "igdb", "rawg", "mobygames"]),
    tags: arr("tags", ["f95", "dlsite", "vndb", "igdb", "rawg", "mobygames"]),
    relations: arr("relations", ["vndb", "igdb", "rawg", "mobygames"]),
    engine: pick("engine", ["f95", "vndb", "igdb", "rawg"]),
    os: pick("os", ["dlsite", "f95", "vndb"]),
    language: pick("language", ["dlsite", "vndb", "f95"]),
    censored: pick("censored", ["dlsite", "f95", "fakku"]),
    release_date: pick("release_date", ["vndb", "dlsite", "f95", "igdb", "rawg", "mobygames"]),
    last_updated: pick("last_updated", ["f95", "dlsite", "rawg", "mobygames"]),
    rating: pick("rating", ["dlsite", "f95", "igdb", "rawg", "mobygames"]),
    price: pick("price", ["dlsite", "fakku", "mangagamer", "johren", "rawg"]),
    circle: pick("circle", ["dlsite"]),
    series: pick("series", ["dlsite", "vndb"]),
    author: pick("author", ["dlsite"]),
    illustration: pick("illustration", ["dlsite"]),
    voice_actor: pick("voice_actor", ["dlsite"]),
    music: pick("music", ["dlsite"]),
    age_rating: pick("age_rating", ["dlsite", "fakku"]),
    product_format: pick("product_format", ["dlsite"]),
    file_format: pick("file_format", ["dlsite"]),
    file_size: pick("file_size", ["dlsite"]),
    source_links: sourceLinks,
    source_snapshots: Object.fromEntries(Array.from(snapshotsBySource.entries())),
    aggregated_sources: aggregatedSources,
  };
  return config ? applyMetadataPostProcessing(merged, config) : merged;
}

// ─── Post-processing / cleanup ────────────────────────────────────────────────

export function applyCleanupRuleToString(value: string, rule: MetadataCleanupRule): string {
  try {
    switch (rule.type) {
      case "regex_replace": {
        if (!rule.pattern) return value;
        const regex = new RegExp(rule.pattern, "g");
        return value.replace(regex, rule.replacement ?? "");
      }
      case "trim_prefix":
        return rule.pattern && value.toLowerCase().startsWith(rule.pattern.toLowerCase())
          ? value.slice(rule.pattern.length).trimStart()
          : value;
      case "trim_suffix":
        return rule.pattern && value.toLowerCase().endsWith(rule.pattern.toLowerCase())
          ? value.slice(0, value.length - rule.pattern.length).trimEnd()
          : value;
      case "strip_brackets":
        return value.replace(/^[\[\({](.+)[\]\)}]$/, "$1").trim();
      case "lowercase_all":
        return value.toLowerCase();
      case "uppercase_first":
        return value.charAt(0).toUpperCase() + value.slice(1);
      default:
        return value;
    }
  } catch {
    return value;
  }
}

export function applyMetadataPostProcessing(
  meta: GameMetadata,
  config: MetadataPostProcessingConfig,
): GameMetadata {
  if (!config.cleanupRules.length) return meta;
  const activeRules = config.cleanupRules.filter((r) => r.enabled);
  if (!activeRules.length) return meta;

  const applyToString = (field: string, value: string | undefined): string | undefined => {
    if (!value) return value;
    let v = value;
    for (const rule of activeRules) {
      if (rule.field !== field && rule.field !== "*") continue;
      if (rule.type === "exclude_item") continue; // only for arrays
      v = applyCleanupRuleToString(v, rule);
    }
    return v.trim() || undefined;
  };

  const applyToArray = (field: string, values: string[] | undefined): string[] | undefined => {
    if (!values) return values;
    const result: string[] = [];
    for (const rawVal of values) {
      let v = rawVal;
      let excluded = false;
      for (const rule of activeRules) {
        if (rule.field !== field && rule.field !== "*") continue;
        if (rule.type === "exclude_item") {
          if (rule.pattern) {
            try {
              excluded = new RegExp(rule.pattern, "i").test(v);
            } catch {
              excluded = v.toLowerCase().includes(rule.pattern.toLowerCase());
            }
            if (excluded) break;
          }
          continue;
        }
        v = applyCleanupRuleToString(v, rule);
      }
      if (!excluded && v.trim()) result.push(v.trim());
    }
    // deduplicate after transforms
    const seen = new Set<string>();
    return result.filter((x) => {
      const key = x.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    ...meta,
    title: applyToString("title", meta.title),
    developer: applyToString("developer", meta.developer),
    publisher: applyToString("publisher", meta.publisher),
    overview: applyToString("overview", meta.overview),
    engine: applyToString("engine", meta.engine),
    version: applyToString("version", meta.version),
    release_date: applyToString("release_date", meta.release_date),
    circle: applyToString("circle", meta.circle),
    tags: applyToArray("tags", meta.tags) ?? [],
    genres: applyToArray("genres", meta.genres),
  };
}

export function mergeMetadataWithSnapshot(
  existing: GameMetadata | undefined,
  incoming: GameMetadata | MetadataSourceSnapshot,
  config?: MetadataPostProcessingConfig,
) {
  const existingSnapshots = metadataSnapshotsFromMeta(existing);
  const incomingSnapshot = "source_snapshots" in incoming || "aggregated_sources" in incoming || "source_links" in incoming
    ? metadataSnapshotFromMeta(incoming as GameMetadata)
    : normalizeMetadataSnapshot(incoming as MetadataSourceSnapshot);
  const nextSnapshots = incomingSnapshot ? [...existingSnapshots, incomingSnapshot] : existingSnapshots;
  return mergeMetadataSnapshots(nextSnapshots, config);
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function metadataHasLinkedSources(meta?: GameMetadata | null) {
  return metadataSnapshotsFromMeta(meta).some((snapshot) => isNonEmptyMetadataString(snapshot.source_url));
}

export function metadataUsesSource(meta: GameMetadata | undefined, source: string) {
  if (!meta) return false;
  return metadataSnapshotsFromMeta(meta).some((snapshot) => snapshot.source === source);
}

export function metadataSourceSummary(meta?: GameMetadata | null) {
  if (!meta) return "";
  const snapshots = metadataSnapshotsFromMeta(meta);
  const sources = meta.aggregated_sources?.length ? meta.aggregated_sources : snapshots.map((snapshot) => snapshot.source);
  return Array.from(new Set(sources)).map((source) => snapshots.find((snapshot) => snapshot.source === source)?.source_label || metadataSourceLabel(source)).join(" + ");
}

// ─── Inline helper (re-exported from helpers.ts to avoid import cycle) ────────
// metadataSourceLabel comes from helpers.ts; imported here for convenience.
import { metadataSourceLabel } from "./helpers";
export { metadataSourceLabel };
