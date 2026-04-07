# Changelog

## Next ver.

### 📦 Package Management
- **Added .rpm build support** — Red Hat Package Manager packages for Linux distributions (Fedora, CentOS, RHEL)
- **Updated build scripts** — added dedicated commands for different package formats:
  - `npm run tauri:build:rpm` - Build RPM packages
  - `npm run tauri:build:appimage` - Build AppImage packages
  - `npm run tauri:build:linux` - Build Linux binaries
- **Added Linux dependencies** — specified required system packages for RPM builds

### 🏆 Achievement & Checklist Tracker
- **Integrated per-game task lists** — added support for custom achievements and checklists (text + completion status) per game.
- **Live progress tracking** — "Tracker" button on game cards now shows "completed / total" stats and a status dot for pending tasks.
- **Dedicated Task Modal** — new interface for adding, editing, and deleting checklist items with auto-save capability.
- **Deep Integration** — achievement data is fully supported in library profiles, snapshots, cloud sync, and the migration wizard.
- **Global Search Support** — checklist items are now indexed and searchable via the `Ctrl+K` command palette.

### 🍷 Wine / Proton Diagnostics & Fixes
- **Proactive Media Diagnostics** — introduced engine-aware heuristics for RPG Maker, Unity, Ren'Py, and more to estimate video playback risk.
- **Launch-time Protection** — added warnings before first launch if a game has high dependency on intro videos and the current prefix is missing required components.
- **Intro Video Status Bar** — game pages now show an "Intro video (Wine)" assessment with clickable access to recommended fixes.
- **Media Fix Preview (Dry-run)** — new modal shows exactly which winetricks commands will be run before applying fixes.
- **Post-Install Verification** — the app now verifies and displays a diff of fixed media components after a winetricks run.
- **Prefix Compatibility Presets** — added one-click quick presets for common issues including fonts, DirectShow, xact, and input quirks.
- **Improved Error Handling** — winetricks failures now combine stdout/stderr and provide human-readable hints for 404s, permissions, and network issues.
- **Extended Diagnostics Export** — included the `mediaPlaybackKnowledgeBase` and per-game risk assessment in support reports.

### ⚡ Performance & Caching
- **Database Vacuum/Optimize** — added a periodic maintenance task that prunes old in-memory logs, trims the file-ops journal, and automatically removes orphaned temp files from failed atomic writes.
- **Manual Storage Optimization** — users can now trigger a full vacuum from the Settings -> System panel to reclaim disk space and trim background overhead.
- **Shader pre-caching support** — detect, import, and export DXVK/Proton shader cache artifacts to reduce stutter during first-run gameplay.
- **Cache warmup hints** — game pages now indicate if a game benefits from shader cache prep and show the current cache status.

### 🛠️ Technical
- **Unified versioned state store** — migrated local storage from unstable browser `localStorage` to a unified, versioned JSON state store managed by the Rust backend.
- **State Schema Migrations** — added a robust migration engine for the state store with forward migration support, version tracking, and automatic `.bak` rollbacks on failure.
- **Unconditionally Unified Storage** — all library and settings data is now saved to the same consistent JSON structure regardless of "portable" mode, ensuring extreme reliability against WebView cache wipes.


## 1.6.0 - 2026-04-02

### 📊 Stats & Analytics Overhaul
- **Complete StatsView redesign** — replaced basic 4-block layout with a comprehensive analytics dashboard
- **12 new stat cards** across 3 rows: total playtime, most played, longest session, busiest day, total launches, avg session, games with notes, games rated, total games, custom tags, collections, and wishlist
- **Top 5 rankings** — progress bar visualizations for most-played games by time and by launch count
- **Completion status breakdown** — color-coded badges showing Playing/Completed/On Hold/Dropped distribution
- **Playtime & games by source** — bar charts breaking down library by F95/DLsite/VNDB/etc.
- **Activity streak tracker** — counts consecutive days with at least one gaming session
- **Favorite gaming time** — 24-hour histogram showing when you play most
- **Top developers by playtime** — ranked list of most-played studios/creators
- **Rating distribution** — histogram of your ratings across 5 buckets (0-20 to 81-100)
- **Monthly playtime trend** — sparkline chart showing activity over the last 6 months
- **Activity heatmap** — GitHub-style 365-day calendar heatmap of gaming activity
- **Category ratings radar** — radar chart showing average scores across Gameplay/Story/Soundtrack/Visuals/Characters/Performance
- **Session mood distribution** — progress bars for Hype/Chill/Chaos mood tags
- **Playtime donut chart** — ring chart showing time distribution by source platform

### 🌐 Internationalization
- **10 languages now supported** — added **German** (Deutsch) and **French** (Français) to the existing 8 languages
- **External language pack support** — users can now import custom JSON translations from settings without waiting for an app update

### 👤 Profiles & Personalization
- **Multiple library profiles** — separate profiles with isolated library/state/settings storage, designed for different PCs, users, or future synced identities
- **Tray profile switching** — active profile can now be changed directly from the tray menu without reopening settings
- **Custom profile identity fields** — profiles now support `displayName`, `handle`, `tagline`, `avatarUrl`, `bannerUrl`, and `accentColor`
- **Active profile badge** — the current profile is surfaced in the top bar for clearer context while switching libraries

### 🎮 Game Page & Launch
- **Per-game media fix button** — "Fix Video Playback" button on game detail page (Linux/macOS) that installs recommended winetricks verbs for the game's Wine/Proton prefix
- **Launch-time video playback warning** — warns before launching if the selected prefix has known media component issues
- **Smart button visibility** — media fix button only shown on non-Windows platforms

### 🔔 Notifications
- **Custom in-app notification layer** — themed toast notifications for session end, replacing/augmenting system notifications
- **Session end toasts** — shows game name and playtime in a styled in-app toast with dismiss button
- **System notification fallback** — OS notifications still sent if permission granted (optional)

### 💬 Discord Integration
- **Discord Social SDK integration** — added Windows-first Discord connection layer with runtime SDK loading and diagnostics
- **Rich Presence for games** — active games now show title, session state, and elapsed time in Discord
- **Idle launcher presence** — optional status while LIBMALY is open but no game is running
- **Join secret support** — optional Discord join secret for the active game with launch/open handling in LIBMALY
- **Cover art in Rich Presence** — game cover images from metadata/custom covers are now used as Discord large art when available
- **Connected Games bridge** — quick access to Discord Connected Games settings from inside LIBMALY
- **Discord diagnostics logging** — status changes, reconnects, and presence updates now appear in the app diagnostics log

### 📸 Screenshots
- **Screenshot overlay history** — quick recent-captures strip in the overlay window to confirm/save/tag the last few screenshots without leaving the game

### 🧭 Sidebar & Navigation
- **Minimal sidebar mode** — denser sidebar layout for users who want more room for the game list
- **Customizable sidebar sections** — users can now hide unused tabs and action buttons such as News, Stats, Wishlist, Surprise, Add, Settings, and Logs
- **Settings access fallback** — if the sidebar settings button is hidden, a compact settings button is shown in the top bar so access is never lost

### 🛠️ Technical
- **Code modularization** — split `App.tsx` (500KB+) into `lib/constants.ts` and `lib/helpers.ts` to eliminate Babel deoptimization warning
- **Extracted 30+ utility functions** — path helpers, color helpers, rating helpers, metadata helpers, and formatting functions moved to shared modules
- **Extracted all constants** — storage keys, job IDs, rating categories, collection colors, and default settings moved to `constants.ts`
- **Fixed TypeScript errors** — added proper type annotations for `RATING_CATEGORIES` and resolved implicit `any` types


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
