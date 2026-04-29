export interface GameAchievementItem {
  id: string;
  label: string;
  done: boolean;
}

export type GameAchievementsByPath = Record<string, GameAchievementItem[]>;

export function sanitizeAchievementItems(raw: unknown): GameAchievementItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
    .map((x, i) => ({
      id: typeof x.id === "string" ? x.id : `item-${i}-${Date.now()}`,
      label: typeof x.label === "string" ? x.label : "",
      done: Boolean(x.done),
    }));
}

export function normalizeAchievementsMap(raw: unknown): GameAchievementsByPath {
  if (!raw || typeof raw !== "object") return {};
  const out: GameAchievementsByPath = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = sanitizeAchievementItems(v);
  }
  return out;
}

export function newAchievementItem(): GameAchievementItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    label: "",
    done: false,
  };
}
