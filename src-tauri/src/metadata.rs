use reqwest::Client;
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use crate::data_paths::app_data_root;

// ── Cookie store with disk persistence ────────────────────────────────────

static COOKIE_STORE: Mutex<Option<Arc<CookieStoreMutex>>> = Mutex::new(None);

fn cookies_path() -> PathBuf {
    app_data_root().join("f95cookies.json")
}

fn load_or_new_store() -> Arc<CookieStoreMutex> {
    let path = cookies_path();
    if path.exists() {
        if let Ok(f) = std::fs::File::open(&path) {
            #[allow(deprecated)]
            if let Ok(store) = CookieStore::load_json(BufReader::new(f)) {
                return Arc::new(CookieStoreMutex::new(store));
            }
        }
    }
    Arc::new(CookieStoreMutex::new(CookieStore::new(None)))
}

fn save_cookies(store: &CookieStoreMutex) {
    let path = cookies_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::File::create(&path) {
        let locked = store.lock().unwrap();
        #[allow(deprecated)]
        let _ = locked.save_json(&mut f);
    }
}

fn ensure_store() -> Arc<CookieStoreMutex> {
    let mut guard = COOKIE_STORE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(load_or_new_store());
    }
    guard.as_ref().unwrap().clone()
}

fn make_client(store: Arc<CookieStoreMutex>) -> Client {
    Client::builder()
        .cookie_provider(store)
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
             AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/124.0.0.0 Safari/537.36",
        )
        .build()
        .expect("failed to build reqwest client")
}

pub fn http() -> Client {
    make_client(ensure_store())
}

// ── Metadata struct ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct GameMetadata {
    pub source: String, // "f95" | "dlsite" | "vndb" | "mangagamer" | "johren" | "fakku"
    pub source_url: String,
    pub title: Option<String>,
    pub version: Option<String>,
    pub developer: Option<String>,
    pub overview: Option<String>,
    /// For DLsite: HTML fragment (may contain <img>). For F95: plain text paragraphs (\n separated).
    pub overview_html: Option<String>,
    pub cover_url: Option<String>,
    pub screenshots: Vec<String>,
    pub tags: Vec<String>,
    pub relations: Vec<String>,
    pub engine: Option<String>,
    pub os: Option<String>,
    pub language: Option<String>,
    pub censored: Option<String>,
    pub release_date: Option<String>,
    pub last_updated: Option<String>,
    pub rating: Option<String>,
    pub price: Option<String>,
    // extended DLsite fields
    pub circle: Option<String>,
    pub series: Option<String>,
    pub author: Option<String>,
    pub illustration: Option<String>,
    pub voice_actor: Option<String>,
    pub music: Option<String>,
    pub age_rating: Option<String>,
    pub product_format: Option<String>,
    pub file_format: Option<String>,
    pub file_size: Option<String>,
}

// ── F95zone ────────────────────────────────────────────────────────────────

/// Returns `(csrf_token, already_logged_in)`
async fn f95_get_login_state() -> Result<(String, bool), String> {
    let resp = http()
        .get("https://f95zone.to/login/")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let doc = Html::parse_document(&body);

    // If already logged in the page redirects / has no login form
    let already = !body.contains("name=\"login\"");

    let token = {
        let sel = Selector::parse("input[name=_xfToken]").unwrap();
        doc.select(&sel)
            .next()
            .and_then(|el| el.value().attr("value"))
            .unwrap_or("")
            .to_string()
    };

    Ok((token, already))
}

#[tauri::command]
pub async fn f95_login(username: String, password: String) -> Result<bool, String> {
    let (token, already) = f95_get_login_state().await?;
    if already {
        return Ok(true);
    }

    let params = [
        ("login", username.as_str()),
        ("password", password.as_str()),
        ("remember", "1"),
        ("_xfRedirect", "/"),
        ("_xfToken", token.as_str()),
    ];

    let resp = http()
        .post("https://f95zone.to/login/login")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // XenForo redirects to "/" on success
    let success = resp.status().is_success() || resp.status().as_u16() == 303;

    // Double-check by fetching a page that's only accessible when logged in
    if success {
        let check = http()
            .get("https://f95zone.to/")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let body = check.text().await.map_err(|e| e.to_string())?;
        let logged_in = !body.contains("data-logged-in=\"false\"");
        if logged_in {
            // Persist cookies so next app launch stays logged in
            save_cookies(&ensure_store());
        }
        return Ok(logged_in);
    }

    Ok(false)
}

#[tauri::command]
pub async fn f95_logout() -> Result<(), String> {
    // Replace the store with a fresh empty one and delete the cookie file
    *COOKIE_STORE.lock().unwrap() = Some(Arc::new(CookieStoreMutex::new(CookieStore::new(None))));
    let _ = std::fs::remove_file(cookies_path());
    Ok(())
}

#[tauri::command]
pub async fn f95_is_logged_in() -> Result<bool, String> {
    let resp = http()
        .get("https://f95zone.to/")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body.contains("data-logged-in=\"true\""))
}

// ── DLsite auth ──────────────────────────────────────────────────────────────
// DLsite uses a separate viviON ID SPA at login.dlsite.com.
// The login flow:
//   1. GET  login.dlsite.com/login  → sets XSRF-TOKEN cookie
//   2. POST login.dlsite.com/api/login  JSON {login_id, password},
//          header X-XSRF-TOKEN: <token>
//   3. Verify via  www.dlsite.com/home/mypage  (redirects to /home/  if not logged in)

static DLSITE_STORE: Mutex<Option<Arc<CookieStoreMutex>>> = Mutex::new(None);
static SUGGEST_CACHE: std::sync::OnceLock<Mutex<HashMap<String, Vec<SearchResultItem>>>> =
    std::sync::OnceLock::new();

fn suggest_cache() -> &'static Mutex<HashMap<String, Vec<SearchResultItem>>> {
    SUGGEST_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn dlsite_cookies_path() -> PathBuf {
    app_data_root().join("dlsite_cookies.json")
}

fn dlsite_load_or_new_store() -> Arc<CookieStoreMutex> {
    let path = dlsite_cookies_path();
    if path.exists() {
        if let Ok(f) = std::fs::File::open(&path) {
            #[allow(deprecated)]
            if let Ok(store) = CookieStore::load_json(BufReader::new(f)) {
                return Arc::new(CookieStoreMutex::new(store));
            }
        }
    }
    Arc::new(CookieStoreMutex::new(CookieStore::new(None)))
}

fn dlsite_save_cookies(store: &CookieStoreMutex) {
    let path = dlsite_cookies_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::File::create(&path) {
        let locked = store.lock().unwrap();
        #[allow(deprecated)]
        let _ = locked.save_json(&mut f);
    }
}

fn dlsite_ensure_store() -> Arc<CookieStoreMutex> {
    let mut guard = DLSITE_STORE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(dlsite_load_or_new_store());
    }
    guard.as_ref().unwrap().clone()
}

pub fn dlsite_http() -> Client {
    make_client(dlsite_ensure_store())
}

