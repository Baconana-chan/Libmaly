use reqwest::Client;
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

// ── Cookie store with disk persistence ────────────────────────────────────

static COOKIE_STORE: Mutex<Option<Arc<CookieStoreMutex>>> = Mutex::new(None);

fn cookies_path() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("libmaly").join("f95cookies.json")
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
    pub source: String,       // "f95" | "dlsite"
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

fn sel(s: &str) -> Selector {
    Selector::parse(s).unwrap_or_else(|_| Selector::parse("__never__").unwrap())
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
    let end = after.find("<br>").or_else(|| after.find("<b>")).unwrap_or(200.min(after.len()));
    let raw = &after[..end];
    // Strip all HTML tags
    let doc = Html::parse_fragment(raw);
    let text = doc.root_element().text().collect::<String>();
    let cleaned = text.trim().to_string();
    if cleaned.is_empty() { None } else { Some(cleaned) }
}

#[tauri::command]
pub async fn fetch_f95_metadata(url: String) -> Result<GameMetadata, String> {
    let resp = http()
        .get(&url)
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
        let img_sel = sel(".message-body .bbWrapper .lbContainer img, .message-body .bbWrapper .bbImage");
        doc.select(&img_sel)
            .next()
            .and_then(|el| {
                el.value().attr("src")
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
            from_links.into_iter().skip(if skip { 1 } else { 0 }).take(8).collect()
        } else {
            // Fallback: bbImage src, deduped, skip cover, convert thumb -> full
            let img_sel = sel(".message-body .bbWrapper .bbImage");
            doc.select(&img_sel)
                .skip(1)
                .filter_map(|el| {
                    let src = el.value().attr("src").or_else(|| el.value().attr("data-src"))?;
                    Some(src.replace("/thumb/", "/"))
                })
                .take(8)
                .collect()
        }
    };

    // ── Overview text ────────────────────────────────────────────────
    // Extract HTML between Overview header and the next <b>Field</b>: block
    let (overview, overview_html_f95) = {
        let idx = post_html.find("<b>Overview</b>").or_else(|| post_html.find("<b>Overview:</b>"));
        if let Some(i) = idx {
            let after = &post_html[i..];
            // cut off at the next <b>Something</b>: pattern
            let end = {
                let search = &after[15..]; // skip past the <b>Overview</b> itself
                search.find("<b>")
                    .map(|e| e + 15)
                    .unwrap_or(after.len().min(4000))
            };
            let fragment_html = after[..end].to_string();
            let d = Html::parse_fragment(&fragment_html);
            let plain: String = d.root_element()
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
    let version      = extract_field(&post_html, "Version");
    let developer    = extract_field(&post_html, "Developer");
    let censored     = extract_field(&post_html, "Censored");
    let os           = extract_field(&post_html, "OS");
    let language     = extract_field(&post_html, "Language");
    let engine       = extract_field(&post_html, "Engine");
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
            genre_idx.map(|i| {
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
            }).unwrap_or_default()
        }
    };

    // ── Rating ───────────────────────────────────────────────────────
    let rating = text_of(&doc, ".bratr-vote-content")
        .map(|s| s.trim().to_string());

    Ok(GameMetadata {
        source: "f95".into(),
        source_url: url,
        title: if title.is_empty() { None } else { Some(title) },
        version,
        developer,
        overview,
        overview_html: overview_html_f95,
        cover_url,
        screenshots,
        tags,
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
    let resp = http()
        .get(&url)
        .header("Accept-Language", "en-US,en;q=0.9")
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
        let sel_list = ["#work_img_main img", ".work_thumb img", ".slider_item img", "#mainVisual img"];
        sel_list.iter().find_map(|s| {
            let sel = sel(s);
            doc.select(&sel).next().and_then(|el| {
                el.value().attr("src")
                    .or_else(|| el.value().attr("data-src"))
                    .map(|u| {
                        if u.starts_with("//") { format!("https:{}", u) }
                        else { u.to_string() }
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
                let src = el.value().attr("data-src")
                    .or_else(|| el.value().attr("src"))
                    .or_else(|| el.value().attr("data-lazy-src"))
                    .unwrap_or("");
                if src.is_empty() { continue; }
                let full = if src.starts_with("//") { format!("https:{}", src) } else { src.to_string() };
                // skip tiny icons and main cover (already in cover_url)
                if full.contains("dlsite") && !full.contains("_img_sam") && !full.contains("no_image") {
                    urls.push(full);
                }
            }
            if !urls.is_empty() { break; }
        }
        // Fallback: look in raw HTML for img.dlsite.jp URLs in a slider context
        if urls.is_empty() {
            let slider_re: Vec<_> = body
                .split('"')
                .filter(|s| s.contains("img.dlsite.jp") && s.contains("work"))
                .map(|s| if s.starts_with("//") { format!("https:{}", s) } else { s.to_string() })
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
        let selectors = ["#work_parts_area", ".work_parts_container", ".work_intro", "#work_description", ".work_parts"];
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
                let val = td.text().collect::<String>()
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

    let get_table = |keys: &[&str]| -> Option<String> {
        keys.iter().find_map(|k| table_map.get(*k).cloned())
    };

    let developer    = get_table(&["Maker", "Circle", "メーカー", "サークル"])
        .or_else(|| text_of(&doc, "span.maker_name"));
    let circle       = get_table(&["Circle", "サークル", "Maker", "メーカー"]);
    let release_date = get_table(&["Release date", "Sale date", "販売日", "リリース日"]);
    let last_updated = get_table(&["Update information", "更新情報"]);
    let series       = get_table(&["Series name", "シリーズ名"]);
    let author       = get_table(&["Author", "作者", "著者"]);
    let illustration = get_table(&["Illustration", "イラスト"]);
    let voice_actor  = get_table(&["Voice Actor", "声優"]);
    let music        = get_table(&["Music", "音楽"]);
    let age_rating   = get_table(&["Age", "年齢指定", "対象年齢"]);
    let product_format = get_table(&["Product format", "作品形式"]);
    let file_format  = get_table(&["File format", "ファイル形式"]);
    let file_size    = get_table(&["File size", "ファイル容量"]);
    let language_dl  = get_table(&["Supported languages", "対応言語"]);

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
    let rating_from_json = body
        .find("\"rate_average_2dp\":")
        .and_then(|pos| {
            let rest = &body[pos + "\"rate_average_2dp\":".len()..];
            let end = rest.find(|c: char| !c.is_ascii_digit() && c != '.').unwrap_or(rest.len());
            let val = rest[..end].trim().to_string();
            if val.is_empty() || val == "0" || val == "0.0" { None } else { Some(val) }
        });

    let rating = text_of(&doc, ".star_rating .rate_average_star, .average_count, .work_rating .average")
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
