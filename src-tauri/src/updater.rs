use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

// ── Result type returned to the frontend ──────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateResult {
    pub files_updated: u32,
    pub files_skipped: u32,
    /// Relative paths of directory trees that were preserved (saves, configs…)
    pub protected_dirs: Vec<String>,
    /// Absolute path of the backup directory (inside the game folder as `.libmaly_backup`)
    pub backup_dir: String,
    pub warnings: Vec<String>,
    pub extracted_temp: Option<String>,
}

// ── Save / config detection ────────────────────────────────────────────────

/// Patterns that almost certainly contain saves or user-specific data.
const PROTECTED_DIR_NAMES: &[&str] = &[
    "save",
    "saves",
    "savedata",
    "save_data",
    "savegame",
    "savegames",
    "save data",
    "user_data",
    "userdata",
    "game_save",
    "playsave",
    "config",
    "configs",
    "settings",
    "screenshots",
    "log",
    "logs",
    // RPG Maker
    "save",         // www/save
    // Ren'Py
    "saves",
    // Unity
    "playerprefs",
];

/// File extensions that are always save/config data regardless of location.
const PROTECTED_EXTENSIONS: &[&str] = &[
    "sav", "save", "rpgsave", "rpgrmvp", "rvdata", "rvdata2",
    "lsd",           // RPG Maker 2000
    "dat",           // many engines store saves as .dat
    "xml",           // Ren'Py / some custom engines
    "json",          // only in well-known save dirs (checked separately)
    "ini",           // user configuration
    "cfg",           // user configuration
];

/// Returns true if a path (relative to game root) should be treated as protected.
fn is_protected(rel: &Path) -> bool {
    // Check every component of the path
    for comp in rel.components() {
        if let std::path::Component::Normal(n) = comp {
            let name_lower = n.to_string_lossy().to_lowercase();
            if PROTECTED_DIR_NAMES.iter().any(|p| name_lower == *p) {
                return true;
            }
        }
    }
    // Check file extension
    if let Some(ext) = rel.extension() {
        let ext_lower = ext.to_string_lossy().to_lowercase();
        if PROTECTED_EXTENSIONS.iter().any(|e| ext_lower == *e) {
            // .json and .dat are only protected if they sit in a protected directory
            // (handled by the directory check above), so skip bare file extension matching for those.
            if ext_lower != "json" && ext_lower != "dat" {
                return true;
            }
        }
    }
    false
}

// ── ZIP extraction ─────────────────────────────────────────────────────────