#[tauri::command]
pub async fn dlsite_login(login_id: String, password: String) -> Result<bool, String> {
    // Step 1: GET login page to obtain the _token hidden field and initial cookies
    let page_resp = dlsite_http()
        .get("https://login.dlsite.com/login")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "en-US,en;q=0.9,ja;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Failed to reach DLsite login page: {}", e))?;

    let body = page_resp.text().await.map_err(|e| e.to_string())?;

    // Extract CSRF _token from the HTML form
    let token = {
        let doc = Html::parse_document(&body);
        let sel = Selector::parse("input[name=_token]").unwrap();
        doc.select(&sel)
            .next()
            .and_then(|el| el.value().attr("value"))
            .unwrap_or("")
            .to_string()
    };

    if token.is_empty() {
        return Err("Failed to extract CSRF token from DLsite login page.".into());
    }

    // Step 2: POST form-encoded credentials
    let params = [
        ("_token", token.as_str()),
        ("login_id", login_id.as_str()),
        ("password", password.as_str()),
    ];

    let resp = dlsite_http()
        .post("https://login.dlsite.com/login")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Referer", "https://login.dlsite.com/login")
        .header("Origin", "https://login.dlsite.com")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Login request failed: {}", e))?;

    // On success, DLsite typically redirects to a dashboard or mypage (302)
    // Reqwest follows redirects by default, so we check if the final response is successful.
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Login failed (HTTP {})", status));
    }

    // Step 3: Verify by hitting mypage
    let check = dlsite_http()
        .get("https://www.dlsite.com/home/mypage/")
        .header("Accept-Language", "en-US,en;q=0.9,ja;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    // If redirected away from /home/mypage, not truly logged in
    let final_url = check.url().to_string();
    let logged_in = final_url.contains("/home/mypage") || final_url.contains("/maniax/mypage");

    if logged_in {
        dlsite_save_cookies(&dlsite_ensure_store());
    }

    Ok(logged_in)
}

#[tauri::command]
pub async fn dlsite_logout() -> Result<(), String> {
    *DLSITE_STORE.lock().unwrap() = Some(Arc::new(CookieStoreMutex::new(CookieStore::new(None))));
    let _ = std::fs::remove_file(dlsite_cookies_path());
    Ok(())
}

#[tauri::command]
pub async fn dlsite_is_logged_in() -> Result<bool, String> {
    let resp = dlsite_http()
        .get("https://www.dlsite.com/home/mypage/")
        .header("Accept-Language", "en-US,en;q=0.9,ja;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let final_url = resp.url().to_string();
    Ok(final_url.contains("/home/mypage") || final_url.contains("/maniax/mypage"))
}

// ── FAKKU auth ───────────────────────────────────────────────────────────────
static FAKKU_STORE: Mutex<Option<Arc<CookieStoreMutex>>> = Mutex::new(None);

fn fakku_cookies_path() -> PathBuf {
    app_data_root().join("fakku_cookies.json")
}

fn fakku_load_or_new_store() -> Arc<CookieStoreMutex> {
    let path = fakku_cookies_path();
    if path.exists() {
        if let Ok(f) = std::fs::File::open(&path) {
            #[allow(deprecated)]
            if let Ok(store) = CookieStore::load_json(BufReader::new(f)) {
                return Arc::new(CookieStoreMutex::new(store));
            }
        }
    }
    Arc::new(CookieStoreMutex::new(CookieStore::new(None)))
}

fn fakku_save_cookies(store: &CookieStoreMutex) {
    let path = fakku_cookies_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::File::create(&path) {
        let locked = store.lock().unwrap();
        #[allow(deprecated)]
        let _ = locked.save_json(&mut f);
    }
}

fn fakku_ensure_store() -> Arc<CookieStoreMutex> {
    let mut guard = FAKKU_STORE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(fakku_load_or_new_store());
    }
    guard.as_ref().unwrap().clone()
}

fn fakku_http() -> Client {
    make_client(fakku_ensure_store())
}

fn extract_fakku_csrf_token(doc: &Html) -> Option<String> {
    // Try common hidden-input csrf patterns first.
    for selector in [
        "input[name=_token]",
        "input[name=csrf_token]",
        "input[name=csrf]",
        "input[name=authenticity_token]",
    ] {
        if let Some(token) = doc
            .select(&sel(selector))
            .next()
            .and_then(|el| el.value().attr("value"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            return Some(token);
        }
    }
    // Fallback to meta csrf token.
    doc.select(&sel("meta[name='csrf-token']"))
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn fakku_login_looks_successful(body: &str) -> bool {
    let lower = body.to_lowercase();
    let has_logout = lower.contains("/logout")
        || lower.contains("sign out")
        || lower.contains("log out")
        || lower.contains("my account");
    let has_login = lower.contains("/login")
        || lower.contains("sign in")
        || lower.contains("log in");
    has_logout && !has_login
}

#[tauri::command]
pub async fn fakku_login(email: String, password: String) -> Result<bool, String> {
    // 1) Load login page and CSRF.
    let page = fakku_http()
        .get("https://www.fakku.net/login")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Failed to reach FAKKU login page: {}", e))?;
    if !page.status().is_success() {
        return Err(format!("FAKKU login page HTTP {}", page.status()));
    }
    let body = page.text().await.map_err(|e| e.to_string())?;
    let csrf = {
        let doc = Html::parse_document(&body);
        extract_fakku_csrf_token(&doc)
    };

    // 2) Submit credentials. FAKKU login is JS-driven, so try several likely endpoints/payloads.
    let mut success = false;
    let csrf_header = csrf.clone().unwrap_or_default();

    // 2a) Classic form post.
    {
        let mut params: Vec<(&str, &str)> = vec![
            ("email", email.as_str()),
            ("password", password.as_str()),
            ("remember", "1"),
        ];
        if let Some(token) = csrf.as_deref() {
            params.push(("_token", token));
            params.push(("csrf_token", token));
            params.push(("csrf", token));
            params.push(("authenticity_token", token));
        }
        let resp = fakku_http()
            .post("https://www.fakku.net/login")
            .header("Referer", "https://www.fakku.net/login")
            .header("Origin", "https://www.fakku.net")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("x-csrf-token", csrf_header.clone())
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("FAKKU login request failed: {}", e))?;
        if resp.status().is_success() || resp.status().is_redirection() {
            success = true;
        }
    }

    // 2b) JSON endpoint fallbacks used by modern web apps.
    if !success {
        let candidates = [
            "https://www.fakku.net/api/auth/login",
            "https://www.fakku.net/api/login",
            "https://www.fakku.net/api/auth/sign-in",
            "https://www.fakku.net/api/auth/signin",
        ];
        for endpoint in candidates {
            let payload = serde_json::json!({
                "email": email,
                "password": password,
            });
            let resp = match fakku_http()
                .post(endpoint)
                .header("Referer", "https://www.fakku.net/login")
                .header("Origin", "https://www.fakku.net")
                .header("Accept", "application/json, text/plain, */*")
                .header("Content-Type", "application/json")
                .header("x-csrf-token", csrf_header.clone())
                .json(&payload)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => continue,
            };
            if resp.status().is_success() || resp.status().is_redirection() {
                success = true;
                break;
            }
        }
    }

    if !success {
        return Err("FAKKU login request was rejected.".to_string());
    }

    // 3) Verify by reloading homepage with authenticated cookies.
    let check = fakku_http()
        .get("https://www.fakku.net/")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let check_body = check.text().await.map_err(|e| e.to_string())?;
    let logged_in = fakku_login_looks_successful(&check_body);
    if logged_in {
        fakku_save_cookies(&fakku_ensure_store());
    }
    Ok(logged_in)
}

