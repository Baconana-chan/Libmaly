interface GameMetadataLike {
  source?: string;
  age_rating?: string;
  tags?: string[];
}

interface AppSettingsLike {
  blurNsfwContent: boolean;
}

function isGameAdult(meta?: GameMetadataLike): boolean {
  if (!meta) return false;
  if (meta.source === "f95" || meta.source === "dlsite") return true;
  if (meta.age_rating && meta.age_rating.toLowerCase().includes("18")) return true;
  return meta.tags?.some((t) => ["adult", "nsfw", "18+", "18", "eroge"].includes(t.toLowerCase())) ?? false;
}

export function NsfwOverlay({
  gamePath,
  meta,
  appSettings,
  revealed,
  onReveal,
  small,
}: {
  gamePath: string;
  meta?: GameMetadataLike;
  appSettings: AppSettingsLike;
  revealed: Record<string, boolean>;
  onReveal: (path: string) => void;
  small?: boolean;
}) {
  if (!appSettings.blurNsfwContent || !isGameAdult(meta) || revealed[gamePath]) return null;
  return (
    <div
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer ${small ? "backdrop-blur-sm bg-black/20" : "backdrop-blur-xl bg-black/40"}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onReveal(gamePath);
      }}
    >
      {!small && (
        <>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-white)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 mb-1">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
          <span className="text-[10px] uppercase font-bold text-white opacity-80 px-2 py-0.5 rounded shadow-sm" style={{ background: "rgba(0,0,0,0.6)" }}>
            18+ Content
          </span>
        </>
      )}
    </div>
  );
}