#[cfg(feature = "zip-support")]
fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    use std::io::Read;
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = dest.join(file.mangled_name());
        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out_path.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::io::Write::write_all(&mut out, &buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn extract_zip_native(zip_path: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    // Use the `zip` crate (enabled via Cargo.toml feature flag)
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        use std::io::Read;
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = match entry.enclosed_name() {
            Some(p) => dest.join(p),
            None => continue,
        };
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out_path.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Strip single top-level wrapper directory from extracted content ─────────

/// If an archive was extracted and it contains only one top-level directory
/// (common packaging pattern: `game-v2.0/game.exe`), return the path to that subdir.
fn unwrap_single_dir(dir: &Path) -> PathBuf {
    let entries: Vec<_> = match fs::read_dir(dir) {
        Ok(it) => it.filter_map(|e| e.ok()).collect(),
        Err(_) => return dir.to_path_buf(),
    };
    if entries.len() == 1 {
        let child = entries[0].path();
        if child.is_dir() {
            return child;
        }
    }
    dir.to_path_buf()
}

// ── Core merge logic ───────────────────────────────────────────────────────

/// Recursively copies all files from `src` into `dst`, skipping any relative
/// paths that are protected.  Returns (updated, skipped).
fn merge_dirs(
    src: &Path,
    dst: &Path,
    src_root: &Path,
    protected_rel: &HashSet<PathBuf>,
    warnings: &mut Vec<String>,
) -> (u32, u32) {
    let mut updated = 0u32;
    let mut skipped = 0u32;

    for entry in WalkDir::new(src).min_depth(1).into_iter().filter_map(|e| e.ok()) {
        let abs_src = entry.path();
        let rel = match abs_src.strip_prefix(src_root) {
            Ok(r) => r.to_path_buf(),
            Err(_) => continue,
        };

        // Check if this path is under any protected directory
        let prot = is_protected(&rel)
            || protected_rel.iter().any(|p| rel.starts_with(p));

        if entry.file_type().is_dir() {
            if !prot {
                let dst_dir = dst.join(&rel);
                if let Err(e) = fs::create_dir_all(&dst_dir) {
                    warnings.push(format!("mkdir {}: {}", dst_dir.display(), e));
                }
            }
            continue;
        }

        // It's a file
        if prot {
            skipped += 1;
            continue;
        }

        let dst_file = dst.join(&rel);
        if let Some(p) = dst_file.parent() {
            let _ = fs::create_dir_all(p);
        }
        match fs::copy(abs_src, &dst_file) {
            Ok(_) => updated += 1,
            Err(e) => warnings.push(format!("copy {} -> {}: {}", rel.display(), dst_file.display(), e)),
        }
    }

    (updated, skipped)
}

// ── Tauri command ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn update_game(
    game_exe: String,
    new_source: String,
) -> Result<UpdateResult, String> {
    let exe_path = Path::new(&game_exe);
    let game_dir = exe_path
        .parent()
        .ok_or("Cannot determine game directory")?
        .to_path_buf();

    let source_path = PathBuf::from(&new_source);
    if !source_path.exists() {
        return Err(format!("Source path does not exist: {}", new_source));
    }

    let mut warnings: Vec<String> = Vec::new();
    let mut extracted_temp: Option<String> = None;

    // ── Step 1: Resolve new-version folder ───────────────────────────
    let new_dir = {
        let ext = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if ext == "zip" {
            // Extract to a temp directory next to the game folder
            let temp = game_dir
                .parent()
                .unwrap_or(&game_dir)
                .join(format!(".libmaly_update_extract_{}", std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()));
            extract_zip_native(&source_path, &temp)
                .map_err(|e| format!("ZIP extraction failed: {}", e))?;
            extracted_temp = Some(temp.to_string_lossy().to_string());
            // Unwrap a single top-level directory if present
            unwrap_single_dir(&temp)
        } else if source_path.is_dir() {
            source_path.clone()
        } else {
            return Err(format!(
                "Unsupported source: '{}'. Please provide a folder or a .zip file.",
                new_source
            ));
        }
    };

    // ── Step 2: Detect protected paths in the EXISTING game dir ──────
    let mut protected_rel: HashSet<PathBuf> = HashSet::new();
    let mut protected_dirs_display: Vec<String> = Vec::new();

    for entry in WalkDir::new(&game_dir).min_depth(1).max_depth(4).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_lowercase();
        if PROTECTED_DIR_NAMES.iter().any(|p| dir_name == *p) {
            if let Ok(rel) = entry.path().strip_prefix(&game_dir) {
                let rel = rel.to_path_buf();
                protected_dirs_display.push(rel.to_string_lossy().to_string());
                protected_rel.insert(rel);
            }
        }
    }

    // ── Step 3: Back up protected directories ────────────────────────
    let backup_dir = game_dir.join(".libmaly_backup");
    if !protected_rel.is_empty() {
        for rel in &protected_rel {
            let src_prot = game_dir.join(rel);
            let bak_prot = backup_dir.join(rel);
            if src_prot.exists() {
                if let Some(p) = bak_prot.parent() {
                    let _ = fs::create_dir_all(p);
                }
                // Copy the entire protected dir to backup
                for entry in WalkDir::new(&src_prot).into_iter().filter_map(|e| e.ok()) {
                    let entry_rel = entry.path().strip_prefix(&src_prot).unwrap_or(Path::new(""));
                    let bak_entry = bak_prot.join(entry_rel);
                    if entry.file_type().is_dir() {
                        let _ = fs::create_dir_all(&bak_entry);
                    } else {
                        if let Some(p) = bak_entry.parent() { let _ = fs::create_dir_all(p); }
                        if let Err(e) = fs::copy(entry.path(), &bak_entry) {
                            warnings.push(format!("backup {}: {}", entry.path().display(), e));
                        }
                    }
                }
            }
        }
    }

    // ── Step 4: Copy new files over the game dir (skip protected) ────
    let (files_updated, files_skipped) =
        merge_dirs(&new_dir, &game_dir, &new_dir, &protected_rel, &mut warnings);

    // ── Step 5: Restore protected dirs from backup (they may have
    //           been overwritten by the new version's empty placeholders) ──
    if backup_dir.exists() {
        for rel in &protected_rel {
            let bak_prot = backup_dir.join(rel);
            let dst_prot = game_dir.join(rel);
            if !bak_prot.exists() { continue; }
            for entry in WalkDir::new(&bak_prot).into_iter().filter_map(|e| e.ok()) {
                let entry_rel = entry.path().strip_prefix(&bak_prot).unwrap_or(Path::new(""));
                let dst_e = dst_prot.join(entry_rel);
                if entry.file_type().is_dir() {
                    let _ = fs::create_dir_all(&dst_e);
                } else {
                    if let Some(p) = dst_e.parent() { let _ = fs::create_dir_all(p); }
                    if let Err(e) = fs::copy(entry.path(), &dst_e) {
                        warnings.push(format!("restore {}: {}", entry.path().display(), e));
                    }
                }
            }
        }
    }

    // ── Step 6: Clean up temp extraction directory ────────────────────
    if let Some(ref tmp) = extracted_temp {
        let _ = fs::remove_dir_all(tmp);
    }

    Ok(UpdateResult {
        files_updated,
        files_skipped,
        protected_dirs: protected_dirs_display,
        backup_dir: backup_dir.to_string_lossy().to_string(),
        warnings,
        extracted_temp: None, // already cleaned up
    })
}