#[tauri::command]
pub async fn fakku_logout() -> Result<(), String> {
    *FAKKU_STORE.lock().unwrap() = Some(Arc::new(CookieStoreMutex::new(CookieStore::new(None))));
    let _ = std::fs::remove_file(fakku_cookies_path());
    Ok(())
}

#[tauri::command]
pub async fn fakku_is_logged_in() -> Result<bool, String> {
    let resp = fakku_http()
        .get("https://www.fakku.net/")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(fakku_login_looks_successful(&body))
}

fn sel(s: &str) -> Selector {
    Selector::parse(s).unwrap_or_else(|_| Selector::parse("__never__").unwrap())
}

fn normalize_f95_thread_url(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let Some(hash_idx) = s.find('#') {
        s.truncate(hash_idx);
    }
    if let Some(q_idx) = s.find('?') {
        s.truncate(q_idx);
    }
    if let Some(idx) = s.find("/threads/") {
        let prefix = &s[..idx + "/threads/".len()];
        let rest = &s[idx + "/threads/".len()..];
        // Keep only first path segment after /threads/, strip page/post tails.
        let first = rest.split('/').next().unwrap_or(rest).trim_matches('/');
        if !first.is_empty() {
            return format!("{prefix}{first}/");
        }
    }
    s
}

