use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavePathInfo {
    pub path: String,
    pub engine: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferResult {
    pub success: bool,
    pub message: String,
    pub files_transferred: usize,
}

/// Detect save paths for different game engines based on game path and metadata
pub fn detect_save_paths(game_path: &str, engine: Option<&str>, company_name: Option<&str>, game_name: Option<&str>) -> Vec<SavePathInfo> {
    let mut paths = Vec::new();
    
    if let Some(eng) = engine {
        match eng.to_lowercase().as_str() {
            "unity" => detect_unity_saves(game_path, company_name, game_name, &mut paths),
            "unreal" => detect_unreal_saves(game_path, company_name, game_name, &mut paths),
            "ren'py" | "renpy" => detect_renpy_saves(game_path, game_name, &mut paths),
            "rpg maker" | "rpgmaker" | "rpg mv" | "rpg mz" => detect_rpg_maker_saves(game_path, &mut paths),
            _ => {}
        }
    }
    
    // Also try to detect by examining the game directory structure
    if paths.is_empty() {
        detect_by_structure(game_path, &mut paths);
    }
    
    paths
}

/// Detect Unity save paths
fn detect_unity_saves(game_path: &str, _company_name: Option<&str>, _game_name: Option<&str>, paths: &mut Vec<SavePathInfo>) {
    let game_path = Path::new(game_path);
    
    // Check local folder next to exe
    let local_save = game_path.join("save");
    if local_save.exists() {
        paths.push(SavePathInfo {
            path: local_save.to_string_lossy().to_string(),
            engine: "Unity".to_string(),
            description: "Local saves folder (next to game exe)".to_string(),
        });
    }
    
    // Check Windows AppData/LocalLow
    #[cfg(target_os = "windows")]
    {
        if let (Some(company), Some(name)) = (_company_name, _game_name) {
            let appdata_local = std::env::var("USERPROFILE").unwrap_or_default();
            let save_path = PathBuf::from(appdata_local)
                .join("AppData")
                .join("LocalLow")
                .join(company)
                .join(name);
            
            if save_path.exists() {
                paths.push(SavePathInfo {
                    path: save_path.to_string_lossy().to_string(),
                    engine: "Unity".to_string(),
                    description: "Windows AppData/LocalLow".to_string(),
                });
            }
        }
    }
    
    // Check macOS ~/Library/Application Support
    #[cfg(target_os = "macos")]
    {
        if let (Some(company), Some(name)) = (_company_name, _game_name) {
            let home = std::env::var("HOME").unwrap_or_default();
            let save_path = PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(company)
                .join(name);
            
            if save_path.exists() {
                paths.push(SavePathInfo {
                    path: save_path.to_string_lossy().to_string(),
                    engine: "Unity".to_string(),
                    description: "macOS Application Support".to_string(),
                });
            }
        }
    }
    
    // Check Linux ~/.config
    #[cfg(target_os = "linux")]
    {
        if let Some(name) = _game_name {
            let home = std::env::var("HOME").unwrap_or_default();
            let save_path = PathBuf::from(home)
                .join(".config")
                .join("unity3d")
                .join(name);
            
            if save_path.exists() {
                paths.push(SavePathInfo {
                    path: save_path.to_string_lossy().to_string(),
                    engine: "Unity".to_string(),
                    description: "Linux ~/.config/unity3d".to_string(),
                });
            }
        }
    }
}

/// Detect Unreal save paths
fn detect_unreal_saves(game_path: &str, _company_name: Option<&str>, _game_name: Option<&str>, paths: &mut Vec<SavePathInfo>) {
    let game_path = Path::new(game_path);
    
    // Check Saved/SaveGames folder next to exe
    let save_games = game_path.join("Saved").join("SaveGames");
    if save_games.exists() {
        paths.push(SavePathInfo {
            path: save_games.to_string_lossy().to_string(),
            engine: "Unreal".to_string(),
            description: "Local Saved/SaveGames folder".to_string(),
        });
    }
    
    // Check Windows AppData/Local
    #[cfg(target_os = "windows")]
    {
        if let Some(name) = _game_name {
            let appdata_local = std::env::var("LOCALAPPDATA").unwrap_or_default();
            let save_path = PathBuf::from(appdata_local)
                .join(name)
                .join("Saved")
                .join("SaveGames");
            
            if save_path.exists() {
                paths.push(SavePathInfo {
                    path: save_path.to_string_lossy().to_string(),
                    engine: "Unreal".to_string(),
                    description: "Windows AppData/Local".to_string(),
                });
            }
            
            // Also check %USERPROFILE%/Saved
            let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
            let saved_path = PathBuf::from(userprofile)
                .join("Saved")
                .join("Saved Games")
                .join(name);
            
            if saved_path.exists() {
                paths.push(SavePathInfo {
                    path: saved_path.to_string_lossy().to_string(),
                    engine: "Unreal".to_string(),
                    description: "Windows Saved Games".to_string(),
                });
            }
        }
    }
}

/// Detect Ren'Py save paths
fn detect_renpy_saves(game_path: &str, _game_name: Option<&str>, paths: &mut Vec<SavePathInfo>) {
    let game_path = Path::new(game_path);
    
    // Check saves folder next to exe
    let saves = game_path.join("saves");
    if saves.exists() {
        paths.push(SavePathInfo {
            path: saves.to_string_lossy().to_string(),
            engine: "Ren'Py".to_string(),
            description: "Local saves folder".to_string(),
        });
    }
    
    // Check AppData/Roaming for Windows
    #[cfg(target_os = "windows")]
    {
        if let Some(name) = _game_name {
            let appdata = std::env::var("APPDATA").unwrap_or_default();
            let save_path = PathBuf::from(appdata)
                .join("RenPy")
                .join(name);
            
            if save_path.exists() {
                paths.push(SavePathInfo {
                    path: save_path.to_string_lossy().to_string(),
                    engine: "Ren'Py".to_string(),
                    description: "Windows AppData/Roaming/RenPy".to_string(),
                });
            }
        }
    }
    
    // Check macOS ~/.renpy
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let save_path = PathBuf::from(home).join(".renpy");
        
        if save_path.exists() {
            if let Some(name) = game_name {
                let game_save = save_path.join(name);
                if game_save.exists() {
                    paths.push(SavePathInfo {
                        path: game_save.to_string_lossy().to_string(),
                        engine: "Ren'Py".to_string(),
                        description: "macOS ~/.renpy".to_string(),
                    });
                }
            }
        }
    }
}

