import os
import re

path = r"c:\Users\VIC\Libmaly\src-tauri\src\screenshot.rs"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update Screenshot struct
content = re.sub(
    r"(pub struct Screenshot \{.*?pub timestamp: u64,)(\n\})",
    r"\1\n    pub tags: Vec<String>,\2",
    content,
    flags=re.DOTALL
)

# 2. Update get_screenshots to load tags from tags.json
get_screenshots_pattern = r"(pub fn get_screenshots\(game_exe: String\) -> Result<Vec<Screenshot>, String> \{)(.*?)(\n\})"
def replace_get_screenshots(match):
    header = match.group(1)
    body = match.group(2)
    footer = match.group(3)
    
    # Inject loading logic at start of body
    injection = """
    let dir = screenshots_dir(&game_exe);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let meta_path = dir.join("tags.json");
    let all_tags: std::collections::HashMap<String, Vec<String>> = if meta_path.exists() {
        let content = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };
"""
    # Replace body start and fix Screenshot instantiation
    new_body = re.sub(r"let dir = screenshots_dir\(&game_exe\);\s*if !dir\.exists\(\) \{\s*return Ok\(vec!\[\]\);\s*\}", injection, body)
    new_body = re.sub(r"Screenshot \{.*?filename,.*?timestamp,(\s*)\}", r"let tags = all_tags.get(&filename).cloned().unwrap_or_default();\n            Screenshot {\n                path: path_str,\n                filename,\n                timestamp,\n                tags,\1}", new_body, flags=re.DOTALL)
    
    return header + new_body + footer

content = re.sub(get_screenshots_pattern, replace_get_screenshots, content, flags=re.DOTALL)

# 3. Add save_screenshot_tags command before open_screenshots_folder
save_cmd = """
#[tauri::command]
pub fn save_screenshot_tags(game_exe: String, screenshot_name: String, tags: Vec<String>) -> Result<(), String> {
    let dir = screenshots_dir(&game_exe);
    if !dir.exists() {
        return Err("Screenshots directory not found".into());
    }

    let meta_path = dir.join("tags.json");
    let mut all_tags: std::collections::HashMap<String, Vec<String>> = if meta_path.exists() {
        let content = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    all_tags.insert(screenshot_name, tags);

    let content = serde_json::to_string_pretty(&all_tags).map_err(|e| e.to_string())?;
    std::fs::write(&meta_path, content).map_err(|e| e.to_string())?;
    Ok(())
}
"""

if "pub fn save_screenshot_tags" not in content:
    content = content.replace("#[tauri::command]\npub fn open_screenshots_folder", save_cmd + "\n#[tauri::command]\npub fn open_screenshots_folder")

# 4. Fix other Screenshot instantiations (for new captures)
def fix_other_screenshots(match):
    return match.group(0).replace("timestamp: now,", "timestamp: now,\n        tags: vec![],")

content = re.sub(r"Ok\(Screenshot \{.*?timestamp: now,.*?\}\)", fix_other_screenshots, content, flags=re.DOTALL)

# Also for win module
content = re.sub(r"Ok\(Screenshot \{.*?timestamp: now,\n            tags: vec!\[\],.*?\}\)", lambda m: m.group(0), content) # avoid double add
if "tags: vec![]," not in content and "tags: all_tags" not in content:
    # This is a bit risky, let's just do it specifically for the capture points
    pass

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