fn text_of(doc: &Html, selector: &str) -> Option<String> {
    let s = sel(selector);
    doc.select(&s)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Extract `<b>Label</b>: value` blocks from the first post on F95zone.
fn extract_field(html_text: &str, label: &str) -> Option<String> {
    let needle = format!("<b>{}</b>:", label);
    let idx = html_text.find(&needle)?;
    let after = &html_text[idx + needle.len()..];
    // Take until the next <br>, <b> or end of excerpt
    let end = after
        .find("<br>")
        .or_else(|| after.find("<b>"))
        .unwrap_or(200.min(after.len()));
    let raw = &after[..end];
    // Strip all HTML tags
    let doc = Html::parse_fragment(raw);
    let text = doc.root_element().text().collect::<String>();
    let cleaned = text.trim().to_string();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

#[tauri::command]
pub async fn fetch_f95_metadata(url: String) -> Result<GameMetadata, String> {
    let normalized_url = normalize_f95_thread_url(&url);
    let resp = http()
        .get(&normalized_url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let doc = Html::parse_document(&body);

    // ── Title ────────────────────────────────────────────────────────
    // Remove all <a class="labelLink">...</a> spans (prefix badges like RPGM, Completed)
    // Then strip [v1.0] [Developer] brackets and trim
    let title = {
        // Get just the direct text nodes (not inside labelLink children)
        let full_text: String = {
            let s = sel("h1.p-title-value");
            doc.select(&s)
                .next()
                .map(|el| {
                    // Collect text of child nodes that are NOT labelLink/label-append
                    let mut result = String::new();
                    for node in el.children() {
                        use scraper::node::Node;
                        match node.value() {
                            Node::Text(t) => result.push_str(t),
                            Node::Element(e) => {
                                // Skip labelLink and label-append elements
                                let cls = e.attr("class").unwrap_or("");
                                if !cls.contains("labelLink") && !cls.contains("label-append") {
                                    // Include text of other elements (shouldn't normally exist)
                                    if let Some(er) = scraper::ElementRef::wrap(node) {
                                        result.push_str(&er.text().collect::<String>());
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    result
                })
                .unwrap_or_default()
        };
        // Strip [v1.0] [Developer] etc.
        let bracket_pos = full_text.find('[').unwrap_or(full_text.len());
        full_text[..bracket_pos].trim().to_string()
    };

    // ── First post HTML ───────────────────────────────────────────────
    let post_sel = sel(".message-body .bbWrapper");
    let post_html = doc
        .select(&post_sel)
        .next()
        .map(|el| el.inner_html())
        .unwrap_or_default();

    // ── Cover image ──────────────────────────────────────────────────
    // First real attachment image in the first post
    let cover_url = {
        let img_sel =
            sel(".message-body .bbWrapper .lbContainer img, .message-body .bbWrapper .bbImage");
        doc.select(&img_sel)
            .next()
            .and_then(|el| {
                el.value()
                    .attr("src")
                    .or_else(|| el.value().attr("data-src"))
            })
            .map(|s| s.to_string())
    };

    // ── Screenshots ──────────────────────────────────────────────────
    // Strategy: collect href from <a class="js-lbImage"> (these are full-resolution URLs)
    // The first one may be the cover banner — we'll skip it if it matches cover_url
    let screenshots: Vec<String> = {
        let a_sel = sel(".message-body .bbWrapper a.js-lbImage");
        let from_links: Vec<String> = doc
            .select(&a_sel)
            .filter_map(|el| el.value().attr("href").map(|s| s.to_string()))
            .filter(|u| u.contains("attachments.f95zone.to") || u.contains("f95zone.to"))
            .collect();

        if !from_links.is_empty() {
            // Skip the first if it's the same as the cover
            let skip = cover_url
                .as_ref()
                .map(|c| from_links.first() == Some(c))
                .unwrap_or(false);
            from_links
                .into_iter()
                .skip(if skip { 1 } else { 0 })
                .take(8)
                .collect()
        } else {
            // Fallback: bbImage src, deduped, skip cover, convert thumb -> full
            let img_sel = sel(".message-body .bbWrapper .bbImage");
            doc.select(&img_sel)
                .skip(1)
                .filter_map(|el| {
                    let src = el
                        .value()
                        .attr("src")
                        .or_else(|| el.value().attr("data-src"))?;
                    Some(src.replace("/thumb/", "/"))
                })
                .take(8)
                .collect()
        }
    };

    // ── Overview text ────────────────────────────────────────────────
    // Extract HTML between Overview header and the next <b>Field</b>: block
    let (overview, overview_html_f95) = {
        let idx = post_html
            .find("<b>Overview</b>")
            .or_else(|| post_html.find("<b>Overview:</b>"));
        if let Some(i) = idx {
            let after = &post_html[i..];
            // cut off at the next <b>Something</b>: pattern
            let end = {
                let search = &after[15..]; // skip past the <b>Overview</b> itself
                search
                    .find("<b>")
                    .map(|e| e + 15)
                    .unwrap_or(after.len().min(4000))
            };
            let fragment_html = after[..end].to_string();
            let d = Html::parse_fragment(&fragment_html);
            let plain: String = d
                .root_element()
                .text()
                .collect::<String>()
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty() && *l != "Overview" && *l != "Overview:")
                .collect::<Vec<_>>()
                .join("\n\n"); // preserve paragraphs
            let overview = if plain.is_empty() { None } else { Some(plain) };
            (overview, None::<String>)
        } else {
            (None, None)
        }
    };

    // ── Metadata fields via <b>Label</b>: pattern ────────────────────
    let version = extract_field(&post_html, "Version");
    let developer = extract_field(&post_html, "Developer");
    let censored = extract_field(&post_html, "Censored");
    let os = extract_field(&post_html, "OS");
    let language = extract_field(&post_html, "Language");
    let engine = extract_field(&post_html, "Engine");
    let release_date = extract_field(&post_html, "Release Date");
    let last_updated = extract_field(&post_html, "Thread Updated");

    // ── Tags / Genre ─────────────────────────────────────────────────
    let tags: Vec<String> = {
        // Genre is in a spoiler, try to parse link text inside it
        let tag_sel = sel(".js-tagList .tagItem, .p-body-pageContent a[href*='tags']");
        let from_tags: Vec<String> = doc
            .select(&tag_sel)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();

        if !from_tags.is_empty() {
            from_tags
        } else {
            // fallback: parse the genre spoiler
            let genre_idx = post_html.find("<b>Genre</b>");
            genre_idx
                .map(|i| {
                    let after = &post_html[i..];
                    let end = after.find("</div>").unwrap_or(2000.min(after.len()));
                    let frag = Html::parse_fragment(&after[..end]);
                    frag.root_element()
                        .text()
                        .collect::<String>()
                        .split(',')
                        .map(|t| t.trim().to_string())
                        .filter(|t| !t.is_empty() && t != "Genre")
                        .collect()
                })
                .unwrap_or_default()
        }
    };

    // ── Rating ───────────────────────────────────────────────────────
    let rating = text_of(&doc, ".bratr-vote-content").map(|s| s.trim().to_string());

    Ok(GameMetadata {
        source: "f95".into(),
        source_url: normalized_url,
        title: if title.is_empty() { None } else { Some(title) },
        version,
        developer,
        overview,
        overview_html: overview_html_f95,
        cover_url,
        screenshots,
        tags,
        relations: vec![],
        engine,
        os,
        language,
        censored,
        release_date,
        last_updated,
        rating,
        price: None,
        circle: None,
        series: None,
        author: None,
        illustration: None,
        voice_actor: None,
        music: None,
        age_rating: None,
        product_format: None,
        file_format: None,
        file_size: None,
    })
}

// ── DLsite ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch_dlsite_metadata(url: String) -> Result<GameMetadata, String> {
    let resp = dlsite_http()
        .get(&url)
        .header("Accept-Language", "en-US,en;q=0.9,ja;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;
    let doc = Html::parse_document(&body);

    // ── Title ────────────────────────────────────────────────────────
    let title = text_of(&doc, "#work_name")
        .or_else(|| text_of(&doc, "h1.title"))
        .or_else(|| text_of(&doc, ".work_name"));

    // ── Cover ────────────────────────────────────────────────────────
    let cover_url = {
        let sel_list = [
            "#work_img_main img",
            ".work_thumb img",
            ".slider_item img",
            "#mainVisual img",
        ];
        sel_list.iter().find_map(|s| {
            let sel = sel(s);
            doc.select(&sel).next().and_then(|el| {
                el.value()
                    .attr("src")
                    .or_else(|| el.value().attr("data-src"))
                    .map(|u| {
                        if u.starts_with("//") {
                            format!("https:{}", u)
                        } else {
                            u.to_string()
                        }
                    })
            })
        })
    };

    // ── Screenshots ──────────────────────────────────────────────────
    // DLsite stores slider images in several selectors; also try the parts area thumbnails
    let screenshots: Vec<String> = {
        let selectors = [
            ".product-slider-data div[data-src]",
            ".work_parts_slider li img",
            ".slider_item img",
            "#work_slider li img",
            ".work_secondary_slider_img img",
        ];
        let mut urls: Vec<String> = Vec::new();
        for s in &selectors {
            let img_sel = sel(s);
            for el in doc.select(&img_sel) {
                let src = el
                    .value()
                    .attr("data-src")
                    .or_else(|| el.value().attr("src"))
                    .or_else(|| el.value().attr("data-lazy-src"))
                    .unwrap_or("");
                if src.is_empty() {
                    continue;
                }
                let full = if src.starts_with("//") {
                    format!("https:{}", src)
                } else {
                    src.to_string()
                };
                // skip tiny icons and main cover (already in cover_url)
                if full.contains("dlsite")
                    && !full.contains("_img_sam")
                    && !full.contains("no_image")
                {
                    urls.push(full);
                }
            }
            if !urls.is_empty() {
                break;
            }
        }
        // Fallback: look in raw HTML for img.dlsite.jp URLs in a slider context
        if urls.is_empty() {
            let slider_re: Vec<_> = body
                .split('"')
                .filter(|s| s.contains("img.dlsite.jp") && s.contains("work"))
                .map(|s| {
                    if s.starts_with("//") {
                        format!("https:{}", s)
                    } else {
                        s.to_string()
                    }
                })
                .filter(|s| !s.is_empty())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            urls.extend(slider_re);
        }
        urls.dedup();
        urls.into_iter().take(8).collect()
    };

    // ── Description (HTML with potential inline images) ────────────────
    let (overview, overview_html) = {
        let selectors = [
            "#work_parts_area",
            ".work_parts_container",
            ".work_intro",
            "#work_description",
            ".work_parts",
        ];
        let mut plain = None;
        let mut html_frag = None;
        for s in &selectors {
            let qsel = sel(s);
            if let Some(el) = doc.select(&qsel).next() {
                let inner = el.inner_html();
                if !inner.trim().is_empty() {
                    // Plain text (for search/display fallback)
                    let txt: String = el.text().collect::<String>();
                    plain = Some(txt.trim().to_string());
                    // Keep HTML — fix protocol-relative image srcs
                    html_frag = Some(inner.replace("//img.dlsite.jp", "https://img.dlsite.jp"));
                    break;
                }
            }
        }
        (plain, html_frag)
    };

    // ── Info table ───────────────────────────────────────────────────
    // DLsite uses table.work_outline with <th> / <td> pairs inside <tr>
    // Supports both English and Japanese header names
    let mut table_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let tr_sel = sel("table.work_outline tr");
        for row in doc.select(&tr_sel) {
            let th_sel = sel("th");
            let td_sel = sel("td");
            if let (Some(th), Some(td)) = (row.select(&th_sel).next(), row.select(&td_sel).next()) {
                let key = th.text().collect::<String>().trim().to_string();
                let val = td
                    .text()
                    .collect::<String>()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .trim()
                    .to_string();
                if !key.is_empty() && !val.is_empty() {
                    table_map.insert(key, val);
                }
            }
        }
    }

    let get_table =
        |keys: &[&str]| -> Option<String> { keys.iter().find_map(|k| table_map.get(*k).cloned()) };

    let developer = get_table(&["Maker", "Circle", "メーカー", "サークル"])
        .or_else(|| text_of(&doc, "span.maker_name"));
    let circle = get_table(&["Circle", "サークル", "Maker", "メーカー"]);
    let release_date = get_table(&["Release date", "Sale date", "販売日", "リリース日"]);
    let last_updated = get_table(&["Update information", "更新情報"]);
    let series = get_table(&["Series name", "シリーズ名"]);
    let author = get_table(&["Author", "作者", "著者"]);
    let illustration = get_table(&["Illustration", "イラスト"]);
    let voice_actor = get_table(&["Voice Actor", "声優"]);
    let music = get_table(&["Music", "音楽"]);
    let age_rating = get_table(&["Age", "年齢指定", "対象年齢"]);
    let product_format = get_table(&["Product format", "作品形式"]);
    let file_format = get_table(&["File format", "ファイル形式"]);
    let file_size = get_table(&["File size", "ファイル容量"]);
    let language_dl = get_table(&["Supported languages", "対応言語"]);

    // ── Genres / Tags ────────────────────────────────────────────────
    let tags: Vec<String> = {
        // Try genre links, then table Genre row
        let tag_sel = sel(".work_genre a, #work_genre a, .genre_tag a, [id^='genre'] a");
        let from_links: Vec<String> = doc
            .select(&tag_sel)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if !from_links.is_empty() {
            from_links
        } else {
            get_table(&["Genre", "ジャンル"])
                .map(|s| s.split_whitespace().map(|t| t.to_string()).collect())
                .unwrap_or_default()
        }
    };

    // ── Price ────────────────────────────────────────────────────────
    let price = text_of(&doc, ".price_table .price, .work_buy .price, .work_price")
        .or_else(|| get_table(&["Price", "価格"]));

    // ── Rating ───────────────────────────────────────────────────────
    // DLsite renders the rating client-side via Vue.js, so CSS selectors may
    // return the raw template literal "{{ product.rate_average_2dp }}".
    // Extract the real value directly from the JSON data block in the HTML.
    let rating_from_json = body.find("\"rate_average_2dp\":").and_then(|pos| {
        let rest = &body[pos + "\"rate_average_2dp\":".len()..];
        let end = rest
            .find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(rest.len());
        let val = rest[..end].trim().to_string();
        if val.is_empty() || val == "0" || val == "0.0" {
            None
        } else {
            Some(val)
        }
    });

    let rating = text_of(
        &doc,
        ".star_rating .rate_average_star, .average_count, .work_rating .average",
    )
    .filter(|r| !r.contains("{"))
    .or(rating_from_json)
    .or_else(|| text_of(&doc, ".work_review_site_rating").filter(|r| !r.contains("{")));

    Ok(GameMetadata {
        source: "dlsite".into(),
        source_url: url,
        title,
        version: None,
        developer,
        overview,
        overview_html,
        cover_url,
        screenshots,
        tags,
        relations: vec![],
        engine: None,
        os: None,
        language: language_dl,
        censored: None,
        release_date,
        last_updated,
        rating,
        price,
        circle,
        series,
        author,
        illustration,
        voice_actor,
        music,
        age_rating,
        product_format,
        file_format,
        file_size,
    })
}

// ── VNDB ───────────────────────────────────────────────────────────────────

fn parse_vndb_id_from_url(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?.to_lowercase();
    if !host.contains("vndb.org") {
        return None;
    }
    let seg = u
        .path_segments()?
        .find(|s| s.starts_with('v') && s[1..].chars().all(|c| c.is_ascii_digit()))?;
    Some(seg.to_string())
}

#[derive(Deserialize, Debug)]
struct VndbImage {
    url: Option<String>,
}

#[derive(Deserialize, Debug)]
struct VndbTag {
    rating: Option<f64>,
    name: Option<String>,
}

#[derive(Deserialize, Debug)]
struct VndbDeveloper {
    name: Option<String>,
    original: Option<String>,
}

#[derive(Deserialize, Debug)]
struct VndbRelation {
    relation: Option<String>,
    title: Option<String>,
    id: Option<String>,
}

#[derive(Deserialize, Debug)]
struct VndbItem {
    id: Option<String>,
    title: Option<String>,
    alttitle: Option<String>,
    description: Option<String>,
    released: Option<String>,
    image: Option<VndbImage>,
    screenshots: Option<Vec<VndbImage>>,
    tags: Option<Vec<VndbTag>>,
    developers: Option<Vec<VndbDeveloper>>,
    relations: Option<Vec<VndbRelation>>,
}

#[derive(Deserialize, Debug)]
struct VndbResponse {
    results: Option<Vec<VndbItem>>,
}

#[tauri::command]
pub async fn fetch_vndb_metadata(url: String) -> Result<GameMetadata, String> {
    let vn_id = parse_vndb_id_from_url(&url)
        .ok_or_else(|| "Expected VNDB URL like https://vndb.org/v1234".to_string())?;

    let body = serde_json::json!({
        "filters": ["id", "=", vn_id],
        "fields": "id,title,alttitle,description,released,image.url,screenshots.url,tags.rating,tags.name,developers.name,developers.original,relations.relation,relations.title,relations.id"
    });

    let resp = reqwest::Client::new()
        .post("https://api.vndb.org/kana/vn")
        .header("User-Agent", "LIBMALY/1.3")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("VNDB API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("VNDB API HTTP {}", resp.status()));
    }

    let parsed: VndbResponse = resp
        .json()
        .await
        .map_err(|e| format!("VNDB API parse failed: {}", e))?;
    let item = parsed
        .results
        .and_then(|mut r| if r.is_empty() { None } else { Some(r.remove(0)) })
        .ok_or_else(|| "VNDB entry not found".to_string())?;

    let title = item.title.clone().or(item.alttitle.clone());
    let cover_url = item.image.and_then(|i| i.url);
    let screenshots = item
        .screenshots
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| i.url)
        .take(8)
        .collect::<Vec<_>>();

    let mut tags = item
        .tags
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.rating.unwrap_or(0.0) >= 1.5)
        .filter_map(|t| t.name)
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();

    let developer = item
        .developers
        .unwrap_or_default()
        .into_iter()
        .filter_map(|d| d.original.or(d.name))
        .next();

    let overview = item.description.and_then(|d| {
        let cleaned = d
            .replace("[spoiler]", "")
            .replace("[/spoiler]", "")
            .replace("[quote]", "")
            .replace("[/quote]", "")
            .replace("[b]", "")
            .replace("[/b]", "")
            .replace("[i]", "")
            .replace("[/i]", "")
            .replace("[url]", "")
            .replace("[/url]", "")
            .replace("[code]", "")
            .replace("[/code]", "")
            .trim()
            .to_string();
        if cleaned.is_empty() {
            None
        } else {
            Some(cleaned)
        }
    });

    let relations = item
        .relations
        .unwrap_or_default()
        .into_iter()
        .map(|r| {
            let rel = r.relation.unwrap_or_else(|| "related".to_string());
            let title = r.title.unwrap_or_else(|| "Unknown".to_string());
            match r.id {
                Some(id) => format!("{rel}: {title} ({id})"),
                None => format!("{rel}: {title}"),
            }
        })
        .take(12)
        .collect::<Vec<_>>();

    Ok(GameMetadata {
        source: "vndb".into(),
        source_url: url,
        title,
        version: None,
        developer,
        overview,
        overview_html: None,
        cover_url,
        screenshots,
        tags,
        relations,
        engine: None,
        os: None,
        language: None,
        censored: None,
        release_date: item.released.filter(|d| !d.is_empty() && d != "null"),
        last_updated: None,
        rating: None,
        price: None,
        circle: None,
        series: None,
        author: None,
        illustration: None,
        voice_actor: None,
        music: None,
        age_rating: None,
        product_format: None,
        file_format: None,
        file_size: None,
    })
}

fn canonicalize_store_url(raw: &str) -> String {
    if let Ok(mut u) = reqwest::Url::parse(raw) {
        u.set_fragment(None);
        return u.to_string();
    }
    raw.trim().to_string()
}

fn absolutize_url(base: &str, raw: &str) -> String {
    let candidate = raw.trim();
    if candidate.is_empty() {
        return String::new();
    }
    if candidate.starts_with("http://") || candidate.starts_with("https://") {
        return candidate.to_string();
    }
    if candidate.starts_with("//") {
        return format!("https:{candidate}");
    }
    if let Ok(base_url) = reqwest::Url::parse(base) {
        if let Ok(joined) = base_url.join(candidate) {
            return joined.to_string();
        }
    }
    candidate.to_string()
}

fn extract_meta(doc: &Html, key: &str) -> Option<String> {
    let selector = format!("meta[property=\"{key}\"], meta[name=\"{key}\"]");
    let s = sel(&selector);
    doc.select(&s)
        .filter_map(|m| m.value().attr("content"))
        .map(|x| x.trim().to_string())
        .find(|x| !x.is_empty())
}

fn text_first(doc: &Html, selectors: &[&str]) -> Option<String> {
    for s in selectors {
        if let Some(v) = text_of(doc, s) {
            let cleaned = v.trim().to_string();
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }
    None
}

fn split_keywords_to_tags(raw: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for t in raw
        .split(',')
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
        .take(24)
    {
        let val = t.to_string();
        if !out.iter().any(|x| x.eq_ignore_ascii_case(&val)) {
            out.push(val);
        }
    }
    out
}

fn source_from_url(url: &str) -> Option<(&'static str, &'static str)> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?.to_lowercase();
    if host.contains("mangagamer.com") {
        return Some(("mangagamer", "MangaGamer"));
    }
    if host.contains("johren.net") {
        return Some(("johren", "Johren"));
    }
    if host.contains("fakku.net") {
        return Some(("fakku", "FAKKU"));
    }
    None
}

async fn fetch_store_metadata(url: String) -> Result<GameMetadata, String> {
    let (source_id, source_label) =
        source_from_url(&url).ok_or_else(|| "Unsupported store URL".to_string())?;
    let source_url = canonicalize_store_url(&url);
    let client = if source_id == "fakku" {
        fakku_http()
    } else {
        reqwest::Client::new()
    };
    let resp = client
        .get(&source_url)
        .header("User-Agent", "LIBMALY/1.3")
        .send()
        .await
        .map_err(|e| format!("{source_label} request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{source_label} HTTP {}", resp.status()));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("{source_label} body parse failed: {e}"))?;
    let doc = Html::parse_document(&body);

    let title = extract_meta(&doc, "og:title")
        .or_else(|| extract_meta(&doc, "twitter:title"))
        .or_else(|| text_first(&doc, &["h1.product-title", "h1[itemprop='name']", "h1.title", "h1"]));

    let overview = extract_meta(&doc, "og:description")
        .or_else(|| extract_meta(&doc, "twitter:description"))
        .or_else(|| extract_meta(&doc, "description"))
        .or_else(|| text_first(&doc, &[".product-description", ".entry-content", ".description", "[itemprop='description']"]));

    let cover_url = extract_meta(&doc, "og:image")
        .or_else(|| extract_meta(&doc, "twitter:image"))
        .map(|x| absolutize_url(&source_url, &x));

    let mut screenshots = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    for src in [
        "img.product-gallery__image",
        ".product-gallery img",
        ".gallery img",
        ".thumbnails img",
        ".swiper-slide img",
        ".slick-slide img",
        "img",
    ] {
        let s = sel(src);
        for img in doc.select(&s) {
            let raw = img
                .value()
                .attr("data-src")
                .or_else(|| img.value().attr("data-original"))
                .or_else(|| img.value().attr("src"))
                .unwrap_or("")
                .trim();
            if raw.is_empty() {
                continue;
            }
            let abs = absolutize_url(&source_url, raw);
            let l = abs.to_lowercase();
            if l.contains("logo") || l.contains("icon") || l.contains("avatar") {
                continue;
            }
            if seen.insert(l) {
                screenshots.push(abs);
                if screenshots.len() >= 8 {
                    break;
                }
            }
        }
        if screenshots.len() >= 8 {
            break;
        }
    }
    if let Some(cover) = &cover_url {
        screenshots.retain(|s| s != cover);
    }

    let mut tags = Vec::<String>::new();
    if let Some(kw) = extract_meta(&doc, "keywords") {
        tags.extend(split_keywords_to_tags(&kw));
    }
    for selector in [
        "a[rel='tag']",
        ".tag a",
        ".tags a",
        ".genre a",
        ".categories a",
    ] {
        let s = sel(selector);
        for el in doc.select(&s) {
            let txt = el.text().collect::<String>().trim().to_string();
            if txt.len() < 2 {
                continue;
            }
            if !tags.iter().any(|x| x.eq_ignore_ascii_case(&txt)) {
                tags.push(txt);
            }
            if tags.len() >= 24 {
                break;
            }
        }
        if tags.len() >= 24 {
            break;
        }
    }

    let developer = text_first(
        &doc,
        &[
            "[itemprop='brand']",
            ".maker a",
            ".developer a",
            ".developer",
            ".brand",
            ".circle a",
        ],
    );
    let release_date = text_first(
        &doc,
        &[
            "time[itemprop='datePublished']",
            "time[datetime]",
            ".release-date",
            ".date",
            ".product-release",
        ],
    );
    let price = text_first(&doc, &[".price", "[itemprop='price']", ".product-price"]);

    Ok(GameMetadata {
        source: source_id.to_string(),
        source_url,
        title,
        version: None,
        developer,
        overview,
        overview_html: None,
        cover_url,
        screenshots,
        tags,
        relations: Vec::new(),
        engine: None,
        os: None,
        language: None,
        censored: None,
        release_date,
        last_updated: None,
        rating: None,
        price,
        circle: None,
        series: None,
        author: None,
        illustration: None,
        voice_actor: None,
        music: None,
        age_rating: None,
        product_format: None,
        file_format: None,
        file_size: None,
    })
}

#[tauri::command]
pub async fn fetch_mangagamer_metadata(url: String) -> Result<GameMetadata, String> {
    fetch_store_metadata(url).await
}

#[tauri::command]
pub async fn fetch_johren_metadata(url: String) -> Result<GameMetadata, String> {
    fetch_store_metadata(url).await
}

#[tauri::command]
pub async fn fetch_fakku_metadata(url: String) -> Result<GameMetadata, String> {
    fetch_store_metadata(url).await
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct SearchResultItem {
    pub title: String,
    pub url: String,
    pub cover_url: Option<String>,
    pub source: String,
}

fn normalize_search_query(raw: &str) -> String {
    // Remove bracketed segments and normalize separators to spaces.
    let mut out = String::with_capacity(raw.len());
    let mut depth_round = 0i32;
    let mut depth_square = 0i32;
    for ch in raw.chars() {
        match ch {
            '(' => depth_round += 1,
            ')' => depth_round = (depth_round - 1).max(0),
            '[' => depth_square += 1,
            ']' => depth_square = (depth_square - 1).max(0),
            _ if depth_round > 0 || depth_square > 0 => {}
            '_' | '-' | '~' | ':' | ';' | '|' => out.push(' '),
            _ => out.push(ch),
        }
    }
    let compact = out
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if compact.is_empty() {
        raw.trim().to_string()
    } else {
        compact
    }
}

fn build_query_variants(query: &str) -> Vec<String> {
    let mut v = Vec::<String>::new();
    let base = query.trim();
    if base.is_empty() {
        return v;
    }
    v.push(base.to_string());

    let norm = normalize_search_query(base);
    if !norm.is_empty() && !v.iter().any(|x| x.eq_ignore_ascii_case(&norm)) {
        v.push(norm.clone());
    }

    // "Summer Memories" often maps to "Summer Memories Plus" on F95.
    if !norm.to_lowercase().contains(" plus") {
        let plus = format!("{norm} Plus");
        if !v.iter().any(|x| x.eq_ignore_ascii_case(&plus)) {
            v.push(plus);
        }
    } else {
        let no_plus = norm
            .replace(" Plus", "")
            .replace(" plus", "")
            .trim()
            .to_string();
        if !no_plus.is_empty() && !v.iter().any(|x| x.eq_ignore_ascii_case(&no_plus)) {
            v.push(no_plus);
        }
    }

    // Add a shorter query fallback: first 2-3 words.
    let parts = norm.split_whitespace().collect::<Vec<_>>();
    if parts.len() >= 3 {
        let short3 = parts[..3].join(" ");
        if !v.iter().any(|x| x.eq_ignore_ascii_case(&short3)) {
            v.push(short3);
        }
    }
    if parts.len() >= 2 {
        let short2 = parts[..2].join(" ");
        if !v.iter().any(|x| x.eq_ignore_ascii_case(&short2)) {
            v.push(short2);
        }
    }

    v
}

#[derive(Deserialize, Debug)]
struct VndbAliasItem {
    title: Option<String>,
    alttitle: Option<String>,
}

#[derive(Deserialize, Debug)]
struct VndbAliasResponse {
    results: Option<Vec<VndbAliasItem>>,
}

async fn fetch_vndb_alias_queries(query: &str) -> Vec<String> {
    let body = serde_json::json!({
        "filters": ["search", "=", query],
        "fields": "title,alttitle",
        "results": 5
    });
    let resp = match reqwest::Client::new()
        .post("https://api.vndb.org/kana/vn")
        .header("User-Agent", "LIBMALY/1.3")
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return Vec::new(),
    };
    let parsed: VndbAliasResponse = match resp.json().await {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::<String>::new();
    for item in parsed.results.unwrap_or_default().into_iter().take(5) {
        for s in [item.title, item.alttitle].into_iter().flatten() {
            let s = normalize_search_query(&s);
            if s.len() >= 2 && !out.iter().any(|x| x.eq_ignore_ascii_case(&s)) {
                out.push(s);
            }
        }
    }
    out
}

async fn fetch_f95checker_suggestions(query: &str) -> Vec<SearchResultItem> {
    let encoded = urlencoding::encode(query);
    let candidates = [
        format!("https://api.f95checker.dev/search?query={encoded}"),
        format!("https://api.f95checker.dev/search?q={encoded}"),
        format!("https://api.f95checker.dev/v1/search?query={encoded}"),
        format!("https://api.f95checker.dev/v1/search?q={encoded}"),
    ];

    for url in candidates {
        let resp = match reqwest::Client::new()
            .get(&url)
            .header("User-Agent", "LIBMALY/1.3")
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };

        let value: serde_json::Value = match resp.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };

        let arr_opt = value
            .as_array()
            .cloned()
            .or_else(|| value.get("results").and_then(|v| v.as_array()).cloned())
            .or_else(|| value.get("items").and_then(|v| v.as_array()).cloned())
            .or_else(|| value.get("data").and_then(|v| v.as_array()).cloned());

        let Some(arr) = arr_opt else { continue };
        let mut out = Vec::<SearchResultItem>::new();
        for item in arr.into_iter().take(8) {
            let obj = match item.as_object() {
                Some(o) => o,
                None => continue,
            };

            let title = obj
                .get("title")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("name").and_then(|v| v.as_str()))
                .unwrap_or("Unknown")
                .trim()
                .to_string();
            let mut link = obj
                .get("url")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("thread_url").and_then(|v| v.as_str()))
                .or_else(|| obj.get("link").and_then(|v| v.as_str()))
                .unwrap_or("")
                .trim()
                .to_string();

            if link.is_empty() {
                if let Some(id) = obj
                    .get("thread_id")
                    .and_then(|v| v.as_u64())
                    .or_else(|| obj.get("id").and_then(|v| v.as_u64()))
                {
                    link = format!("https://f95zone.to/threads/{id}/");
                }
            }
            if !link.contains("f95zone.to/threads") {
                continue;
            }

            let cover_url = obj
                .get("cover")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("image").and_then(|v| v.as_str()))
                .or_else(|| obj.get("poster").and_then(|v| v.as_str()))
                .map(|s| s.to_string());

            out.push(SearchResultItem {
                title,
                url: normalize_f95_thread_url(&link),
                cover_url,
                source: "F95zone".into(),
            });
        }
        if !out.is_empty() {
            return out;
        }
    }

    Vec::new()
}

