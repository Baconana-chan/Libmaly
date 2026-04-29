export interface ShaderCacheArtifact {
  path: string;
  size: number;
  kind: string;
}

/** Matches Rust `ShaderCacheDiscovery` JSON (snake_case). */
export interface ShaderCacheDiscovery {
  game_exe_path: string;
  game_dir: string;
  dxvk_caches: ShaderCacheArtifact[];
  steam_app_id: string | null;
  steam_shader_cache_path: string | null;
  steam_shader_cache_bytes: number;
  steam_shader_cache_files: number;
  hints: string[];
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Short lines for the game detail strip (Wine + DXVK / Steam caches).
 */
export function buildShaderWarmupLines(opts: {
  wineActive: boolean;
  prefixHasDxvk?: boolean;
  discovery: ShaderCacheDiscovery | null;
  engine?: string;
}): string[] {
  if (!opts.wineActive) return [];
  const out: string[] = [];
  const eng = (opts.engine ?? "").toLowerCase();
  const likelyHeavy =
    eng.includes("unity") ||
    eng.includes("unreal") ||
    eng.includes("directx") ||
    eng.includes("vulkan") ||
    eng.includes("opengl") ||
    !opts.engine?.trim();
  if (likelyHeavy && opts.prefixHasDxvk !== false) {
    out.push(
      "First runs can hitch while DXVK builds its state cache — play a few minutes or reuse a shared .dxvk-cache.",
    );
  }
  const d = opts.discovery;
  if (d) {
    const dxvkTotal = d.dxvk_caches.reduce((a, x) => a + (x.size || 0), 0);
    if (d.dxvk_caches.length === 0) {
      out.push("No .dxvk-cache next to this exe yet (created after the first launch under DXVK).");
    } else {
      out.push(
        `DXVK state cache: ${d.dxvk_caches.length} file(s), ${fmtBytes(dxvkTotal)} — safe to back up or share for this build.`,
      );
    }
    if (d.steam_app_id) {
      if (d.steam_shader_cache_bytes > 0) {
        out.push(
          `Steam shader cache (app ${d.steam_app_id}): ${fmtBytes(d.steam_shader_cache_bytes)} · ${d.steam_shader_cache_files} files.`,
        );
      } else {
        out.push(
          `Steam App ID ${d.steam_app_id} set — no Fossilize folder found yet under default Steam paths.`,
        );
      }
    }
    for (const h of d.hints.slice(0, 2)) {
      if (!out.includes(h)) out.push(h);
    }
  }
  return out;
}

/** Winetricks verb bundles for non-media compatibility (prefix manager). */
export const WINE_COMPATIBILITY_PRESETS: { label: string; verbs: string[]; title: string }[] = [
  { label: "Fonts", verbs: ["corefonts"], title: "Microsoft core fonts" },
  { label: "XAct", verbs: ["xact"], title: "XAudio2 / XAct" },
  { label: "DirectShow", verbs: ["directshow", "quartz"], title: "DirectShow baseline" },
  { label: "VC++ / D3D", verbs: ["vcrun2019", "d3dx9"], title: "Common redistributables" },
  { label: "Input", verbs: ["xinput"], title: "XInput" },
  {
    label: "Starter pack",
    verbs: ["corefonts", "xact", "vcrun2019", "d3dx9", "xinput"],
    title: "Fonts + audio + VC + D3D + input",
  },
];
