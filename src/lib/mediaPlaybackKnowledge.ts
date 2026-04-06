/**
 * Known-issues knowledge base + per-game intro-video risk heuristics for Wine/Proton.
 * Combines prefix-level detection (Rust) with engine / path / exe hints from metadata.
 */

import { normalizePathNoCase, pathBasename, pathDirname } from "./helpers";

export type IntroVideoReliance = "none" | "low" | "medium" | "high";

export type EffectiveIntroRisk = "minimal" | "low" | "moderate" | "significant";

export interface PrefixMediaDiagnosticsLike {
  likely_video_playback_issue: boolean;
  summary: string;
  recommended_verbs: string[];
  notes?: string[];
}

export interface EngineMediaKnowledgeRule {
  id: string;
  label: string;
  /** Lowercase substrings matched against metadata.engine */
  enginePatterns?: string[];
  /** Lowercase substrings matched against install path */
  pathPatterns?: string[];
  /** Lowercase exe filenames (e.g. renpy.exe) */
  exePatterns?: string[];
  introReliance: IntroVideoReliance;
  /** Extra winetricks verbs often helpful for this stack */
  extraVerbs?: string[];
  /** Caveats / known-bad combinations (human-readable) */
  caveats?: string[];
  notes?: string[];
}

/** Documented gotchas not tied to a single engine id */
export interface MediaPlaybackGotcha {
  id: string;
  title: string;
  detail: string;
}

const RELIANCE_RANK: Record<IntroVideoReliance, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function maxReliance(a: IntroVideoReliance, b: IntroVideoReliance): IntroVideoReliance {
  return RELIANCE_RANK[a] >= RELIANCE_RANK[b] ? a : b;
}

/**
 * Curated rules: engines and folder layouts that correlate with WMV/DirectShow/MF intro issues.
 */
export const ENGINE_MEDIA_KNOWLEDGE: EngineMediaKnowledgeRule[] = [
  {
    id: "rpg_maker",
    label: "RPG Maker",
    enginePatterns: ["rpg maker", "rpgmaker", "rgss", "rpg maker vx", "rpg maker xp", "rpg maker mv", "rpg maker mz"],
    pathPatterns: ["/www/data/", "\\www\\data\\", "rpgmvp", "rpgvx", "rpgxp", "/audio/bgm/", "\\audio\\bgm\\"],
    exePatterns: [],
    introReliance: "high",
    extraVerbs: [],
    caveats: [
      "On Proton, wmp11 can be slow or fail; if so, try quartz + lavfilters before repeating wmp11.",
    ],
    notes: ["Many RPG Maker titles use WMV or legacy AVI for logos and intros."],
  },
  {
    id: "wolf_rpg",
    label: "WOLF RPG Editor",
    enginePatterns: ["wolf rpg", "wolf rpg editor", "wolf rpg editor pro", "wolfeditor"],
    pathPatterns: ["wolf rpg editor", "wolf rpg"],
    exePatterns: [],
    introReliance: "high",
    notes: ["Older Japanese indie titles often rely on DirectShow-style playback for intros."],
  },
  {
    id: "kirkiri",
    label: "KiriKiri / KRKR",
    enginePatterns: ["kirikiri", "krkr"],
    pathPatterns: ["/data.xp3", "\\data.xp3", "/patch.xp3", "\\patch.xp3"],
    exePatterns: [],
    introReliance: "high",
    notes: ["KiriKiri games frequently use WMV or MPEG-1 in openings."],
  },
  {
    id: "livemaker",
    label: "LiveMaker",
    enginePatterns: ["livemaker", "live maker"],
    introReliance: "high",
    notes: ["LiveMaker-era titles often depend on older Windows media codecs for OP movies."],
  },
  {
    id: "renpy",
    label: "Ren'Py",
    enginePatterns: ["ren'py", "renpy"],
    exePatterns: ["renpy.exe"],
    introReliance: "medium",
    notes: ["Modern Ren'Py bundles ffmpeg; some ports, mods, or older builds still hit system codec paths."],
  },
  {
    id: "unity",
    label: "Unity",
    enginePatterns: ["unity"],
    introReliance: "medium",
    caveats: [
      "Unity itself varies: some games use in-engine VideoPlayer (less MF-dependent), others ship WMV in StreamingAssets.",
    ],
    notes: ["Missing MF/Quartz still correlates with black-screen splash/intro videos."],
  },
  {
    id: "unreal",
    label: "Unreal Engine",
    enginePatterns: ["unreal engine", "unreal"],
    introReliance: "medium",
    notes: ["Bink or in-engine media; broken MF can still affect some publisher splash movies."],
  },
  {
    id: "godot",
    label: "Godot",
    enginePatterns: ["godot"],
    introReliance: "low",
    notes: ["Typically Ogg/Theora or WebM; less tied to Windows Media stack."],
  },
  {
    id: "electron_nwjs",
    label: "Electron / NW.js",
    enginePatterns: ["electron", "nw.js", "nwjs", "chromium embedded"],
    introReliance: "low",
    notes: ["Chromium-based wrappers usually decode via bundled codecs, not WMP pipelines."],
  },
  {
    id: "tyrano",
    label: "TyranoBuilder",
    enginePatterns: ["tyrano", "tyranobuilder"],
    introReliance: "low",
    notes: ["Mostly HTML5 video; lower chance of classic DirectShow failures."],
  },
  {
    id: "steam_stub",
    label: "Steam / third-party launcher shell",
    exePatterns: ["steam.exe", "galaxyclient.exe", "launch.exe"],
    introReliance: "none",
    notes: ["Launcher executables are weak signals; metadata engine is preferred when present."],
  },
];

