// src-tauri/src/eos.rs
//
// Epic Online Services (EOS) SDK integration for LIBMALY.
//
// Architecture: Dynamic DLL loading via libloading (same pattern as discord.rs).
// – EOS_LIB       : OnceLock<Library>          – keeps the loaded DLL alive for process lifetime
// – EOS_APIS      : OnceLock<EosApis>           – cached raw function pointers (immutable once set)
// – EOS_PLATFORM  : OnceLock<Mutex<Option<..>>> – platform handle + mutable runtime state
// – tick thread   : calls EOS_Platform_Tick every ~100 ms while the platform is alive
//
// Async callbacks (login, logout, ownership query) use std::sync::mpsc::sync_channel(1).
// The sender is Box::into_raw'd into the EOS ClientData pointer; the callback reconstructs
// and consumes it to deliver the result.  The command thread calls spawn_blocking to await.

use libloading::Library;
use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

// ── Platform-specific DLL filename ───────────────────────────────────────────
#[cfg(target_os = "windows")]
const EOS_DLL: &str = "EOSSDK-Win64-Shipping.dll";
#[cfg(target_os = "linux")]
const EOS_DLL: &str = "libEOSSDK-Linux-Shipping.so";
#[cfg(target_os = "macos")]
const EOS_DLL: &str = "libEOSSDK-Mac-Shipping.dylib";

// ── EOS opaque handle types (all are pointers to opaque C structs) ────────────
type EosHPlatform       = *mut c_void;
type EosHAuth           = *mut c_void;
type EosHEcom           = *mut c_void;
type EosHAchievements   = *mut c_void;
type EosEpicAccountId   = *mut c_void;   // EOS_EpicAccountId = struct EOS_EpicAccountIdDetails*
type EosEResult         = i32;
type EosBool            = i32;

const EOS_SUCCESS: EosEResult = 0;
const EOS_ALREADY_CONFIGURED: EosEResult = 14;
const EOS_EPICACCOUNTID_MAX_LENGTH: usize = 32;

// EOS_ELoginCredentialType
const EOS_LCT_EXCHANGE_CODE:   i32 = 1;
const EOS_LCT_PERSISTENT_AUTH: i32 = 2;
const EOS_LCT_ACCOUNT_PORTAL:  i32 = 6;

// EOS_ELoginStatus
const EOS_LS_NOT_LOGGED_IN:      i32 = 0;
const EOS_LS_USING_LOCAL_PROFILE: i32 = 1;
const EOS_LS_LOGGED_IN:          i32 = 2;

// EOS_EOwnershipStatus
const EOS_OS_NOT_OWNED: i32 = 0;
const EOS_OS_OWNED:     i32 = 1;

// EOS_PF_DISABLE_OVERLAY | EOS_PF_DISABLE_SOCIAL_OVERLAY
const EOS_PF_DISABLE_OVERLAY: u64 = 0x2;
const EOS_PF_DISABLE_SOCIAL_OVERLAY: u64 = 0x4;

// EOS_EAuthScopeFlags: BasicProfile | FriendsList | Presence
const EOS_SCOPE_FLAGS: u32 = 0x1 | 0x2 | 0x4;

// API version constants (from EOS SDK headers)
const EOS_INITIALIZE_API_LATEST:          i32 = 5;
const EOS_PLATFORM_OPTIONS_API_LATEST:    i32 = 15;
const EOS_AUTH_CREDENTIALS_API_LATEST:    i32 = 4;
const EOS_AUTH_LOGIN_API_LATEST:          i32 = 3;
const EOS_AUTH_LOGOUT_API_LATEST:         i32 = 1;
const EOS_ECOM_QUERYOWNERSHIP_API_LATEST: i32 = 2;
const EOS_ACHIEVEMENTS_QUERYDEFINITIONS_API_LATEST: i32 = 3;
const EOS_ACHIEVEMENTS_GETDEFINITIONCOUNT_API_LATEST: i32 = 1;
const EOS_ACHIEVEMENTS_COPYDEFINITIONV2_API_LATEST: i32 = 2;

// ── C Structs (must match EOS SDK layout; headers use #pragma pack(push, 8)) ─
// Rust #[repr(C)] produces identical padding on 64-bit targets.

#[repr(C)]
struct EosInitializeOptions {
    api_version: i32,
    // 4 bytes padding (auto by repr(C))
    alloc_fn:   *const c_void,
    realloc_fn: *const c_void,
    free_fn:    *const c_void,
    product_name:    *const c_char,
    product_version: *const c_char,
    reserved:        *mut c_void,
    system_init:     *mut c_void,
    thread_affinity: *mut c_void,
}

#[repr(C)]
struct EosPlatformClientCredentials {
    client_id:     *const c_char,
    client_secret: *const c_char,
}

#[repr(C)]
struct EosPlatformOptions {
    api_version: i32,
    // 4 bytes padding
    reserved:    *const c_void,
    product_id:  *const c_char,
    sandbox_id:  *const c_char,
    client_credentials: EosPlatformClientCredentials,
    is_server:   EosBool,
    // 4 bytes padding
    encryption_key:        *const c_char,
    override_country_code: *const c_char,
    override_locale_code:  *const c_char,
    deployment_id:         *const c_char,
    flags:                 u64,
    cache_directory:       *const c_char,
    tick_budget_ms:        u32,
    // 4 bytes padding
    rtc_options:                   *const c_void,
    integrated_platform_options:   *const c_void,
    system_specific:               *const c_void,
    task_network_timeout:          *const c_void,
}