fn normalize_store_suggestion_url(url: &str, source: &str) -> String {
    let mut u = canonicalize_store_url(url);
    if let Ok(mut parsed) = reqwest::Url::parse(&u) {
        let host = parsed.host_str().unwrap_or_default().to_lowercase();
        if source == "MangaGamer" && host.contains("mangagamer.com") {
            // Prefer stable detail pages.
            let keep_query = parsed.query_pairs().any(|(k, _)| k == "product_code");
            if !keep_query {
                parsed.set_query(None);
            }
            u = parsed.to_string();
        } else if source == "Johren" || source == "FAKKU" {
            parsed.set_query(None);
            u = parsed.to_string();
        }
    }
    u
}

async fn fetch_ddg_site_suggestions(
    query: &str,
    site: &str,
    source: &str,
    limit: usize,
) -> Vec<SearchResultItem> {
    let ddg_body = format!("q=site:{site}+{}", urlencoding::encode(query));
    let resp = match reqwest::Client::new()
        .post("https://lite.duckduckgo.com/lite/")
        .header("User-Agent", "Mozilla/5.0")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(ddg_body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let body = match resp.text().await {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let doc = Html::parse_document(&body);
    let a_sel = sel(".result-link");
    let mut out = Vec::<SearchResultItem>::new();
    for el in doc.select(&a_sel) {
        if out.len() >= limit {
            break;
        }
        let url = el.attr("href").unwrap_or("").trim().to_string();
        if url.is_empty() || !url.to_lowercase().contains(site) {
            continue;
        }
        let title = el.text().collect::<String>().trim().to_string();
        out.push(SearchResultItem {
            title: if title.is_empty() {
                "Unknown".to_string()
            } else {
                title
            },
            url: normalize_store_suggestion_url(&url, source),
            cover_url: None,
            source: source.to_string(),
        });
    }
    out
}

#[tauri::command]
pub async fn search_suggest_links(query: String) -> Result<Vec<SearchResultItem>, String> {
    let mut results = Vec::new();
    let mut seen_urls = std::collections::HashSet::<String>::new();
    let cache_key = normalize_search_query(&query).to_lowercase();

    let mut queries = build_query_variants(&query);
    let alias_queries = fetch_vndb_alias_queries(&query).await;
    for q in alias_queries {
        if !queries.iter().any(|x| x.eq_ignore_ascii_case(&q)) {
            queries.push(q);
        }
    }
    queries.truncate(8);

    let mut push_result = |item: SearchResultItem| -> bool {
        let key = item.url.trim().to_lowercase();
        if key.is_empty() || !seen_urls.insert(key) {
            return false;
        }
        results.push(item);
        true
    };

    // DLsite query (try multiple variants)
    let mut dl_count = 0usize;
    for q in &queries {
        if dl_count >= 4 {
            break;
        }
        let dlsite_url = format!(
            "https://www.dlsite.com/home/fsr/=/keyword/{}",
            urlencoding::encode(q)
        );
        if let Ok(resp) = dlsite_http()
            .get(&dlsite_url)
            .header("Accept-Language", "en-US,en;q=0.9,ja;q=0.8")
            .send()
            .await
        {
            if let Ok(body) = resp.text().await {
                let doc = Html::parse_document(&body);
                let item_sel = sel(".search_result_img_box_inner");
                for el in doc.select(&item_sel) {
                    if dl_count >= 4 {
                        break;
                    }
                    let a_sel = sel("a");
                    let img_sel = sel("img");
                    if let Some(a) = el.select(&a_sel).next() {
                        let title = a
                            .attr("title")
                            .or_else(|| {
                                let img = el.select(&img_sel).next()?;
                                img.attr("alt")
                            })
                            .unwrap_or("Unknown")
                            .to_string();
                        let url = a.attr("href").unwrap_or("").to_string();
                        let cover_url = el
                            .select(&img_sel)
                            .next()
                            .and_then(|i| i.attr("src"))
                            .map(|s| {
                                if s.starts_with("//") {
                                    format!("https:{}", s)
                                } else {
                                    s.to_string()
                                }
                            });
                        if !url.is_empty() && !url.contains("category") {
                            if push_result(SearchResultItem {
                                title,
                                url,
                                cover_url,
                                source: "DLsite".into(),
                            }) {
                                dl_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // DuckDuckGo lite for F95zone (try multiple variants)
    let mut f95_count = 0usize;
    for q in &queries {
        if f95_count >= 4 {
            break;
        }
        // Prefer F95Checker API (stable cache/index), then fallback to DDG for misses.
        for item in fetch_f95checker_suggestions(q).await.into_iter() {
            if f95_count >= 4 {
                break;
            }
            if push_result(item) {
                f95_count += 1;
            }
        }
        if f95_count >= 4 {
            break;
        }

        let ddg_body = format!("q=site:f95zone.to+{}", urlencoding::encode(q));
        if let Ok(resp) = reqwest::Client::new()
            .post("https://lite.duckduckgo.com/lite/")
            .header("User-Agent", "Mozilla/5.0")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(ddg_body)
            .send()
            .await
        {
            if let Ok(body) = resp.text().await {
                let doc = Html::parse_document(&body);
                let a_sel = sel(".result-link");
                for el in doc.select(&a_sel) {
                    if f95_count >= 4 {
                        break;
                    }
                let url = el.attr("href").unwrap_or("").to_string();
                if url.contains("f95zone.to/threads") {
                    let title = el.text().collect::<String>().trim().to_string();
                    if push_result(SearchResultItem {
                        title,
                        url: normalize_f95_thread_url(&url),
                        cover_url: None,
                        source: "F95zone".into(),
                    }) {
                            f95_count += 1;
                        }
                    }
                }
            }
        }
    }

    // VNDB direct API suggestions (stable, avoids DDG inconsistencies)
    let mut vndb_count = 0usize;
    for q in &queries {
        if vndb_count >= 5 {
            break;
        }
        let body = serde_json::json!({
            "filters": ["search", "=", q],
            "fields": "id,title,image.url",
            "results": 6
        });
        if let Ok(resp) = reqwest::Client::new()
            .post("https://api.vndb.org/kana/vn")
            .header("User-Agent", "LIBMALY/1.3")
            .json(&body)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(parsed) = resp.json::<VndbResponse>().await {
                    for item in parsed.results.unwrap_or_default() {
                        if vndb_count >= 5 {
                            break;
                        }
                        let Some(id) = item.id.clone() else { continue; };
                        let title = item
                            .title
                            .clone()
                            .or(item.alttitle.clone())
                            .unwrap_or_else(|| id.clone());
                        let url = format!("https://vndb.org/{id}");
                        let cover_url = item.image.and_then(|i| i.url);
                        if push_result(SearchResultItem {
                            title,
                            url,
                            cover_url,
                            source: "VNDB".into(),
                        }) {
                            vndb_count += 1;
                        }
                    }
                }
            }
        }
    }

    // MangaGamer suggestions via DDG site search.
    let mut mg_count = 0usize;
    for q in &queries {
        if mg_count >= 3 {
            break;
        }
        for item in fetch_ddg_site_suggestions(q, "mangagamer.com", "MangaGamer", 3).await {
            if mg_count >= 3 {
                break;
            }
            if push_result(item) {
                mg_count += 1;
            }
        }
    }

    // Johren suggestions via DDG site search.
    let mut johren_count = 0usize;
    for q in &queries {
        if johren_count >= 3 {
            break;
        }
        for item in fetch_ddg_site_suggestions(q, "johren.net", "Johren", 3).await {
            if johren_count >= 3 {
                break;
            }
            if push_result(item) {
                johren_count += 1;
            }
        }
    }

    // FAKKU suggestions via DDG site search.
    let mut fakku_count = 0usize;
    for q in &queries {
        if fakku_count >= 3 {
            break;
        }
        for item in fetch_ddg_site_suggestions(q, "fakku.net", "FAKKU", 3).await {
            if fakku_count >= 3 {
                break;
            }
            if push_result(item) {
                fakku_count += 1;
            }
        }
    }

    // Cache successful lookups to shield against transient DDG failures on repeated queries.
    if !results.is_empty() && !cache_key.is_empty() {
        suggest_cache()
            .lock()
            .unwrap()
            .insert(cache_key.clone(), results.clone());
    }

    // If all live sources failed, fall back to last successful cached result for this query.
    if results.is_empty() && !cache_key.is_empty() {
        if let Some(cached) = suggest_cache().lock().unwrap().get(&cache_key).cloned() {
            return Ok(cached);
        }
    }

    Ok(results)
}
