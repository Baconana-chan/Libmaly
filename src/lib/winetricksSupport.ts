/** Helpers for winetricks error interpretation and prefix media before/after diffs */

export interface MediaDiagFlags {
  has_media_foundation: boolean;
  has_quartz: boolean;
  has_wmp: boolean;
  has_lavfilters: boolean;
  has_wmv_decoder: boolean;
  likely_video_playback_issue: boolean;
}

const MEDIA_FLAG_LABELS: { key: keyof MediaDiagFlags; label: string; goodWhenTrue?: boolean }[] = [
  { key: "has_media_foundation", label: "Media Foundation (mfplat/mf)" },
  { key: "has_quartz", label: "Quartz / DirectShow" },
  { key: "has_wmp", label: "Windows Media Player stack" },
  { key: "has_lavfilters", label: "LAV Filters" },
  { key: "has_wmv_decoder", label: "WMV decoder (wmvcore)" },
  { key: "likely_video_playback_issue", label: "Likely intro-video issue (heuristic)", goodWhenTrue: false },
];

function flagOk(key: keyof MediaDiagFlags, v: boolean): boolean {
  const meta = MEDIA_FLAG_LABELS.find((x) => x.key === key);
  if (meta?.goodWhenTrue === false) return !v;
  return v;
}

function flagLabel(key: keyof MediaDiagFlags): string {
  return MEDIA_FLAG_LABELS.find((x) => x.key === key)?.label ?? key;
}

export function diffPrefixMediaDiagnostics(before: MediaDiagFlags, after: MediaDiagFlags): string[] {
  const lines: string[] = [];
  for (const { key } of MEDIA_FLAG_LABELS) {
    if (before[key] === after[key]) continue;
    const b = flagOk(key, before[key]) ? "ok" : "missing/problem";
    const a = flagOk(key, after[key]) ? "ok" : "missing/problem";
    lines.push(`${flagLabel(key)}: ${b} → ${a}`);
  }
  if (lines.length === 0) {
    lines.push(
      "Scanned DLL markers did not change. The install may still be useful (pending reboot, different paths), or winetricks exited without applying files.",
    );
  }
  return lines;
}

/**
 * Turn raw winetricks / spawn errors into short actionable hints (best-effort).
 */
export function explainWinetricksFailure(raw: string): string[] {
  const s = raw.toLowerCase();
  const hints: string[] = [];

  if (s.includes("404") || (s.includes("not found") && (s.includes("http") || s.includes("download") || s.includes("wget") || s.includes("curl")))) {
    hints.push("Download or mirror failure — check your network, proxy, and try `winetricks --self-update` or another WINETRICKS_DOWNLOADER (aria2c, wget, curl).");
  }
  if (s.includes("permission denied") || s.includes("eacces") || s.includes("operation not permitted")) {
    hints.push("Permission error — ensure WINEPREFIX is writable, not on a noexec filesystem, and you are not mixing root-owned prefix files with your user.");
  }
  if (s.includes("no space") || s.includes("enospc")) {
    hints.push("Disk full — free space in the partition that holds the Wine prefix and temp directories.");
  }
  if (
    (s.includes("winetricks") && s.includes("not found")) ||
    (s.includes("no such file or directory") && s.includes("winetricks"))
  ) {
    hints.push("winetricks is not installed or not on PATH — install your distro’s `winetricks` package or place the script on PATH.");
  }
  if (s.includes("wine") && (s.includes("not found") || s.includes("failed"))) {
    hints.push("Wine failed to start — verify `which wine`, WINEARCH, and that the prefix is not corrupted (`wineboot -u` in that prefix).");
  }
  if (s.includes("cabextract") || s.includes("unshield") || s.includes("unzip") || s.includes("7z")) {
    hints.push("Missing archive tool — install `cabextract`, `unzip`, `p7zip-full`, or whatever the log names.");
  }
  if (s.includes("sha256") || s.includes("checksum") || s.includes("mismatch")) {
    hints.push("Checksum mismatch — delete the winetricks cache for this verb and retry, or update winetricks.");
  }
  if (s.includes("wmp11") || s.includes("windows media player")) {
    hints.push("WMP11 is often heavy on Proton prefixes — try mf + quartz + lavfilters first (see LIBMALY media presets).");
  }
  if (s.includes("already installed") || s.includes("already present")) {
    hints.push("Winetricks thinks the component is already present — use Refresh in Wine settings to re-scan the prefix, or remove the verb from the queue.");
  }
  if (s.includes("connection refused") || s.includes("timed out") || s.includes("temporary failure")) {
    hints.push("Network timeout — retry later; corporate firewalls sometimes block winetricks CDN URLs.");
  }

  if (hints.length === 0) {
    hints.push("Read the log fragment above, then verify: winetricks on PATH, helper tools installed, prefix path correct, and enough disk space.");
  }

  return [...new Set(hints)];
}

export function formatWinetricksErrorWithHints(raw: string): string {
  const trimmed = raw.trim();
  const hints = explainWinetricksFailure(trimmed);
  return `Winetricks reported a failure.\n\n${trimmed}\n\nSuggested next steps:\n${hints.map((h) => `• ${h}`).join("\n")}`;
}