export function findMatchingWinePrefixEntry<T extends { path: string }>(
  prefixes: T[],
  effectivePrefix: string,
): T | undefined {
  const ep = effectivePrefix.trim();
  if (!ep) return undefined;
  return prefixes.find(
    (p) =>
      normalizePathNoCase(p.path) === normalizePathNoCase(ep) ||
      normalizePathNoCase(pathDirname(p.path)) === normalizePathNoCase(ep),
  );
}

export function resolveEffectiveWinePrefix(
  platform: string,
  opts: {
    runnerOverrideEnabled?: boolean;
    runnerOverride?: { prefixPath?: string } | null;
    globalLaunchEnabled: boolean;
    globalPrefixPath?: string;
  },
): string | null {
  if (platform === "windows") return null;
  if (opts.runnerOverrideEnabled && opts.runnerOverride?.prefixPath?.trim()) {
    return opts.runnerOverride.prefixPath.trim();
  }
  if (opts.globalLaunchEnabled && opts.globalPrefixPath?.trim()) {
    return opts.globalPrefixPath.trim();
  }
  return null;
}

export const MEDIA_PLAYBACK_GOTCHAS: MediaPlaybackGotcha[] = [
  {
    id: "proton_wmp11",
    title: "Proton / Steam prefixes and wmp11",
    detail:
      "Installing Windows Media Player via winetricks into a Proton compatdata prefix sometimes fails or takes a long time. Prefer mf + quartz + lavfilters first, then retry wmp11 only if intros are still broken.",
  },
  {
    id: "mf_without_quartz",
    title: "MF without Quartz for legacy titles",
    detail:
      "Media Foundation alone does not replace older DirectShow graphs. RPG Maker, KiriKiri, and similar stacks often still need quartz (and sometimes wmp11) even when mfplat.dll is present.",
  },
  {
    id: "lavfilters_last_resort",
    title: "LAV Filters as fallback",
    detail:
      "lavfilters can unblock odd codecs but is not a full substitute for every WMP-dependent game. Combine with quartz when intros stay black.",
  },
];

export interface GameMediaPlaybackContext {
  introVideoReliance: IntroVideoReliance;
  matchedRules: { id: string; label: string }[];
  extraVerbs: string[];
  knowledgeNotes: string[];
  caveats: string[];
}

export function assessGameMediaPlaybackContext(input: {
  engine?: string | null;
  gamePath: string;
  /** Optional resolved launch exe (override or game path) */
  launchExePath?: string | null;
}): GameMediaPlaybackContext {
  const engineLo = (input.engine ?? "").toLowerCase();
  const pathLo = input.gamePath.toLowerCase().replace(/\\/g, "/");
  const exeLo = pathBasename(input.launchExePath || input.gamePath).toLowerCase();

  let introVideoReliance: IntroVideoReliance = "none";
  const matchedRules: { id: string; label: string }[] = [];
  const extraVerbs: string[] = [];
  const knowledgeNotes: string[] = [];
  const caveats: string[] = [];

  for (const rule of ENGINE_MEDIA_KNOWLEDGE) {
    const engHit = (rule.enginePatterns ?? []).some((p) => p && engineLo.includes(p));
    const pathHit = (rule.pathPatterns ?? []).some((p) => p && pathLo.includes(p.replace(/\\/g, "/")));
    const exeHit = (rule.exePatterns ?? []).some((p) => p && exeLo === p);

    if (!engHit && !pathHit && !exeHit) continue;

    matchedRules.push({ id: rule.id, label: rule.label });
    introVideoReliance = maxReliance(introVideoReliance, rule.introReliance);
    if (rule.extraVerbs) extraVerbs.push(...rule.extraVerbs);
    if (rule.notes) knowledgeNotes.push(...rule.notes);
    if (rule.caveats) caveats.push(...rule.caveats);
  }

  const extraVerbsDedup = [...new Set(extraVerbs)].sort();

  return {
    introVideoReliance,
    matchedRules,
    extraVerbs: extraVerbsDedup,
    knowledgeNotes: [...new Set(knowledgeNotes)],
    caveats: [...new Set(caveats)],
  };
}