#[repr(C)]
struct EosAuthCredentials {
    api_version:       i32,
    // 4 bytes padding
    id:                *const c_char,
    token:             *const c_char,
    credential_type:   i32,
    // 4 bytes padding
    system_auth_opts:  *mut c_void,
    external_type:     i32,
    // 4 bytes padding (struct size = 48)
}

#[repr(C)]
struct EosAuthLoginOptions {
    api_version:  i32,
    // 4 bytes padding
    credentials:  *const EosAuthCredentials,
    scope_flags:  u32,
    // 4 bytes padding
    login_flags:  u64,
}

#[repr(C)]
struct EosAuthLoginCallbackInfo {
    result_code:          EosEResult,
    // 4 bytes padding
    client_data:          *mut c_void,
    local_user_id:        EosEpicAccountId,
    pin_grant_info:       *const c_void,
    continuance_token:    *const c_void,
    acct_feature_info:    *const c_void,  // DEPRECATED field
    selected_account_id:  EosEpicAccountId,
}

#[repr(C)]
struct EosAuthLogoutOptions {
    api_version:   i32,
    // 4 bytes padding
    local_user_id: EosEpicAccountId,
}

#[repr(C)]
struct EosAuthLogoutCallbackInfo {
    result_code:   EosEResult,
    // 4 bytes padding
    client_data:   *mut c_void,
    local_user_id: EosEpicAccountId,
}

#[repr(C)]
struct EosEcomQueryOwnershipOptions {
    api_version:            i32,
    // 4 bytes padding
    local_user_id:          EosEpicAccountId,
    catalog_item_ids:       *const *const c_char,
    catalog_item_ids_count: u32,
    // 4 bytes padding
    catalog_namespace:      *const c_char,
}

#[repr(C)]
struct EosEcomItemOwnership {
    api_version:       i32,
    // 4 bytes padding
    id:                *const c_char,
    ownership_status:  i32,
    // 4 bytes padding (struct size = 24)
}

#[repr(C)]
struct EosEcomQueryOwnershipCallbackInfo {
    result_code:          EosEResult,
    // 4 bytes padding
    client_data:          *mut c_void,
    local_user_id:        EosEpicAccountId,
    item_ownership:       *const EosEcomItemOwnership,
    item_ownership_count: u32,
    // 4 bytes padding
}

#[repr(C)]
struct EosAchievementsQueryDefinitionsOptions {
    api_version:  i32,
    // 4 bytes padding
    local_user_id: *mut c_void,    // EOS_ProductUserId – null = use defaults
    epic_user_id:  *mut c_void,    // EOS_EpicAccountId – deprecated, null
    hidden_ids:    *const *const c_char,
    hidden_count:  u32,
    // 4 bytes padding
}

#[repr(C)]
struct EosAchievementsQueryDefinitionsCompleteInfo {
    result_code: EosEResult,
    // 4 bytes padding
    client_data: *mut c_void,
}

#[repr(C)]
struct EosAchievementsGetDefinitionCountOptions {
    api_version: i32,
}

#[repr(C)]
struct EosAchievementsCopyDefinitionV2ByIndexOptions {
    api_version:      i32,
    achievement_index: u32,
}

#[repr(C)]
struct EosAchievementsStatThresholds {
    api_version: i32,
    name:        *const c_char,
    threshold:   i32,
}

#[repr(C)]
struct EosAchievementsDefinitionV2 {
    api_version:         i32,
    // 4 bytes padding
    achievement_id:      *const c_char,
    unlocked_name:       *const c_char,
    unlocked_desc:       *const c_char,
    locked_name:         *const c_char,
    locked_desc:         *const c_char,
    flavor_text:         *const c_char,
    unlocked_icon_url:   *const c_char,
    locked_icon_url:     *const c_char,
    is_hidden:           EosBool,
    stat_thresholds_count: u32,
    stat_thresholds:     *const EosAchievementsStatThresholds,
}

// ── Raw function pointer types ────────────────────────────────────────────────

type FnEosInitialize        = unsafe extern "C" fn(*const EosInitializeOptions) -> EosEResult;
type FnEosShutdown          = unsafe extern "C" fn() -> EosEResult;
type FnEosPlatformCreate    = unsafe extern "C" fn(*const EosPlatformOptions) -> EosHPlatform;
type FnEosPlatformTick      = unsafe extern "C" fn(EosHPlatform);
type FnEosPlatformRelease   = unsafe extern "C" fn(EosHPlatform);
type FnEosGetVersion        = unsafe extern "C" fn() -> *const c_char;

type FnEosPlatformGetAuth         = unsafe extern "C" fn(EosHPlatform) -> EosHAuth;
type FnEosPlatformGetEcom         = unsafe extern "C" fn(EosHPlatform) -> EosHEcom;
type FnEosPlatformGetAchievements = unsafe extern "C" fn(EosHPlatform) -> EosHAchievements;