/// Detect RPG Maker save paths
fn detect_rpg_maker_saves(game_path: &str, paths: &mut Vec<SavePathInfo>) {
    let game_path = Path::new(game_path);
    
    // Check save folder next to exe
    let save = game_path.join("save");
    if save.exists() {
        paths.push(SavePathInfo {
            path: save.to_string_lossy().to_string(),
            engine: "RPG Maker".to_string(),
            description: "Local save folder".to_string(),
        });
    }
    
    // Also check for .rpgsave files directly
    if let Ok(entries) = fs::read_dir(game_path) {
        let entries_vec: Vec<_> = entries.collect();
        let has_save_files = entries_vec.iter().any(|entry| {
            if let Ok(entry) = entry {
                if let Some(name) = entry.file_name().to_str() {
                    name.ends_with(".rpgsave") || name.starts_with("Save") || name.starts_with("save")
                } else {
                    false
                }
            } else {
                false
            }
        });
        
        if has_save_files {
            paths.push(SavePathInfo {
                path: game_path.to_string_lossy().to_string(),
                engine: "RPG Maker".to_string(),
                description: "Game directory (contains save files)".to_string(),
            });
        }
    }
}

/// Detect save paths by examining directory structure
fn detect_by_structure(game_path: &str, paths: &mut Vec<SavePathInfo>) {
    let game_path = Path::new(game_path);
    
    // Common save folder names
    let save_folder_names = ["save", "saves", "Save", "Saves", "savedata", "SaveData", "SAVEDATA"];
    
    for folder_name in &save_folder_names {
        let save_path = game_path.join(folder_name);
        if save_path.exists() && save_path.is_dir() {
            paths.push(SavePathInfo {
                path: save_path.to_string_lossy().to_string(),
                engine: "Unknown".to_string(),
                description: format!("Detected {} folder", folder_name),
            });
        }
    }
}

/// Transfer save files from source to target
pub fn transfer_saves(source_path: &str, target_path: &str, create_backup: bool) -> Result<TransferResult, String> {
    let source = Path::new(source_path);
    let target = Path::new(target_path);
    
    if !source.exists() {
        return Err("Source save path does not exist".to_string());
    }
    
    // Create target directory if it doesn't exist
    if !target.exists() {
        fs::create_dir_all(target).map_err(|e| format!("Failed to create target directory: {}", e))?;
    }
    
    // Create backup if requested
    if create_backup && target.exists() {
        let backup_name = format!("{}_backup", target.to_string_lossy());
        let backup_path = Path::new(&backup_name);
        
        if backup_path.exists() {
            fs::remove_dir_all(backup_path).map_err(|e| format!("Failed to remove old backup: {}", e))?;
        }
        
        // Copy existing saves to backup
        copy_dir_recursive(target, backup_path).map_err(|e| format!("Failed to create backup: {}", e))?;
    }
    
    // Copy save files
    let mut files_transferred = 0;
    let entries = fs::read_dir(source).map_err(|e| format!("Failed to read source directory: {}", e))?;
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let entry_path = entry.path();
        
        if entry_path.is_file() {
            let file_name = entry.file_name();
            let target_file = target.join(&file_name);
            
            fs::copy(&entry_path, &target_file).map_err(|e| {
                format!("Failed to copy {}: {}", file_name.to_string_lossy(), e)
            })?;
            
            files_transferred += 1;
        }
    }
    
    Ok(TransferResult {
        success: true,
        message: format!("Successfully transferred {} save files", files_transferred),
        files_transferred,
    })
}

/// Recursively copy directory contents
fn copy_dir_recursive(source: &Path, target: &Path) -> std::io::Result<()> {
    if !target.exists() {
        fs::create_dir_all(target)?;
    }
    
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let src_path = entry.path();
        let tgt_path = target.join(entry.file_name());
        
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src_path, &tgt_path)?;
        } else {
            fs::copy(&src_path, &tgt_path)?;
        }
    }
    
    Ok(())
}

/// Check if a path is a valid save directory
pub fn is_valid_save_directory(path: &str) -> bool {
    let path = Path::new(path);
    if !path.exists() || !path.is_dir() {
        return false;
    }
    
    // Check if directory contains save files
    if let Ok(entries) = fs::read_dir(path) {
        let entries_vec: Vec<_> = entries.collect();
        let has_files = entries_vec.iter().any(|entry| {
            if let Ok(entry) = entry {
                entry.path().is_file()
            } else {
                false
            }
        });
        has_files
    } else {
        false
    }
}
