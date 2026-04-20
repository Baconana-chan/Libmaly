use serde::{Deserialize, Serialize};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};

use crate::data_paths::app_data_root;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const ITCH_BUTLER_INSTALL_URL: &str = "https://itch.io/app";
const ITCH_API_KEY_PROVIDER: &str = "itch_io";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItchButlerStatus {
    available: bool,
    executable_path: Option<String>,
    version: Option<String>,
    install_url: String,
    api_key_provider: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItchProfile {
    pub id: i64,
    pub user: ItchUser,
    pub last_connected: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchUser {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub url: Option<String>,
    pub cover_url: Option<String>,
    pub still_cover_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchGame {
    pub id: i64,
    pub title: String,
    pub url: Option<String>,
    pub short_text: Option<String>,
    pub cover_url: Option<String>,
    pub still_cover_url: Option<String>,
    pub classification: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchBuild {
    pub id: i64,
    pub version: Option<i64>,
    pub user_version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchUpload {
    pub id: i64,
    pub display_name: Option<String>,
    pub filename: Option<String>,
    pub channel_name: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub demo: Option<bool>,
    pub preorder: Option<bool>,
    pub build_id: Option<i64>,
    pub build: Option<ItchBuild>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchGameRecord {
    pub id: i64,
    pub title: String,
    pub cover: Option<String>,
    pub owned: Option<bool>,
    pub installed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchCaveStats {
    pub installed_at: Option<String>,
    pub last_touched_at: Option<String>,
    pub seconds_run: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchCaveInstallInfo {
    pub installed_size: i64,
    pub install_location: Option<String>,
    pub install_folder: String,
    pub pinned: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchCave {
    pub id: String,
    pub game: Option<ItchGame>,
    pub upload: Option<ItchUpload>,
    pub build: Option<ItchBuild>,
    pub stats: Option<ItchCaveStats>,
    pub install_info: Option<ItchCaveInstallInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchInstallLocationSizeInfo {
    pub installed_size: i64,
    pub free_size: i64,
    pub total_size: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchInstallLocation {
    pub id: String,
    pub path: String,
    pub size_info: Option<ItchInstallLocationSizeInfo>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItchLibraryEntry {
    pub id: i64,
    pub title: String,
    pub cover: Option<String>,
    pub owned: bool,
    pub installed: bool,
    pub installed_at: Option<String>,
    pub cave_ids: Vec<String>,
    pub primary_cave_id: Option<String>,
    pub install_folders: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItchOwnedLibrary {
    pub profile: ItchProfile,
    pub records: Vec<ItchLibraryEntry>,
    pub caves: Vec<ItchCave>,
    pub install_locations: Vec<ItchInstallLocation>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchGameUpdateChoice {
    pub upload: ItchUpload,
    pub build: Option<ItchBuild>,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItchGameUpdate {
    pub cave_id: String,
    pub game: ItchGame,
    pub direct: bool,
    pub choices: Vec<ItchGameUpdateChoice>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItchUpdateCheckResult {
    pub updates: Vec<ItchGameUpdate>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItchInstallResult {
    pub game_id: i64,
    pub title: String,
    pub cave_id: String,
    pub install_folder: String,
    pub upload_id: i64,
    pub build_id: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileLoginWithApiKeyResult {
    profile: ItchProfile,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchGameRecordsResult {
    records: Vec<ItchGameRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchCavesResult {
    items: Vec<ItchCave>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallLocationsListResult {
    install_locations: Vec<ItchInstallLocation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckUpdateResult {
    updates: Vec<ItchGameUpdate>,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchGameResult {
    game: ItchGame,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameFindUploadsResult {
    uploads: Vec<ItchUpload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallQueueResult {
    id: String,
    install_folder: String,
    staging_folder: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallPerformResult {
    cave_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchCaveResult {
    cave: ItchCave,
}

struct ButlerdClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl ButlerdClient {
    fn new(executable: &Path) -> Result<Self, String> {
        let db_dir = app_data_root().join("itch").join("butlerdb");
        fs::create_dir_all(&db_dir).map_err(|e| format!("Failed to prepare butlerd data directory: {e}"))?;

        let mut command = Command::new(executable);
        command
            .arg("daemon")
            .arg("--json")
            .arg("--transport")
            .arg("stdio")
            .arg("--dbpath")
            .arg(&db_dir)
            .arg("--destiny-pid")
            .arg(std::process::id().to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_no_window(&mut command);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start butlerd from {}: {e}", executable.display()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture butlerd stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture butlerd stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture butlerd stderr".to_string())?;

        spawn_stderr_drain(stderr);

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        })
    }

    fn call<R: DeserializeOwned>(&mut self, method: &str, params: Value) -> Result<R, String> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        writeln!(self.stdin, "{}", payload)
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("Failed to send {method} request to butlerd: {e}"))?;

        let mut line = String::new();
        loop {
            line.clear();
            let read = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("Failed to read butlerd response for {method}: {e}"))?;
            if read == 0 {
                return Err(format!("butlerd exited while waiting for {method}"));
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let parsed: Value = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(_) => continue,
            };

            let Some(response_id) = parsed.get("id").and_then(Value::as_u64) else {
                continue;
            };
            if response_id != id {
                continue;
            }

            if let Some(error) = parsed.get("error") {
                return Err(format_rpc_error(method, error));
            }

            let result = parsed.get("result").cloned().unwrap_or(Value::Null);
            return serde_json::from_value(result)
                .map_err(|e| format!("Failed to decode {method} response: {e}"));
        }
    }
}

impl Drop for ButlerdClient {
    fn drop(&mut self) {
        let _ = self.call::<Value>("Meta.Shutdown", json!({}));
        match self.child.try_wait() {
            Ok(Some(_)) => {}
            _ => {
                let _ = self.child.kill();
                let _ = self.child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn itch_butler_status() -> Result<ItchButlerStatus, String> {
    if let Some(executable) = locate_butler() {
        let version = butler_version(&executable).ok();
        return Ok(ItchButlerStatus {
            available: true,
            executable_path: Some(executable.to_string_lossy().to_string()),
            version,
            install_url: ITCH_BUTLER_INSTALL_URL.to_string(),
            api_key_provider: ITCH_API_KEY_PROVIDER.to_string(),
        });
    }

    Ok(ItchButlerStatus {
        available: false,
        executable_path: None,
        version: None,
        install_url: ITCH_BUTLER_INSTALL_URL.to_string(),
        api_key_provider: ITCH_API_KEY_PROVIDER.to_string(),
    })
}

#[tauri::command]
pub fn itch_butler_list_owned_games(
    api_key: String,
    search: Option<String>,
    fresh: Option<bool>,
) -> Result<ItchOwnedLibrary, String> {
    let mut client = make_client()?;
    let profile = login_with_api_key(&mut client, &api_key)?;
    let records = fetch_owned_records(&mut client, profile.id, search, fresh.unwrap_or(false))?;
    let caves = fetch_caves(&mut client)?;
    let install_locations = list_install_locations(&mut client)?;

    let mut caves_by_game: std::collections::HashMap<i64, Vec<&ItchCave>> = std::collections::HashMap::new();
    for cave in &caves {
        if let Some(game) = &cave.game {
            caves_by_game.entry(game.id).or_default().push(cave);
        }
    }

    let mapped = records
        .into_iter()
        .map(|record| {
            let caves_for_game = caves_by_game.get(&record.id).cloned().unwrap_or_default();
            let install_folders = caves_for_game
                .iter()
                .filter_map(|cave| cave.install_info.as_ref().map(|info| info.install_folder.clone()))
                .collect::<Vec<_>>();
            let cave_ids = caves_for_game
                .iter()
                .map(|cave| cave.id.clone())
                .collect::<Vec<_>>();
            let primary_cave_id = cave_ids.first().cloned();
            let installed_at = record.installed_at.clone().or_else(|| {
                caves_for_game
                    .iter()
                    .find_map(|cave| cave.stats.as_ref().and_then(|stats| stats.installed_at.clone()))
            });

            ItchLibraryEntry {
                id: record.id,
                title: record.title,
                cover: record.cover,
                owned: record.owned.unwrap_or(true),
                installed: !cave_ids.is_empty(),
                installed_at,
                cave_ids,
                primary_cave_id,
                install_folders,
            }
        })
        .collect::<Vec<_>>();

    Ok(ItchOwnedLibrary {
        profile,
        records: mapped,
        caves,
        install_locations,
    })
}

#[tauri::command]
pub fn itch_butler_install_game(
    api_key: String,
    game_id: i64,
    install_path: String,
) -> Result<ItchInstallResult, String> {
    let install_path = install_path.trim();
    if install_path.is_empty() {
        return Err("Choose an install folder first".to_string());
    }

    let mut client = make_client()?;
    let profile = login_with_api_key(&mut client, &api_key)?;
    ensure_download_key_cached(&mut client, profile.id, game_id)?;

    let game = fetch_game(&mut client, game_id)?;
    let upload = select_upload(find_uploads(&mut client, &game)?)
        .ok_or_else(|| format!("No compatible uploads were found for {}", game.title))?;
    let location = ensure_install_location(&mut client, install_path)?;

    let mut queue_params = serde_json::Map::new();
    queue_params.insert("game".to_string(), serde_json::to_value(&game).map_err(|e| e.to_string())?);
    queue_params.insert("upload".to_string(), serde_json::to_value(&upload).map_err(|e| e.to_string())?);
    queue_params.insert("installLocationId".to_string(), Value::String(location.id));
    if let Some(build) = &upload.build {
        queue_params.insert("build".to_string(), serde_json::to_value(build).map_err(|e| e.to_string())?);
    }

    let queued: InstallQueueResult = client.call("Install.Queue", Value::Object(queue_params))?;
    let performed: InstallPerformResult = client.call(
        "Install.Perform",
        json!({
            "id": queued.id,
            "stagingFolder": queued.staging_folder,
        }),
    )?;
    let cave = fetch_cave(&mut client, &performed.cave_id)?;
    let install_folder = cave
        .install_info
        .as_ref()
        .map(|info| info.install_folder.clone())
        .unwrap_or(queued.install_folder);

    Ok(ItchInstallResult {
        game_id: game.id,
        title: game.title,
        cave_id: cave.id,
        install_folder,
        upload_id: upload.id,
        build_id: upload.build.as_ref().map(|build| build.id),
    })
}

#[tauri::command]
pub fn itch_butler_check_updates(
    api_key: String,
    cave_ids: Option<Vec<String>>,
) -> Result<ItchUpdateCheckResult, String> {
    let mut client = make_client()?;
    let _profile = login_with_api_key(&mut client, &api_key)?;
    let result: CheckUpdateResult = client.call(
        "CheckUpdate",
        json!({
            "caveIds": cave_ids.unwrap_or_default(),
            "verbose": false,
        }),
    )?;
    Ok(ItchUpdateCheckResult {
        updates: result.updates,
        warnings: result.warnings,
    })
}

#[tauri::command]
pub fn itch_butler_apply_update(
    api_key: String,
    cave_id: String,
    upload_id: i64,
    build_id: Option<i64>,
) -> Result<ItchInstallResult, String> {
    if cave_id.trim().is_empty() {
        return Err("Missing cave identifier for update".to_string());
    }

    let mut client = make_client()?;
    let _profile = login_with_api_key(&mut client, &api_key)?;
    let current_cave = fetch_cave(&mut client, &cave_id)?;
    let game = current_cave
        .game
        .clone()
        .ok_or_else(|| "The selected itch install is missing game metadata".to_string())?;

    let upload = find_uploads(&mut client, &game)?
        .into_iter()
        .find(|candidate| candidate.id == upload_id)
        .ok_or_else(|| "The selected update upload is no longer available".to_string())?;

    let mut queue_params = serde_json::Map::new();
    queue_params.insert("caveId".to_string(), Value::String(cave_id.clone()));
    queue_params.insert("reason".to_string(), Value::String("update".to_string()));
    queue_params.insert("game".to_string(), serde_json::to_value(&game).map_err(|e| e.to_string())?);
    queue_params.insert("upload".to_string(), serde_json::to_value(&upload).map_err(|e| e.to_string())?);
    if let Some(build) = build_id.and_then(|id| resolve_build_for_upload(&upload, id)) {
        queue_params.insert("build".to_string(), serde_json::to_value(build).map_err(|e| e.to_string())?);
    }

    let queued: InstallQueueResult = client.call("Install.Queue", Value::Object(queue_params))?;
    let performed: InstallPerformResult = client.call(
        "Install.Perform",
        json!({
            "id": queued.id,
            "stagingFolder": queued.staging_folder,
        }),
    )?;
    let cave = fetch_cave(&mut client, &performed.cave_id)?;
    let install_folder = cave
        .install_info
        .as_ref()
        .map(|info| info.install_folder.clone())
        .unwrap_or(queued.install_folder);

    Ok(ItchInstallResult {
        game_id: game.id,
        title: game.title,
        cave_id: cave.id,
        install_folder,
        upload_id: upload.id,
        build_id: upload.build.as_ref().map(|build| build.id),
    })
}

fn make_client() -> Result<ButlerdClient, String> {
    let executable = locate_butler().ok_or_else(|| {
        format!(
            "Could not find the itch.io butler executable. Install the itch app or put `butler` on PATH: {ITCH_BUTLER_INSTALL_URL}"
        )
    })?;
    ButlerdClient::new(&executable)
}

fn login_with_api_key(client: &mut ButlerdClient, api_key: &str) -> Result<ItchProfile, String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("Enter an itch.io API key first".to_string());
    }
    let result: ProfileLoginWithApiKeyResult = client.call(
        "Profile.LoginWithAPIKey",
        json!({ "apiKey": trimmed }),
    )?;
    Ok(result.profile)
}

fn fetch_owned_records(
    client: &mut ButlerdClient,
    profile_id: i64,
    search: Option<String>,
    fresh: bool,
) -> Result<Vec<ItchGameRecord>, String> {
    let mut offset = 0_i64;
    let limit = 200_i64;
    let mut all_records = Vec::new();
    let search = search.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    loop {
        let result: FetchGameRecordsResult = client.call(
            "Fetch.GameRecords",
            json!({
                "profileId": profile_id,
                "source": "owned",
                "limit": limit,
                "offset": offset,
                "search": search,
                "sortBy": "acquiredAt",
                "fresh": fresh,
            }),
        )?;
        let count = result.records.len() as i64;
        all_records.extend(result.records);
        if count < limit {
            break;
        }
        offset += count;
    }

    Ok(all_records)
}

fn fetch_caves(client: &mut ButlerdClient) -> Result<Vec<ItchCave>, String> {
    let mut cursor: Option<String> = None;
    let mut all_items = Vec::new();
    loop {
        let mut payload = serde_json::Map::new();
        payload.insert("limit".to_string(), Value::Number(200.into()));
        payload.insert("sortBy".to_string(), Value::String("installedAt".to_string()));
        if let Some(value) = cursor.clone() {
            payload.insert("cursor".to_string(), Value::String(value));
        }
        let response: Value = client.call("Fetch.Caves", Value::Object(payload))?;
        let page: FetchCavesResult = serde_json::from_value(response.clone())
            .map_err(|e| format!("Failed to decode Fetch.Caves response: {e}"))?;
        all_items.extend(page.items);
        cursor = response
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        if cursor.is_none() {
            break;
        }
    }
    Ok(all_items)
}

fn list_install_locations(client: &mut ButlerdClient) -> Result<Vec<ItchInstallLocation>, String> {
    let response: InstallLocationsListResult = client.call("Install.Locations.List", json!({}))?;
    Ok(response.install_locations)
}

fn ensure_download_key_cached(
    client: &mut ButlerdClient,
    profile_id: i64,
    game_id: i64,
) -> Result<(), String> {
    let _: Value = client.call(
        "Fetch.DownloadKeys",
        json!({
            "profileId": profile_id,
            "limit": 50,
            "filters": { "gameId": game_id },
            "fresh": true,
        }),
    )?;
    Ok(())
}

fn fetch_game(client: &mut ButlerdClient, game_id: i64) -> Result<ItchGame, String> {
    let result: FetchGameResult = client.call(
        "Fetch.Game",
        json!({ "gameId": game_id, "fresh": true }),
    )?;
    Ok(result.game)
}

fn find_uploads(client: &mut ButlerdClient, game: &ItchGame) -> Result<Vec<ItchUpload>, String> {
    let result: GameFindUploadsResult = client.call(
        "Game.FindUploads",
        json!({ "game": game }),
    )?;
    Ok(result.uploads)
}

fn select_upload(mut uploads: Vec<ItchUpload>) -> Option<ItchUpload> {
    uploads.sort_by_key(|upload| {
        let is_default = upload.kind.as_deref() == Some("default");
        let is_demo = upload.demo.unwrap_or(false);
        let is_preorder = upload.preorder.unwrap_or(false);
        (
            !is_default,
            is_demo,
            is_preorder,
            upload.display_name.clone().unwrap_or_default().to_lowercase(),
        )
    });
    uploads.into_iter().next()
}

fn ensure_install_location(client: &mut ButlerdClient, path: &str) -> Result<ItchInstallLocation, String> {
    let normalized = normalize_path(path);
    let existing = list_install_locations(client)?;
    if let Some(location) = existing.into_iter().find(|item| normalize_path(&item.path) == normalized) {
        return Ok(location);
    }

    let response: Value = client.call(
        "Install.Locations.Add",
        json!({ "path": path }),
    )?;
    serde_json::from_value(response.get("installLocation").cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("Failed to decode added install location: {e}"))
}

fn fetch_cave(client: &mut ButlerdClient, cave_id: &str) -> Result<ItchCave, String> {
    let result: FetchCaveResult = client.call(
        "Fetch.Cave",
        json!({ "caveId": cave_id }),
    )?;
    Ok(result.cave)
}

fn resolve_build_for_upload(upload: &ItchUpload, build_id: i64) -> Option<ItchBuild> {
    let build = upload.build.clone()?;
    if build.id == build_id {
        Some(build)
    } else {
        None
    }
}

fn locate_butler() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("BUTLER_EXE") {
        let path = PathBuf::from(explicit);
        if path.exists() {
            return Some(path);
        }
    }

    for candidate in common_butler_paths() {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    resolve_command_path("butler")
}

fn common_butler_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_app_data).join("itch").join("bin").join("butler").join("butler.exe"));
            candidates.push(PathBuf::from(&local_app_data).join("Programs").join("itch").join("butler.exe"));
            candidates.push(PathBuf::from(&local_app_data).join("Programs").join("itch").join("resources").join("app.asar.unpacked").join("bin").join("butler.exe"));
        }
        if let Ok(app_data) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(app_data).join("itch").join("bin").join("butler").join("butler.exe"));
        }
    }
    candidates
}

fn resolve_command_path(command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let mut resolver = {
        let mut cmd = Command::new("where");
        cmd.arg(command);
        cmd
    };

    #[cfg(not(windows))]
    let mut resolver = {
        let mut cmd = Command::new("which");
        cmd.arg(command);
        cmd
    };

    apply_no_window(&mut resolver);
    let output = resolver.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| !line.trim().is_empty())?
        .trim()
        .to_string();
    let path = PathBuf::from(first);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn butler_version(executable: &Path) -> Result<String, String> {
    let mut command = Command::new(executable);
    command.arg("version");
    apply_no_window(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("Failed to query butler version: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        Err("butler returned an empty version string".to_string())
    } else {
        Ok(version)
    }
}

fn normalize_path(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn format_rpc_error(method: &str, error: &Value) -> String {
    let code = error.get("code").and_then(Value::as_i64).unwrap_or_default();
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Unknown butlerd error");
    format!("{method} failed ({code}): {message}")
}

fn spawn_stderr_drain(stderr: ChildStderr) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for _line in reader.lines() {}
    });
}

fn apply_no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}