/// Scan a folder or zip and return a preview: which files would be updated
/// and which protected directories were found — without making any changes.
#[tauri::command]
pub async fn preview_update(
    game_exe: String,
    new_source: String,
) -> Result<UpdatePreview, String> {
    let exe_path = Path::new(&game_exe);
    let game_dir = exe_path
        .parent()
        .ok_or("Cannot determine game directory")?
        .to_path_buf();

    let source_path = PathBuf::from(&new_source);
    if !source_path.exists() {
        return Err(format!("Path does not exist: {}", new_source));
    }

    // Detect new-version root (no actual extraction for preview — just peek inside zip)
    let new_dir_opt: Option<PathBuf> = if source_path.is_dir() {
        Some(source_path.clone())
    } else {
        None // for zip we can't easily preview without extracting
    };

    // Collect protected dirs in old game dir
    let mut protected_dirs: Vec<String> = Vec::new();
    for entry in WalkDir::new(&game_dir).min_depth(1).max_depth(4).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_dir() { continue; }
        let dir_name = entry.file_name().to_string_lossy().to_lowercase();
        if PROTECTED_DIR_NAMES.iter().any(|p| dir_name == *p) {
            if let Ok(rel) = entry.path().strip_prefix(&game_dir) {
                protected_dirs.push(rel.to_string_lossy().to_string());
            }
        }
    }

    // Count changed files if new_dir is available
    let mut files_to_update: u32 = 0;
    let mut new_files: u32 = 0;
    let source_is_zip = source_path.extension()
        .map(|e| e.to_string_lossy().to_lowercase() == "zip")
        .unwrap_or(false);

    if let Some(ref new_dir) = new_dir_opt {
        for entry in WalkDir::new(new_dir).min_depth(1).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_dir() { continue; }
            let rel = match entry.path().strip_prefix(new_dir) {
                Ok(r) => r,
                Err(_) => continue,
            };
            if is_protected(rel) { continue; }
            let dst = game_dir.join(rel);
            if dst.exists() { files_to_update += 1; } else { new_files += 1; }
        }
    }

    // Estimate file count from zip (just count entries)
    let zip_entry_count: Option<u32> = if source_is_zip {
        match fs::File::open(&source_path).map(|f| zip::ZipArchive::new(f)) {
            Ok(Ok(archive)) => Some(archive.len() as u32),
            _ => None,
        }
    } else { None };

    Ok(UpdatePreview {
        game_dir: game_dir.to_string_lossy().to_string(),
        source_is_zip,
        files_to_update,
        new_files,
        zip_entry_count,
        protected_dirs,
    })
}

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdatePreview {
    pub game_dir: String,
    pub source_is_zip: bool,
    pub files_to_update: u32,
    pub new_files: u32,
    pub zip_entry_count: Option<u32>,
    pub protected_dirs: Vec<String>,
}
