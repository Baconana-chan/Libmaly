export interface ScanGame {
  name: string;
  path: string;
  uninstalled?: boolean;
}

export interface ScanDirMtime {
  path: string;
  mtime: number;
}

export function isPathInFolder(targetPath: string, folderPath: string): boolean {
  return (
    targetPath.startsWith(folderPath + "\\") ||
    targetPath.startsWith(folderPath + "/") ||
    targetPath === folderPath
  );
}

export function mergeFolderGames(
  existingGames: ScanGame[],
  scannedGames: ScanGame[],
  folderPath: string,
  hasHistoryForPath: (path: string) => boolean,
): ScanGame[] {
  const oldOther = existingGames.filter((g) => !isPathInFolder(g.path, folderPath));
  const oldFromFolder = existingGames.filter((g) => isPathInFolder(g.path, folderPath));
  const scannedPaths = new Set(scannedGames.map((g) => g.path));

  const missingGhosts = oldFromFolder
    .filter((g) => !scannedPaths.has(g.path))
    .filter((g) => hasHistoryForPath(g.path))
    .map((g) => ({ ...g, uninstalled: true }));

  const scannedClean = scannedGames.map((g) => ({ ...g, uninstalled: false }));
  return [...oldOther, ...missingGhosts, ...scannedClean];
}

export function mergeFolderMtimes(
  existingMtimes: ScanDirMtime[],
  scannedMtimes: ScanDirMtime[],
  folderPath: string,
): ScanDirMtime[] {
  const nextByPath = new Map<string, number>();

  for (const entry of existingMtimes) {
    if (!isPathInFolder(entry.path, folderPath)) {
      nextByPath.set(entry.path, entry.mtime);
    }
  }
  for (const entry of scannedMtimes) {
    nextByPath.set(entry.path, entry.mtime);
  }

  return Array.from(nextByPath, ([path, mtime]) => ({ path, mtime }));
}