type FnEosAuthLogin = unsafe extern "C" fn(
    EosHAuth,
    *const EosAuthLoginOptions,
    *mut c_void,
    unsafe extern "C" fn(*const EosAuthLoginCallbackInfo),
);
type FnEosAuthLogout = unsafe extern "C" fn(
    EosHAuth,
    *const EosAuthLogoutOptions,
    *mut c_void,
    unsafe extern "C" fn(*const EosAuthLogoutCallbackInfo),
);
type FnEosAuthGetLoginStatus            = unsafe extern "C" fn(EosHAuth, EosEpicAccountId) -> i32;
type FnEosAuthGetLoggedInAccountsCount  = unsafe extern "C" fn(EosHAuth) -> i32;
type FnEosAuthGetLoggedInAccountByIndex = unsafe extern "C" fn(EosHAuth, i32) -> EosEpicAccountId;

type FnEosEpicAccountIdToString = unsafe extern "C" fn(EosEpicAccountId, *mut c_char, *mut i32) -> EosEResult;
type FnEosEpicAccountIdIsValid  = unsafe extern "C" fn(EosEpicAccountId) -> EosBool;

type FnEosEcomQueryOwnership = unsafe extern "C" fn(
    EosHEcom,
    *const EosEcomQueryOwnershipOptions,
    *mut c_void,
    unsafe extern "C" fn(*const EosEcomQueryOwnershipCallbackInfo),
);

type FnEosAchievementsQueryDefinitions = unsafe extern "C" fn(
    EosHAchievements,
    *const EosAchievementsQueryDefinitionsOptions,
    *mut c_void,
    unsafe extern "C" fn(*const EosAchievementsQueryDefinitionsCompleteInfo),
);
type FnEosAchievementsGetDefinitionCount = unsafe extern "C" fn(
    EosHAchievements,
    *const EosAchievementsGetDefinitionCountOptions,
) -> u32;
type FnEosAchievementsCopyDefinitionV2ByIndex = unsafe extern "C" fn(
    EosHAchievements,
    *const EosAchievementsCopyDefinitionV2ByIndexOptions,
    *mut *mut EosAchievementsDefinitionV2,
) -> EosEResult;
type FnEosAchievementsDefinitionV2Release = unsafe extern "C" fn(*mut EosAchievementsDefinitionV2);

// ── API function table (set once, never mutated) ──────────────────────────────
struct EosApis {
    fn_initialize:        FnEosInitialize,
    fn_shutdown:          FnEosShutdown,
    fn_platform_create:   FnEosPlatformCreate,
    fn_platform_tick:     FnEosPlatformTick,
    fn_platform_release:  FnEosPlatformRelease,
    fn_get_version:       FnEosGetVersion,
    fn_get_auth:          FnEosPlatformGetAuth,
    fn_get_ecom:          FnEosPlatformGetEcom,
    fn_get_achievements:  FnEosPlatformGetAchievements,
    fn_auth_login:        FnEosAuthLogin,
    fn_auth_logout:       FnEosAuthLogout,
    fn_auth_status:       FnEosAuthGetLoginStatus,
    fn_auth_count:        FnEosAuthGetLoggedInAccountsCount,
    fn_auth_get_by_index: FnEosAuthGetLoggedInAccountByIndex,
    fn_account_to_str:    FnEosEpicAccountIdToString,
    fn_account_is_valid:  FnEosEpicAccountIdIsValid,
    fn_ecom_query_ownership: FnEosEcomQueryOwnership,
    fn_ach_query_defs:    FnEosAchievementsQueryDefinitions,
    fn_ach_def_count:     FnEosAchievementsGetDefinitionCount,
    fn_ach_copy_def:      FnEosAchievementsCopyDefinitionV2ByIndex,
    fn_ach_def_release:   FnEosAchievementsDefinitionV2Release,
}

unsafe impl Send for EosApis {}
unsafe impl Sync for EosApis {}

// ── Runtime state ─────────────────────────────────────────────────────────────
struct EosPlatformState {
    platform: EosHPlatform,
}
unsafe impl Send for EosPlatformState {}

// ── Statics ───────────────────────────────────────────────────────────────────
static EOS_LIB:      OnceLock<Library>                         = OnceLock::new();
static EOS_APIS:     OnceLock<EosApis>                         = OnceLock::new();
static EOS_PLATFORM: OnceLock<Mutex<Option<EosPlatformState>>> = OnceLock::new();
static EOS_TICK_ACTIVE: AtomicBool                             = AtomicBool::new(false);

fn platform_state() -> &'static Mutex<Option<EosPlatformState>> {
    EOS_PLATFORM.get_or_init(|| Mutex::new(None))
}

fn get_platform() -> Option<EosHPlatform> {
    platform_state()
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.platform))
}

