# Changelog

## 1.5.4 - 2026-04-02

### Internationalization (i18n)
- 8 languages added:
    - **English** (US)
    - **Russian** (Русский)
    - **Japanese** (日本語)
    - **Chinese** (中文)
    - **Korean** (한국어)
    - **Taiwanese Chinese** (繁體中文) — Traditional characters
    - **Polish** (Polski)
    - **Ukrainian** (Українська)
- Added translations for **all UI sections** including settings, library, game details, modals, and loading screens.
- Added **"What's New?" modal** that shows the changelog on first launch after an update, accessible anytime from settings.

## 1.5.3 - 2026-04-01

### Themes and customization
- Significant expansion of the visual palette with **15 new theme presets**:
    - **Light Themes**: Citrus Sherbert, Retro Raincloud, Sunrise, LoFi Vibes, Desert Khaki.
    - **Dark Themes**: Chroma Glow, Forest, Midnight Blurple, Mars, Dusk, Retro Storm, Neon Nights, Strawberry Lemonade, Aurora, Blurple Twilight.
- Added **Custom Theme Constructor**: Users can now create their own "Personal Theme" by fine-tuning over 20 CSS variables directly from the settings, including backgrounds, panel colors, text shades, and border intensities.
- Added **Reset to Defaults** functionality for custom themes.

### UI and UX improvements
- Implemented **custom UI components** to replace native browser elements for a more premium look:
    - **Checkboxes**: New animated checkmark with thematic scaling and accent-color integration.
    - **Select Menus**: Redesigned dropdowns with a custom chevron icon and smoother hover/active states.
    - **Number & Color inputs**: Cleaned up number inputs by hiding native spin buttons and restyled the color picker swatch with a modern, rounded design.
- Added **Global Scrollbar Restyling**: System-wide scrollbars are now thinner, rounded, and non-intrusive, matching the active theme colors.

### Reliability and performance
- Improved **network stability** for metadata scrapers (DLsite, VNDB, F95):
    - Added explicit **connection and request timeouts** to prevent requests from hanging indefinitely on flaky networks.
    - Updated User-Agent strings for better compatibility with API providers.
    - Verified and optimized the scraping health diagnostic reporting.

## 1.5.2 - 2026-03-29

### UI and themes
- Added two new theme presets: **Cotton Candy** (light pastel theme with pink and purple tones) and **Ocean Deep** (dark theme with deep blue and cyan tones).

## 1.5.1 - 2026-03-29

### Bug fixes
- Fixed critical issue where PowerShell/cmd would open when launching any game after Steam library import.
- Added proper validation for Steam app IDs to prevent launching games with invalid or empty app ID values.
- Improved Steam launch condition check to ensure proper optional chaining and type validation before attempting to launch through Steam.
- Reinforced error handling on the Rust backend to reject empty Steam app IDs.

## 1.5.0 - 2026-03-27

Summary of the work completed across this implementation cycle.

### Metadata and diagnostics
- Added scraper health monitoring with per-source failure reasons, parser-failure streak tracking, and source-wide parser failure detection.
- Extended diagnostics export/UI with scraper health snapshots.
- Added structured integrity and snapshot-restore reports for UI rendering and JSON export.
- Added `resolve_sync_conflicts` backend command for local/remote/base snapshot resolution.

### Reliability and recovery
- Added library integrity check with structured issue reporting.
- Added permissions diagnostics with actionable explanations for common write/access failures.
- Added state snapshots before risky operations and a manual `create_snapshot` command.
- Added snapshot listing, restore support, preview support, and a one-click restore wizard.
- Added crash-safe writes using atomic temp-and-rename flow plus recent file-ops journal.
- Added auto-recovery mode after crash with deferred background work and safe startup prompt.
- Hardened game process lifecycle handling with better start/exit detection, descendant PID tracking, and orphan cleanup attempts.
- Added auto-heal paths for moved/renamed game folders using confident remap suggestions.

### Background jobs and sync foundations
- Added unified background job status model: `queued`, `running`, `retrying`, `failed`, `permanent_failed`.
- Added queue execution with retry, exponential backoff, and concurrency limits.
- Moved metadata/update flows and folder sync flows onto the shared queue orchestration layer.

### Backup and retention
- Added save-file backup support.
- Added backup retention policy for snapshots and save backups with daily/weekly/monthly pruning.

### Import and interop
- Added Steam playtime import improvements and imported Steam library support from Steam manifests.
- Added Steam launch bridge for imported Steam titles with best-effort playtime sync back into LIBMALY.
- Added Lutris import with per-game runner/prefix overrides.
- Added Playnite and GOG Galaxy import flows.

### Wine / Proton
- Added prefix-level Wine/Proton media diagnostics for common video playback issues.
- Added one-click media compatibility fixes via recommended helper verbs.

### Screenshots and notifications
- Added custom screenshot toasts in the app UI.
- Added Windows-first screenshot overlay window shown over games, with thumbnail confirmation after capture.
- Disabled the browser/webview default context menu while preserving the custom sidebar menu and editable-field exceptions.

### UI and UX
- Fixed sidebar folder rendering to use a more reliable hierarchical tree instead of unstable pseudo-grouping.
- Added a setting so `Surprise me` can open a random game without launching it immediately.
- Fixed custom window controls so minimize/maximize/close react to clicks correctly.
- Added additional built-in theme presets: Mint Apple, Hanami, Dawn, Sunset, Crimson Moon, and Sepia.

### Roadmap and project hygiene
- Updated `TODO.md` to reflect completed reliability, sync, screenshot, import, and internal-interface work from this cycle.
- Bumped application version from `1.4.0` to `1.5.0`.
