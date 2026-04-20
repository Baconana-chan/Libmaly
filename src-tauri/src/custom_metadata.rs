use boa_engine::{Context as JsContext, Source as JsSource};
use regex::RegexBuilder;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use url::Url;

use crate::metadata::{finalize_scrape_result, http, GameMetadata};
use crate::vault::profile_file_path;

const CUSTOM_METADATA_TEMPLATES_FILE: &str = "custom_metadata_templates.json";
const CUSTOM_METADATA_STORE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct CustomMetadataTemplateStore {
    #[serde(default = "default_store_version")]
    version: u32,
    #[serde(default)]
    templates: Vec<CustomMetadataTemplate>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomMetadataTemplate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub override_builtin: bool,
    #[serde(default)]
    pub url_patterns: Vec<String>,
    #[serde(default)]
    pub request_headers: HashMap<String, String>,
    #[serde(default)]
    pub fields: HashMap<String, Vec<CustomMetadataExtractor>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomMetadataExtractor {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub selector: Option<String>,
    #[serde(default)]
    pub attr: Option<String>,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub group: Option<usize>,
    #[serde(default)]
    pub flags: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub script: Option<String>,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub html: bool,
    #[serde(default)]
    pub absolute_url: bool,
    #[serde(default)]
    pub split: Option<String>,
    #[serde(default)]
    pub join: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomMetadataTemplateSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub override_builtin: bool,
    pub url_patterns: Vec<String>,
    pub field_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomMetadataSourceMatch {
    pub source: String,
    pub source_label: String,
    pub template_id: String,
    pub is_custom: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum TemplateImportPayload {
    Store(CustomMetadataTemplateStore),
    Templates(Vec<CustomMetadataTemplate>),
    Template(CustomMetadataTemplate),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsHookInput<'a> {
    value: Option<&'a str>,
    values: &'a [String],
    html: &'a str,
    url: &'a str,
}

fn default_true() -> bool {
    true
}

fn default_store_version() -> u32 {
    CUSTOM_METADATA_STORE_VERSION
}

fn templates_file_path() -> std::path::PathBuf {
    profile_file_path(CUSTOM_METADATA_TEMPLATES_FILE)
}

fn write_string(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

fn read_store() -> Result<CustomMetadataTemplateStore, String> {
    let path = templates_file_path();
    if !path.exists() {
        return Ok(CustomMetadataTemplateStore::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut store: CustomMetadataTemplateStore =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse custom metadata template store: {e}"))?;
    if store.version == 0 {
        store.version = CUSTOM_METADATA_STORE_VERSION;
    }
    Ok(store)
}

fn save_store(store: &CustomMetadataTemplateStore) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    write_string(&templates_file_path(), &raw)
}

fn template_summary(template: &CustomMetadataTemplate) -> CustomMetadataTemplateSummary {
    CustomMetadataTemplateSummary {
        id: template.id.clone(),
        name: template.name.clone(),
        description: template.description.clone(),
        enabled: template.enabled,
        override_builtin: template.override_builtin,
        url_patterns: template.url_patterns.clone(),
        field_count: template.fields.len(),
    }
}

fn sanitize_template_id(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if (ch == '-' || ch == '_' || ch == ' ') && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

fn normalize_template(template: &mut CustomMetadataTemplate) -> Result<(), String> {
    template.id = sanitize_template_id(if template.id.trim().is_empty() {
        &template.name
    } else {
        &template.id
    });
    template.name = template.name.trim().to_string();
    template.description = template
        .description
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    template.url_patterns = template
        .url_patterns
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    if template.id.is_empty() {
        return Err("Custom metadata template is missing a usable id".to_string());
    }
    if template.name.is_empty() {
        return Err(format!("Custom metadata template '{}' is missing a name", template.id));
    }
    if template.url_patterns.is_empty() {
        return Err(format!(
            "Custom metadata template '{}' needs at least one urlPatterns entry",
            template.id
        ));
    }
    if template.fields.is_empty() {
        return Err(format!(
            "Custom metadata template '{}' does not define any fields",
            template.id
        ));
    }
    for pattern in &template.url_patterns {
        RegexBuilder::new(pattern)
            .build()
            .map_err(|e| format!("Invalid url pattern '{pattern}' in template '{}': {e}", template.id))?;
    }
    for (field, extractors) in &template.fields {
        if extractors.is_empty() {
            return Err(format!("Field '{field}' in template '{}' has no extractors", template.id));
        }
        for extractor in extractors {
            validate_extractor(&template.id, field, extractor)?;
        }
    }
    Ok(())
}

fn validate_extractor(template_id: &str, field: &str, extractor: &CustomMetadataExtractor) -> Result<(), String> {
    let kind = extractor.kind.trim().to_ascii_lowercase();
    if kind.is_empty() {
        return Err(format!(
            "Template '{template_id}' field '{field}' contains an extractor without type"
        ));
    }
    match kind.as_str() {
        "css" => {
            if extractor.selector.as_deref().map(str::trim).unwrap_or_default().is_empty() {
                return Err(format!(
                    "Template '{template_id}' field '{field}' css extractor is missing selector"
                ));
            }
        }
        "regex" => {
            if extractor.pattern.as_deref().map(str::trim).unwrap_or_default().is_empty() {
                return Err(format!(
                    "Template '{template_id}' field '{field}' regex extractor is missing pattern"
                ));
            }
        }
        "literal" => {
            if extractor.value.as_deref().map(str::trim).unwrap_or_default().is_empty() {
                return Err(format!(
                    "Template '{template_id}' field '{field}' literal extractor is missing value"
                ));
            }
        }
        "js" => {
            if extractor.script.as_deref().map(str::trim).unwrap_or_default().is_empty() {
                return Err(format!(
                    "Template '{template_id}' field '{field}' js extractor is missing script"
                ));
            }
        }
        other => {
            return Err(format!(
                "Template '{template_id}' field '{field}' uses unsupported extractor type '{other}'"
            ));
        }
    }
    Ok(())
}

fn parse_import_payload(json_text: &str) -> Result<Vec<CustomMetadataTemplate>, String> {
    let payload: TemplateImportPayload =
        serde_json::from_str(json_text).map_err(|e| format!("Invalid template JSON: {e}"))?;
    let templates = match payload {
        TemplateImportPayload::Store(store) => store.templates,
        TemplateImportPayload::Templates(templates) => templates,
        TemplateImportPayload::Template(template) => vec![template],
    };
    if templates.is_empty() {
        return Err("No templates found in JSON payload".to_string());
    }
    Ok(templates)
}

fn selector_from_str(raw: &str) -> Result<Selector, String> {
    Selector::parse(raw).map_err(|e| format!("Invalid CSS selector '{raw}': {e}"))
}

fn extract_element_text(element: scraper::element_ref::ElementRef<'_>) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn make_absolute_url(base_url: &str, value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Ok(parsed) = Url::parse(trimmed) {
        return parsed.to_string();
    }
    Url::parse(base_url)
        .ok()
        .and_then(|base| base.join(trimmed).ok())
        .map(|resolved| resolved.to_string())
        .unwrap_or_else(|| trimmed.to_string())
}

fn extract_regex_values(
    pattern: &str,
    flags: Option<&str>,
    group: usize,
    input: &str,
    multiple: bool,
) -> Result<Vec<String>, String> {
    let mut builder = RegexBuilder::new(pattern);
    let flags = flags.unwrap_or_default();
    builder.case_insensitive(flags.contains('i'));
    builder.multi_line(flags.contains('m'));
    builder.dot_matches_new_line(flags.contains('s'));
    let regex = builder
        .build()
        .map_err(|e| format!("Invalid regex '{pattern}': {e}"))?;
    if multiple {
        Ok(regex
            .captures_iter(input)
            .filter_map(|caps| caps.get(group).map(|value| value.as_str().to_string()))
            .collect())
    } else {
        Ok(regex
            .captures(input)
            .and_then(|caps| caps.get(group).map(|value| value.as_str().to_string()))
            .into_iter()
            .collect())
    }
}

fn extract_seed_values(
    extractor: &CustomMetadataExtractor,
    html: &str,
    document: &Html,
    url: &str,
) -> Result<Vec<String>, String> {
    let kind = extractor.kind.trim().to_ascii_lowercase();
    let multiple = extractor.multiple;
    let mut out = match kind.as_str() {
        "css" | "js"
            if extractor.selector.as_deref().map(str::trim).unwrap_or_default().is_empty()
                && extractor.pattern.is_none()
                && extractor.value.is_none() =>
        {
            Vec::new()
        }
        "css" | "js" if extractor.selector.is_some() => {
            let selector = selector_from_str(extractor.selector.as_deref().unwrap_or_default())?;
            let iter = document.select(&selector).map(|element| {
                if extractor.html {
                    element.inner_html()
                } else if let Some(attr) = extractor.attr.as_deref() {
                    element.value().attr(attr).unwrap_or_default().to_string()
                } else {
                    extract_element_text(element)
                }
            });
            if multiple {
                iter.collect::<Vec<_>>()
            } else {
                iter.take(1).collect::<Vec<_>>()
            }
        }
        "regex" | "js" if extractor.pattern.is_some() => extract_regex_values(
            extractor.pattern.as_deref().unwrap_or_default(),
            extractor.flags.as_deref(),
            extractor.group.unwrap_or(1),
            html,
            multiple,
        )?,
        "literal" | "js" if extractor.value.is_some() => extractor.value.clone().into_iter().collect(),
        "regex" => extract_regex_values(
            extractor.pattern.as_deref().unwrap_or_default(),
            extractor.flags.as_deref(),
            extractor.group.unwrap_or(1),
            html,
            multiple,
        )?,
        "literal" => extractor.value.clone().into_iter().collect(),
        _ => Vec::new(),
    };

    if extractor.absolute_url {
        out = out
            .into_iter()
            .map(|value| make_absolute_url(url, &value))
            .collect();
    }
    Ok(finalize_values(out, extractor))
}

fn finalize_values(mut values: Vec<String>, extractor: &CustomMetadataExtractor) -> Vec<String> {
    if let Some(splitter) = extractor.split.as_deref().filter(|value| !value.is_empty()) {
        values = values
            .into_iter()
            .flat_map(|value| {
                value
                    .split(splitter)
                    .map(|part| part.to_string())
                    .collect::<Vec<_>>()
            })
            .collect();
    }

    values = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();

    if let Some(limit) = extractor.limit {
        if values.len() > limit {
            values.truncate(limit);
        }
    }

    if !extractor.multiple {
        if let Some(joiner) = extractor.join.as_deref() {
            if values.len() > 1 {
                return vec![values.join(joiner)];
            }
        }
        return values.into_iter().take(1).collect();
    }
    values
}

fn run_js_hook(script: &str, html: &str, url: &str, values: &[String]) -> Result<Vec<String>, String> {
    let input = JsHookInput {
        value: values.first().map(String::as_str),
        values,
        html,
        url,
    };
    let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;
    let wrapped = format!(
        "JSON.stringify((function(input) {{ const value = input.value; const values = input.values; const html = input.html; const url = input.url; {} }})({}))",
        script,
        input_json
    );
    let mut context = JsContext::default();
    let result = context
        .eval(JsSource::from_bytes(wrapped.as_str()))
        .map_err(|e| format!("JS hook failed: {e}"))?;
    let result_text = result
        .to_string(&mut context)
        .map_err(|e| format!("JS hook returned a non-string result: {e}"))?
        .to_std_string_escaped();
    if result_text == "undefined" || result_text == "null" {
        return Ok(Vec::new());
    }
    let parsed: Value = serde_json::from_str(&result_text)
        .map_err(|e| format!("JS hook returned invalid JSON: {e}"))?;
    Ok(value_to_vec(&parsed))
}

fn value_to_vec(value: &Value) -> Vec<String> {
    match value {
        Value::Null => Vec::new(),
        Value::String(text) => vec![text.trim().to_string()]
            .into_iter()
            .filter(|item| !item.is_empty())
            .collect(),
        Value::Bool(flag) => vec![flag.to_string()],
        Value::Number(number) => vec![number.to_string()],
        Value::Array(items) => items.iter().flat_map(value_to_vec).collect(),
        Value::Object(_) => vec![value.to_string()],
    }
}

fn extract_field_values(
    template: &CustomMetadataTemplate,
    field: &str,
    html: &str,
    document: &Html,
    url: &str,
) -> Result<Vec<String>, String> {
    let extractors = match template.fields.get(field) {
        Some(value) => value,
        None => return Ok(Vec::new()),
    };
    let expects_array = matches!(field, "screenshots" | "tags" | "genres" | "relations");
    let mut collected = Vec::new();
    for extractor in extractors {
        let mut values = extract_seed_values(extractor, html, document, url)?;
        if let Some(script) = extractor.script.as_deref().filter(|value| !value.trim().is_empty()) {
            values = run_js_hook(script, html, url, &values)?;
            values = finalize_values(values, extractor);
        }
        if expects_array {
            collected.extend(values);
            continue;
        }
        if let Some(value) = values.into_iter().find(|candidate| !candidate.trim().is_empty()) {
            return Ok(vec![value]);
        }
    }
    Ok(collected)
}

fn assign_field(meta: &mut GameMetadata, field: &str, values: Vec<String>) -> Result<(), String> {
    let first = values
        .first()
        .cloned()
        .filter(|value| !value.trim().is_empty());
    match field {
        "title" => meta.title = first,
        "version" => meta.version = first,
        "developer" => meta.developer = first,
        "publisher" => meta.publisher = first,
        "overview" => meta.overview = first,
        "overview_html" => meta.overview_html = first,
        "cover_url" => meta.cover_url = first,
        "engine" => meta.engine = first,
        "os" => meta.os = first,
        "language" => meta.language = first,
        "censored" => meta.censored = first,
        "release_date" => meta.release_date = first,
        "last_updated" => meta.last_updated = first,
        "rating" => meta.rating = first,
        "price" => meta.price = first,
        "circle" => meta.circle = first,
        "series" => meta.series = first,
        "author" => meta.author = first,
        "illustration" => meta.illustration = first,
        "voice_actor" => meta.voice_actor = first,
        "music" => meta.music = first,
        "age_rating" => meta.age_rating = first,
        "product_format" => meta.product_format = first,
        "file_format" => meta.file_format = first,
        "file_size" => meta.file_size = first,
        "screenshots" => meta.screenshots = dedupe_strings(values),
        "tags" => meta.tags = dedupe_strings(values),
        "genres" => meta.genres = dedupe_strings(values),
        "relations" => meta.relations = dedupe_strings(values),
        other => {
            return Err(format!(
                "Unsupported custom metadata field '{other}' in template results"
            ));
        }
    }
    Ok(())
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn template_matches_url(template: &CustomMetadataTemplate, url: &str) -> Result<bool, String> {
    for pattern in &template.url_patterns {
        let regex = RegexBuilder::new(pattern)
            .build()
            .map_err(|e| format!("Invalid url pattern '{pattern}' in template '{}': {e}", template.id))?;
        if regex.is_match(url) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn load_templates() -> Result<Vec<CustomMetadataTemplate>, String> {
    let mut templates = read_store()?.templates;
    for template in &mut templates {
        normalize_template(template)?;
    }
    Ok(templates)
}

pub fn list_template_summaries() -> Result<Vec<CustomMetadataTemplateSummary>, String> {
    let mut templates = load_templates()?;
    templates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(templates.iter().map(template_summary).collect())
}

pub fn find_matching_template(url: &str, include_override_only: Option<bool>) -> Result<Option<CustomMetadataTemplate>, String> {
    let templates = load_templates()?;
    for template in templates {
        if !template.enabled {
            continue;
        }
        if let Some(flag) = include_override_only {
            if template.override_builtin != flag {
                continue;
            }
        }
        if template_matches_url(&template, url)? {
            return Ok(Some(template));
        }
    }
    Ok(None)
}

pub fn find_template_by_source(source: &str) -> Result<Option<CustomMetadataTemplate>, String> {
    let template_id = source.strip_prefix("custom:").unwrap_or(source);
    Ok(load_templates()?
        .into_iter()
        .find(|template| template.id == template_id && template.enabled))
}

pub async fn fetch_custom_metadata(url: &str, template: &CustomMetadataTemplate) -> Result<GameMetadata, String> {
    let mut headers = HeaderMap::new();
    for (name, value) in &template.request_headers {
        let header_name = HeaderName::from_bytes(name.trim().as_bytes()).map_err(|e| {
            format!("Invalid request header name '{}' in template '{}': {e}", name, template.id)
        })?;
        let header_value = HeaderValue::from_str(value.trim()).map_err(|e| {
            format!("Invalid request header value for '{}' in template '{}': {e}", name, template.id)
        })?;
        headers.insert(header_name, header_value);
    }
    let response = http()
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Request failed for custom template '{}': {e}", template.name))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{} returned HTTP {}", template.name, status));
    }
    let html = response.text().await.map_err(|e| {
        format!(
            "Failed to read response body for custom template '{}': {e}",
            template.name
        )
    })?;
    let document = Html::parse_document(&html);
    let mut meta = GameMetadata {
        source: format!("custom:{}", template.id),
        source_label: Some(template.name.clone()),
        source_url: url.to_string(),
        title: None,
        version: None,
        developer: None,
        publisher: None,
        genres: Vec::new(),
        overview: None,
        overview_html: None,
        cover_url: None,
        screenshots: Vec::new(),
        tags: Vec::new(),
        relations: Vec::new(),
        engine: None,
        os: None,
        language: None,
        censored: None,
        release_date: None,
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
    };

    let mut fields = template.fields.keys().cloned().collect::<Vec<_>>();
    fields.sort();
    for field in fields {
        let values = extract_field_values(template, &field, &html, &document, url)?;
        if values.is_empty() {
            continue;
        }
        assign_field(&mut meta, &field, values)?;
    }

    let source_id = meta.source.clone();
    finalize_scrape_result(&source_id, template.name.as_str(), url, Ok(meta))
}

pub fn export_templates_json() -> Result<String, String> {
    let store = read_store()?;
    serde_json::to_string_pretty(&store).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn custom_metadata_list_templates() -> Result<Vec<CustomMetadataTemplateSummary>, String> {
    list_template_summaries()
}

#[tauri::command]
pub fn custom_metadata_export_templates() -> Result<String, String> {
    export_templates_json()
}

#[tauri::command]
pub fn custom_metadata_export_templates_to_path(path: String) -> Result<(), String> {
    let json = export_templates_json()?;
    write_string(Path::new(&path), &json)
}

#[tauri::command]
pub fn custom_metadata_import_templates(json_text: String) -> Result<Vec<CustomMetadataTemplateSummary>, String> {
    let imported = parse_import_payload(&json_text)?;
    let mut store = read_store()?;
    let mut next = store.templates;
    for mut template in imported {
        normalize_template(&mut template)?;
        if let Some(existing) = next.iter_mut().find(|current| current.id == template.id) {
            *existing = template;
        } else {
            next.push(template);
        }
    }
    next.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    store.templates = next;
    store.version = CUSTOM_METADATA_STORE_VERSION;
    save_store(&store)?;
    Ok(store.templates.iter().map(template_summary).collect())
}

#[tauri::command]
pub fn custom_metadata_import_templates_from_path(path: String) -> Result<Vec<CustomMetadataTemplateSummary>, String> {
    let raw = std::fs::read_to_string(Path::new(&path)).map_err(|e| e.to_string())?;
    custom_metadata_import_templates(raw)
}

#[tauri::command]
pub fn custom_metadata_delete_template(id: String) -> Result<Vec<CustomMetadataTemplateSummary>, String> {
    let mut store = read_store()?;
    let before = store.templates.len();
    store.templates.retain(|template| template.id != id);
    if store.templates.len() == before {
        return Err(format!("Custom metadata template '{}' was not found", id));
    }
    save_store(&store)?;
    Ok(store.templates.iter().map(template_summary).collect())
}

#[tauri::command]
pub fn custom_metadata_match_source(url: String) -> Result<Option<CustomMetadataSourceMatch>, String> {
    if let Some(template) = find_matching_template(&url, None)? {
        return Ok(Some(CustomMetadataSourceMatch {
            source: format!("custom:{}", template.id),
            source_label: template.name,
            template_id: template.id,
            is_custom: true,
        }));
    }
    Ok(None)
}

#[tauri::command]
pub async fn fetch_custom_metadata_command(url: String, template_id: String) -> Result<GameMetadata, String> {
    let template = find_template_by_source(&format!("custom:{template_id}"))?
        .ok_or_else(|| format!("Custom metadata template '{}' is not installed or is disabled", template_id))?;
    fetch_custom_metadata(&url, &template).await
}