// ── DLL location ──────────────────────────────────────────────────────────────
fn locate_eos_dll(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;

    // 1. Next to the app executable (deployed runtime)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(EOS_DLL);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    // 2. Tauri resource directory (bundled with installer)
    if let Ok(res_dir) = app.path().resource_dir() {
        let candidate = res_dir.join(EOS_DLL);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 3. third_party/EOS-SDK/SDK/Bin/ relative to cwd (development)
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd
            .join("third_party/EOS-SDK/SDK/Bin")
            .join(EOS_DLL);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 4. CARGO_MANIFEST_DIR sibling (when running via cargo tauri dev)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir
        .join("../../third_party/EOS-SDK/SDK/Bin")
        .join(EOS_DLL);
    if candidate.exists() {
        return Some(candidate.canonicalize().unwrap_or(candidate));
    }

    None
}

// ── Library loading helper ───────────────────────────────────────────────────
macro_rules! get_fn {
    ($lib:expr, $name:literal, $ty:ty) => {{
        let sym: libloading::Symbol<$ty> = $lib
            .get(concat!($name, "\0").as_bytes())
            .map_err(|e| format!("EOS: missing symbol {}: {}", $name, e))?;
        *sym
    }};
}

fn load_apis(lib: &Library) -> Result<EosApis, String> {
    Ok(unsafe {
        EosApis {
            fn_initialize:        get_fn!(lib, "EOS_Initialize",                               FnEosInitialize),
            fn_shutdown:          get_fn!(lib, "EOS_Shutdown",                                 FnEosShutdown),
            fn_platform_create:   get_fn!(lib, "EOS_Platform_Create",                         FnEosPlatformCreate),
            fn_platform_tick:     get_fn!(lib, "EOS_Platform_Tick",                           FnEosPlatformTick),
            fn_platform_release:  get_fn!(lib, "EOS_Platform_Release",                        FnEosPlatformRelease),
            fn_get_version:       get_fn!(lib, "EOS_GetVersion",                              FnEosGetVersion),
            fn_get_auth:          get_fn!(lib, "EOS_Platform_GetAuthInterface",               FnEosPlatformGetAuth),
            fn_get_ecom:          get_fn!(lib, "EOS_Platform_GetEcomInterface",               FnEosPlatformGetEcom),
            fn_get_achievements:  get_fn!(lib, "EOS_Platform_GetAchievementsInterface",       FnEosPlatformGetAchievements),
            fn_auth_login:        get_fn!(lib, "EOS_Auth_Login",                              FnEosAuthLogin),
            fn_auth_logout:       get_fn!(lib, "EOS_Auth_Logout",                             FnEosAuthLogout),
            fn_auth_status:       get_fn!(lib, "EOS_Auth_GetLoginStatus",                     FnEosAuthGetLoginStatus),
            fn_auth_count:        get_fn!(lib, "EOS_Auth_GetLoggedInAccountsCount",           FnEosAuthGetLoggedInAccountsCount),
            fn_auth_get_by_index: get_fn!(lib, "EOS_Auth_GetLoggedInAccountByIndex",          FnEosAuthGetLoggedInAccountByIndex),
            fn_account_to_str:    get_fn!(lib, "EOS_EpicAccountId_ToString",                  FnEosEpicAccountIdToString),
            fn_account_is_valid:  get_fn!(lib, "EOS_EpicAccountId_IsValid",                   FnEosEpicAccountIdIsValid),
            fn_ecom_query_ownership: get_fn!(lib, "EOS_Ecom_QueryOwnership",                  FnEosEcomQueryOwnership),
            fn_ach_query_defs:    get_fn!(lib, "EOS_Achievements_QueryDefinitions",           FnEosAchievementsQueryDefinitions),
            fn_ach_def_count:     get_fn!(lib, "EOS_Achievements_GetAchievementDefinitionCount", FnEosAchievementsGetDefinitionCount),
            fn_ach_copy_def:      get_fn!(lib, "EOS_Achievements_CopyAchievementDefinitionV2ByIndex", FnEosAchievementsCopyDefinitionV2ByIndex),
            fn_ach_def_release:   get_fn!(lib, "EOS_Achievements_DefinitionV2_Release",       FnEosAchievementsDefinitionV2Release),
        }
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
fn account_id_to_string(apis: &EosApis, id: EosEpicAccountId) -> Option<String> {
    if id.is_null() {
        return None;
    }
    let valid = unsafe { (apis.fn_account_is_valid)(id) };
    if valid == 0 {
        return None;
    }
    let mut buf = vec![0u8; EOS_EPICACCOUNTID_MAX_LENGTH + 1];
    let mut buf_len = (EOS_EPICACCOUNTID_MAX_LENGTH + 1) as i32;
    let res = unsafe { (apis.fn_account_to_str)(id, buf.as_mut_ptr() as *mut c_char, &mut buf_len) };
    if res != EOS_SUCCESS {
        return None;
    }
    let len = (buf_len as usize).saturating_sub(1).min(buf.len());
    String::from_utf8(buf[..len].to_vec()).ok()
}

unsafe fn cstr_to_string(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        None
    } else {
        Some(CStr::from_ptr(ptr).to_string_lossy().into_owned())
    }
}

// ── EOS async callbacks ───────────────────────────────────────────────────────
// ClientData is a Box<SyncSender<Result<T, String>>> cast to *mut c_void.

// Payload sent back from the login callback
#[derive(Debug)]
struct LoginCallbackPayload {
    result: EosEResult,
    account_id: Option<String>,
}

unsafe extern "C" fn eos_login_callback(data: *const EosAuthLoginCallbackInfo) {
    if data.is_null() {
        return;
    }
    let info = &*data;
    let tx = Box::from_raw(info.client_data as *mut mpsc::SyncSender<LoginCallbackPayload>);
    let account_id = EOS_APIS
        .get()
        .and_then(|apis| account_id_to_string(apis, info.local_user_id));
    let _ = tx.send(LoginCallbackPayload {
        result: info.result_code,
        account_id,
    });
}

unsafe extern "C" fn eos_logout_callback(data: *const EosAuthLogoutCallbackInfo) {
    if data.is_null() {
        return;
    }
    let info = &*data;
    let tx = Box::from_raw(info.client_data as *mut mpsc::SyncSender<EosEResult>);
    let _ = tx.send(info.result_code);
}

unsafe extern "C" fn eos_ownership_callback(data: *const EosEcomQueryOwnershipCallbackInfo) {
    if data.is_null() {
        return;
    }
    let info = &*data;
    let tx = Box::from_raw(
        info.client_data as *mut mpsc::SyncSender<Result<Vec<OwnershipResult>, String>>,
    );
    if info.result_code != EOS_SUCCESS {
        let _ = tx.send(Err(format!(
            "EOS_Ecom_QueryOwnership failed: {}",
            info.result_code
        )));
        return;
    }
    let count = info.item_ownership_count as usize;
    let mut results = Vec::with_capacity(count);
    for i in 0..count {
        let item = &*info.item_ownership.add(i);
        let id = cstr_to_string(item.id).unwrap_or_default();
        results.push(OwnershipResult {
            catalog_item_id: id,
            owned: item.ownership_status == EOS_OS_OWNED,
        });
    }
    let _ = tx.send(Ok(results));
}

unsafe extern "C" fn eos_query_defs_callback(
    data: *const EosAchievementsQueryDefinitionsCompleteInfo,
) {
    if data.is_null() {
        return;
    }
    let info = &*data;
    let tx = Box::from_raw(info.client_data as *mut mpsc::SyncSender<EosEResult>);
    let _ = tx.send(info.result_code);
}

// ── Public serializable types ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EosConfig {
    pub product_id:    String,
    pub sandbox_id:    String,
    pub deployment_id: String,
    pub client_id:     String,
    pub enabled:       bool,
}

impl Default for EosConfig {
    fn default() -> Self {
        Self {
            product_id:    String::new(),
            sandbox_id:    String::new(),
            deployment_id: String::new(),
            client_id:     String::new(),
            enabled:       false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EosStatusResult {
    pub is_initialized: bool,
    pub is_logged_in:   bool,
    pub account_id:     Option<String>,
    pub sdk_version:    Option<String>,
    pub dll_path:       Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OwnershipResult {
    pub catalog_item_id: String,
    pub owned:           bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EosAchievementDef {
    pub achievement_id: String,
    pub display_name:   String,
    pub description:    String,
    pub is_hidden:      bool,
    pub locked_icon_url:   Option<String>,
    pub unlocked_icon_url: Option<String>,
}

// ── Config persistence ────────────────────────────────────────────────────────
const VAULT_CLIENT_SECRET_KEY: &str = "eos:client_secret";
const CONFIG_FILENAME: &str = "eos_config.json";

fn load_config() -> EosConfig {
    use crate::data_paths::app_data_root;
    let path = app_data_root().join(CONFIG_FILENAME);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist_config(cfg: &EosConfig) -> Result<(), String> {
    use crate::data_paths::app_data_root;
    let path = app_data_root().join(CONFIG_FILENAME);
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn eos_get_config() -> EosConfig {
    load_config()
}

#[tauri::command]
pub fn eos_save_config(config: EosConfig, client_secret: Option<String>) -> Result<(), String> {
    persist_config(&config)?;
    if let Some(secret) = client_secret {
        if !secret.is_empty() {
            crate::vault::set_secret(VAULT_CLIENT_SECRET_KEY, &secret)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn eos_get_client_secret_set() -> bool {
    crate::vault::get_secret(VAULT_CLIENT_SECRET_KEY)
        .ok()
        .flatten()
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

#[tauri::command]
pub fn eos_initialize(app: AppHandle) -> Result<(), String> {
    // Already initialized?
    if EOS_APIS.get().is_some() {
        if get_platform().is_some() {
            return Ok(());
        }
    }

    let cfg = load_config();
    if !cfg.enabled {
        return Err("EOS integration is disabled in settings".to_string());
    }
    if cfg.product_id.is_empty()
        || cfg.sandbox_id.is_empty()
        || cfg.deployment_id.is_empty()
        || cfg.client_id.is_empty()
    {
        return Err("EOS configuration is incomplete (check Product/Sandbox/Deployment/Client IDs)".to_string());
    }
    let client_secret = crate::vault::get_secret(VAULT_CLIENT_SECRET_KEY)
        .ok()
        .flatten()
        .unwrap_or_default();
    if client_secret.is_empty() {
        return Err("EOS client secret is not set".to_string());
    }

    let dll_path = locate_eos_dll(&app).ok_or_else(|| {
        format!(
            "EOS SDK DLL ({}) not found. Place it next to the executable or in third_party/EOS-SDK/SDK/Bin/",
            EOS_DLL
        )
    })?;

    // Load the library (stored in OnceLock so it is never unloaded while the process runs)
    if EOS_LIB.get().is_none() {
        let lib = unsafe { Library::new(&dll_path) }
            .map_err(|e| format!("Failed to load EOS SDK: {}", e))?;
        EOS_LIB.set(lib).ok();
    }
    let lib = EOS_LIB.get().unwrap();

    // Bind all API function pointers (stored in OnceLock for the process lifetime)
    if EOS_APIS.get().is_none() {
        let apis = load_apis(lib)?;
        EOS_APIS.set(apis).ok();
    }
    let apis = EOS_APIS.get().unwrap();

    // --- EOS_Initialize ---
    let product_name = CString::new("LIBMALY").unwrap();
    let product_version = CString::new(env!("CARGO_PKG_VERSION")).unwrap();
    let init_opts = EosInitializeOptions {
        api_version:    EOS_INITIALIZE_API_LATEST,
        alloc_fn:       std::ptr::null(),
        realloc_fn:     std::ptr::null(),
        free_fn:        std::ptr::null(),
        product_name:   product_name.as_ptr(),
        product_version: product_version.as_ptr(),
        reserved:       std::ptr::null_mut(),
        system_init:    std::ptr::null_mut(),
        thread_affinity: std::ptr::null_mut(),
    };
    let init_result = unsafe { (apis.fn_initialize)(&init_opts) };
    if init_result != EOS_SUCCESS && init_result != EOS_ALREADY_CONFIGURED {
        return Err(format!("EOS_Initialize failed: {}", init_result));
    }

    // --- EOS_Platform_Create ---
    let product_id_c    = CString::new(cfg.product_id.as_str()).unwrap();
    let sandbox_id_c    = CString::new(cfg.sandbox_id.as_str()).unwrap();
    let deployment_id_c = CString::new(cfg.deployment_id.as_str()).unwrap();
    let client_id_c     = CString::new(cfg.client_id.as_str()).unwrap();
    let client_secret_c = CString::new(client_secret.as_str()).unwrap();

    let platform_opts = EosPlatformOptions {
        api_version:  EOS_PLATFORM_OPTIONS_API_LATEST,
        reserved:     std::ptr::null(),
        product_id:   product_id_c.as_ptr(),
        sandbox_id:   sandbox_id_c.as_ptr(),
        client_credentials: EosPlatformClientCredentials {
            client_id:     client_id_c.as_ptr(),
            client_secret: client_secret_c.as_ptr(),
        },
        is_server:    0,  // client application
        encryption_key:        std::ptr::null(),
        override_country_code: std::ptr::null(),
        override_locale_code:  std::ptr::null(),
        deployment_id: deployment_id_c.as_ptr(),
        flags: EOS_PF_DISABLE_OVERLAY | EOS_PF_DISABLE_SOCIAL_OVERLAY,
        cache_directory: std::ptr::null(),
        tick_budget_ms: 0,
        rtc_options:                  std::ptr::null(),
        integrated_platform_options:  std::ptr::null(),
        system_specific:              std::ptr::null(),
        task_network_timeout:         std::ptr::null(),
    };
    let platform = unsafe { (apis.fn_platform_create)(&platform_opts) };
    if platform.is_null() {
        return Err("EOS_Platform_Create returned null — check credentials".to_string());
    }

    // Store the platform handle
    {
        let mut guard = platform_state().lock().unwrap();
        *guard = Some(EosPlatformState { platform });
    }

    // Start background tick thread
    EOS_TICK_ACTIVE.store(true, Ordering::SeqCst);
    thread::spawn(move || {
        while EOS_TICK_ACTIVE.load(Ordering::Relaxed) {
            if let Some(handle) = get_platform() {
                if let Some(apis) = EOS_APIS.get() {
                    unsafe { (apis.fn_platform_tick)(handle) };
                }
            } else {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn eos_shutdown() -> Result<(), String> {
    EOS_TICK_ACTIVE.store(false, Ordering::SeqCst);
    thread::sleep(Duration::from_millis(250)); // allow tick thread to exit

    let platform = {
        let mut guard = platform_state().lock().unwrap();
        guard.take().map(|s| s.platform)
    };

    if let Some(handle) = platform {
        if let Some(apis) = EOS_APIS.get() {
            unsafe {
                (apis.fn_platform_release)(handle);
                let _ = (apis.fn_shutdown)();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn eos_get_status() -> EosStatusResult {
    let is_initialized = EOS_APIS.get().is_some() && get_platform().is_some();

    let mut account_id = None;
    let mut is_logged_in = false;

    if let (Some(apis), Some(platform)) = (EOS_APIS.get(), get_platform()) {
        let auth = unsafe { (apis.fn_get_auth)(platform) };
        let count = unsafe { (apis.fn_auth_count)(auth) };
        if count > 0 {
            let id = unsafe { (apis.fn_auth_get_by_index)(auth, 0) };
            let status = unsafe { (apis.fn_auth_status)(auth, id) };
            is_logged_in = status == EOS_LS_LOGGED_IN;
            account_id = account_id_to_string(apis, id);
        }
    }

    let sdk_version = EOS_APIS.get().map(|apis| {
        let ptr = unsafe { (apis.fn_get_version)() };
        if ptr.is_null() {
            "unknown".to_string()
        } else {
            unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
        }
    });

    EosStatusResult {
        is_initialized,
        is_logged_in,
        account_id,
        sdk_version,
        dll_path: None, // not exposed for security
    }
}

#[tauri::command]
pub async fn eos_login(login_type: String) -> Result<String, String> {
    // All FFI work in a sync scope — raw pointers are !Send and must not cross .await
    let rx = {
        let platform = get_platform().ok_or("EOS not initialized — call eos_initialize first")?;
        let apis = EOS_APIS.get().ok_or("EOS not initialized")?;

        let auth = unsafe { (apis.fn_get_auth)(platform) };

        let credential_type = match login_type.as_str() {
            "exchange_code"   => EOS_LCT_EXCHANGE_CODE,
            "persistent"      => EOS_LCT_PERSISTENT_AUTH,
            "account_portal"  => EOS_LCT_ACCOUNT_PORTAL,
            other => return Err(format!("Unknown EOS login type: {}", other)),
        };

        let creds = EosAuthCredentials {
            api_version:     EOS_AUTH_CREDENTIALS_API_LATEST,
            id:              std::ptr::null(),
            token:           std::ptr::null(),
            credential_type,
            system_auth_opts: std::ptr::null_mut(),
            external_type:   0,
        };
        let opts = EosAuthLoginOptions {
            api_version:  EOS_AUTH_LOGIN_API_LATEST,
            credentials:  &creds,
            scope_flags:  EOS_SCOPE_FLAGS,
            login_flags:  0,
        };

        let (tx, rx) = mpsc::sync_channel::<LoginCallbackPayload>(1);
        let tx_ptr = Box::into_raw(Box::new(tx)) as *mut c_void;

        unsafe { (apis.fn_auth_login)(auth, &opts, tx_ptr, eos_login_callback) };
        rx
        // creds, opts, auth, platform (all !Send) dropped here
    };

    // Only rx (Receiver<LoginCallbackPayload>: Send) crosses the await
    // Wait on tick thread to deliver the callback (up to 120 s for account portal)
    let payload = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(120))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "EOS login timed out".to_string())?;

    if payload.result != EOS_SUCCESS {
        return Err(format!("EOS login failed (code {})", payload.result));
    }
    payload
        .account_id
        .ok_or_else(|| "EOS login succeeded but no account ID returned".to_string())
}

#[tauri::command]
pub async fn eos_logout() -> Result<(), String> {
    // All FFI work in a sync scope — raw pointers are !Send and must not cross .await
    let rx = {
        let platform = get_platform().ok_or("EOS not initialized")?;
        let apis = EOS_APIS.get().ok_or("EOS not initialized")?;

        let auth = unsafe { (apis.fn_get_auth)(platform) };
        let count = unsafe { (apis.fn_auth_count)(auth) };
        if count == 0 {
            return Ok(()); // already logged out
        }
        let local_user_id = unsafe { (apis.fn_auth_get_by_index)(auth, 0) };

        let opts = EosAuthLogoutOptions {
            api_version:   EOS_AUTH_LOGOUT_API_LATEST,
            local_user_id,
        };

        let (tx, rx) = mpsc::sync_channel::<EosEResult>(1);
        let tx_ptr = Box::into_raw(Box::new(tx)) as *mut c_void;

        unsafe { (apis.fn_auth_logout)(auth, &opts, tx_ptr, eos_logout_callback) };
        rx
        // opts, local_user_id, auth, platform (all !Send) dropped here
    };

    let result = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(30))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "EOS logout timed out".to_string())?;

    if result != EOS_SUCCESS {
        return Err(format!("EOS logout failed (code {})", result));
    }
    Ok(())
}

#[tauri::command]
pub async fn eos_query_ownership(
    catalog_item_ids: Vec<String>,
) -> Result<Vec<OwnershipResult>, String> {
    if catalog_item_ids.is_empty() {
        return Ok(vec![]);
    }
    if catalog_item_ids.len() > 400 {
        return Err("EOS_Ecom_QueryOwnership: maximum 400 catalog item IDs per call".to_string());
    }

    // Build CStrings before the FFI scope — Vec<CString> is Send, so it can cross .await
    let cstrings: Vec<CString> = catalog_item_ids
        .iter()
        .map(|s| CString::new(s.as_str()).unwrap_or_default())
        .collect();

    // All FFI work (non-Send raw ptrs) in a sync block that ends before the await
    let rx = {
        let ptrs: Vec<*const c_char> = cstrings.iter().map(|s| s.as_ptr()).collect();

        let platform = get_platform().ok_or("EOS not initialized")?;
        let apis = EOS_APIS.get().ok_or("EOS not initialized")?;
        let auth = unsafe { (apis.fn_get_auth)(platform) };
        let count = unsafe { (apis.fn_auth_count)(auth) };
        if count == 0 {
            return Err("Not logged in to EOS".to_string());
        }
        let local_user_id = unsafe { (apis.fn_auth_get_by_index)(auth, 0) };

        let ecom = unsafe { (apis.fn_get_ecom)(platform) };
        let opts = EosEcomQueryOwnershipOptions {
            api_version:            EOS_ECOM_QUERYOWNERSHIP_API_LATEST,
            local_user_id,
            catalog_item_ids:       ptrs.as_ptr(),
            catalog_item_ids_count: ptrs.len() as u32,
            catalog_namespace:      std::ptr::null(),
        };

        let (tx, rx) = mpsc::sync_channel::<Result<Vec<OwnershipResult>, String>>(1);
        let tx_ptr = Box::into_raw(Box::new(tx)) as *mut c_void;

        unsafe { (apis.fn_ecom_query_ownership)(ecom, &opts, tx_ptr, eos_ownership_callback) };
        rx
        // ptrs, local_user_id, ecom, opts (!Send) dropped here
    };

    // Only cstrings (Vec<CString>: Send) and rx (Receiver<…>: Send) cross the await
    tokio::task::spawn_blocking(move || {
        let _keep_alive = cstrings; // keep CString buffers alive until callback fires
        rx.recv_timeout(Duration::from_secs(30))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "EOS ownership query timed out".to_string())?
}

#[tauri::command]
pub async fn eos_get_achievements() -> Result<Vec<EosAchievementDef>, String> {
    // Phase 1: issue the async definitions query — all FFI in a sync scope (!Send raw ptrs)
    let rx = {
        let platform = get_platform().ok_or("EOS not initialized")?;
        let apis = EOS_APIS.get().ok_or("EOS not initialized")?;

        let ach_handle = unsafe { (apis.fn_get_achievements)(platform) };

        let query_opts = EosAchievementsQueryDefinitionsOptions {
            api_version:  EOS_ACHIEVEMENTS_QUERYDEFINITIONS_API_LATEST,
            local_user_id: std::ptr::null_mut(),
            epic_user_id:  std::ptr::null_mut(),
            hidden_ids:    std::ptr::null(),
            hidden_count:  0,
        };
        let (tx, rx) = mpsc::sync_channel::<EosEResult>(1);
        let tx_ptr = Box::into_raw(Box::new(tx)) as *mut c_void;

        unsafe {
            (apis.fn_ach_query_defs)(ach_handle, &query_opts, tx_ptr, eos_query_defs_callback)
        };
        rx
        // ach_handle, query_opts (!Send) dropped here
    };

    // Only rx (Receiver<EosEResult>: Send) crosses the await
    let query_result = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(30))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "EOS achievement definitions query timed out".to_string())?;

    if query_result != EOS_SUCCESS {
        return Err(format!(
            "EOS_Achievements_QueryDefinitions failed (code {})",
            query_result
        ));
    }

    // Phase 2: enumerate the now-cached definitions — wrap in spawn_blocking because
    // ach_handle and def_ptr are !Send raw pointers and this code is after the last .await.
    tokio::task::spawn_blocking(|| -> Result<Vec<EosAchievementDef>, String> {
        let platform = get_platform().ok_or("EOS not initialized")?;
        let apis = EOS_APIS.get().ok_or("EOS not initialized")?;

        let ach_handle = unsafe { (apis.fn_get_achievements)(platform) };

        let count_opts = EosAchievementsGetDefinitionCountOptions {
            api_version: EOS_ACHIEVEMENTS_GETDEFINITIONCOUNT_API_LATEST,
        };
        let count = unsafe { (apis.fn_ach_def_count)(ach_handle, &count_opts) };

        let mut defs = Vec::with_capacity(count as usize);
        for i in 0..count {
            let copy_opts = EosAchievementsCopyDefinitionV2ByIndexOptions {
                api_version:      EOS_ACHIEVEMENTS_COPYDEFINITIONV2_API_LATEST,
                achievement_index: i,
            };
            let mut def_ptr: *mut EosAchievementsDefinitionV2 = std::ptr::null_mut();
            let res = unsafe { (apis.fn_ach_copy_def)(ach_handle, &copy_opts, &mut def_ptr) };
            if res != EOS_SUCCESS || def_ptr.is_null() {
                continue;
            }
            let def = unsafe { &*def_ptr };
            let achievement_id    = unsafe { cstr_to_string(def.achievement_id).unwrap_or_default() };
            let display_name      = unsafe { cstr_to_string(def.unlocked_name).unwrap_or_else(|| achievement_id.clone()) };
            let description       = unsafe { cstr_to_string(def.unlocked_desc).unwrap_or_default() };
            let locked_icon_url   = unsafe { cstr_to_string(def.locked_icon_url) };
            let unlocked_icon_url = unsafe { cstr_to_string(def.unlocked_icon_url) };
            let is_hidden = def.is_hidden != 0;

            defs.push(EosAchievementDef {
                achievement_id,
                display_name,
                description,
                is_hidden,
                locked_icon_url,
                unlocked_icon_url,
            });

            unsafe { (apis.fn_ach_def_release)(def_ptr) };
        }
        Ok(defs)
    })
    .await
    .map_err(|e| e.to_string())?
}