export interface PerGameMediaPlaybackAssessment {
  effectiveRisk: EffectiveIntroRisk;
  /** Whether to block launch with a confirm() — only when prefix is unhealthy */
  showLaunchWarning: boolean;
  summary: string;
  detailLines: string[];
  suggestedVerbs: string[];
  prefixSummary?: string;
  context: GameMediaPlaybackContext;
}

export function combinePrefixAndGameMedia(
  prefixMedia: PrefixMediaDiagnosticsLike | null | undefined,
  ctx: GameMediaPlaybackContext,
): PerGameMediaPlaybackAssessment {
  const suggestedVerbs = [
    ...new Set([...(prefixMedia?.recommended_verbs ?? []), ...ctx.extraVerbs]),
  ].sort();

  if (!prefixMedia) {
    return {
      effectiveRisk: "low",
      showLaunchWarning: false,
      summary:
        "Wine prefix media was not scanned (path missing from prefix list or unreadable). Intro-video risk is unknown.",
      detailLines: [],
      suggestedVerbs: ctx.extraVerbs,
      context: ctx,
    };
  }

  if (!prefixMedia.likely_video_playback_issue) {
    return {
      effectiveRisk: "minimal",
      showLaunchWarning: false,
      summary: "Prefix media stack looks sufficient for most intro videos.",
      detailLines: ctx.matchedRules.length
        ? [`Engine/profile hints: ${ctx.matchedRules.map((r) => r.label).join(", ")}.`]
        : [],
      suggestedVerbs,
      prefixSummary: prefixMedia.summary,
      context: ctx,
    };
  }

  let effectiveRisk: EffectiveIntroRisk;
  let showLaunchWarning: boolean;

  switch (ctx.introVideoReliance) {
    case "high":
      effectiveRisk = "significant";
      showLaunchWarning = true;
      break;
    case "medium":
      effectiveRisk = "moderate";
      showLaunchWarning = true;
      break;
    case "low":
      effectiveRisk = "low";
      showLaunchWarning = false;
      break;
    case "none":
    default: {
      if (ctx.matchedRules.length === 0) {
        effectiveRisk = "moderate";
        showLaunchWarning = true;
      } else {
        effectiveRisk = "low";
        showLaunchWarning = false;
      }
      break;
    }
  }

  const detailLines: string[] = [
    `Prefix: ${prefixMedia.summary}`,
    `Heuristic intro reliance: ${ctx.introVideoReliance}${ctx.matchedRules.length ? ` (${ctx.matchedRules.map((r) => r.label).join(", ")})` : " (no specific engine profile matched — treating as unknown)"}.`,
    ...prefixMedia.notes ?? [],
    ...ctx.knowledgeNotes,
    ...ctx.caveats,
  ];

  const summary =
    effectiveRisk === "significant"
      ? "High chance of broken intro/cutscene video for this engine/profile with the current prefix."
      : effectiveRisk === "moderate"
        ? "Moderate risk: prefix is missing media components and this title may use legacy video paths."
        : effectiveRisk === "low"
          ? "Prefix has gaps, but this title is less likely to depend on Windows Media / DirectShow intros."
          : "Prefix media looks OK.";

  return {
    effectiveRisk,
    showLaunchWarning,
    summary,
    detailLines,
    suggestedVerbs,
    prefixSummary: prefixMedia.summary,
    context: ctx,
  };
}

export function buildLaunchWineMediaWarningMessage(assessment: PerGameMediaPlaybackAssessment): string {
  const verbs = assessment.suggestedVerbs.length ? assessment.suggestedVerbs.join(", ") : "none";
  const lines = [
    "⚠️ Wine/Proton intro video compatibility",
    "",
    assessment.summary,
    "",
    ...assessment.detailLines.slice(0, 6),
    "",
    `Suggested winetricks verbs: ${verbs}`,
    "",
    "Launch anyway?",
  ];
  return lines.join("\n");
}
