# Changelog

## 1.8.1 - 2026-04-25

### 🪟 Windows Shell Integration
- **Explorer quick-launch for `.exe`** — added an optional Windows Explorer context-menu action to launch executables through Libmaly even when the app is closed.
- **Settings-managed registration** — users can now register or remove the Explorer quick-launch entry directly from Settings without editing the registry manually.
- **Direct executable handoff** — Libmaly now accepts a dedicated CLI launch path for quick-launch requests and can start a selected `.exe` immediately, even if it is not already saved in the library.
- **Explorer install for `.zip`** — added an optional Windows Explorer context-menu action to install ZIP archives into a Libmaly library folder directly from the file manager.
- **ZIP install flow with library selection** — when a ZIP install is triggered, Libmaly can install straight into the only registered library folder or ask which library root to use if multiple folders are configured.
- **Post-install archive scan** — after extracting a ZIP archive, Libmaly now scans the installed folder for launchable executables and adds detected games to the library automatically.

## 1.8.0 - 2026-04-20

### 🛒 Launcher & Store Integrations
- **Expanded Steam import flow** — Steam import can now resolve owned libraries through the Steam Web API using a SteamID, vanity URL, or profile link, merge installed manifests with uninstalled owned titles, and keep placeholder entries that can later be upgraded into local installs.
- **Epic Games Store via Legendary** — added Legendary status/auth detection, owned-library import, launch support for installed Epic titles, and install actions for uninstalled Epic placeholders directly from Libmaly.
- **itch.io Butler integration** — added owned-library browsing, install/update actions, cave tracking, install-location support, and reuse of a stored itch.io API key from inside Libmaly.
- **EA App / Ubisoft Connect / Rockstar import** — added Windows protocol-store discovery from registry/local launcher metadata and preserved launcher protocol URIs so imported titles can still open through their native launcher.
- **GameJolt & Battle.net experimental import** — added best-effort manifest/registry detection for installed titles plus optional metadata enrichment from public store pages.
- **Cross-store ownership grouping** — multiple owned entries for the same game are now merged into a single library card with provider-aware grouping and cleaner sidebar/detail-page presentation.
- **Remote install flow** — added direct install triggers from the game detail page for supported launchers, including Steam, Epic, and Ubisoft Connect.

### ☁️ Sync, Cloud & Recovery
- **Google Drive and Dropbox sync** — added browser-based OAuth flows, token refresh support, provider configuration, and direct deep-link callback handling inside the app.
- **Production-ready S3 sync backend** — replaced the previous stub with real S3/object-storage upload, download, existence checks, and save-backup upload support.
- **Cloud auto-backup scheduling** — added periodic automatic library-state uploads for supported cloud providers plus manual “Run Backup Now” controls and background-job status reporting.
- **Save backup uploads** — game save backups can now be zipped and uploaded to the configured sync provider, with provider-specific remote save-backup paths.
- **Advanced conflict resolution** — sync now exposes previewable conflict details with local/remote/base values, manual resolution choices, and clearer conflict reporting in the UI.
- **Profile-scoped sync state** — sync config, base snapshots, and pending OAuth state are now stored per Libmaly profile instead of sharing one global state file.

### 🔐 Security & Account Storage
- **OAuth & API Vault** — added a centralized secure vault backed by the OS credential store for storefront cookies, metadata API keys, OAuth tokens, and sync secrets.
- **Profile-aware secret isolation** — vault entries are now namespaced by the active Libmaly profile so storefront sessions and sync credentials stay separated between profiles.
- **Legacy secret migration** — plaintext cookie files, API-key files, and sync secrets are migrated into the secure vault on first use, with legacy files retained only as migration fallback.
- **New Vault settings tab** — replaced the old API Keys screen with a profile-aware vault overview for storefront sessions, metadata APIs, itch.io access, and sync-secret status.

### ⚙️ Settings & UX Refresh
- **General settings redesign** — rebuilt the Settings modal into a wider dashboard-style workspace with a hero summary, grouped surfaces, clearer tab descriptions, and better separation between profile, account, appearance, system, sync, and maintenance controls.
- **Layout Presets Manager** — added built-in layout presets plus custom saved presets for view mode, sidebar width, and sidebar visibility toggles so users can switch between different library navigation setups quickly.
- **Expanded integrations workspace** — the Integrations tab now covers Steam playtime import, Steam owned-library import, Epic via Legendary, itch.io Butler, protocol-based launcher imports, and experimental exotic store bridges from one place.
- **Richer sync settings UX** — cloud sync now includes provider-specific setup guides, OAuth launch flows for Google Drive and Dropbox, manual conflict preview before resolution, and clearer auto-backup status reporting.
- **Custom metadata sources tab** — added import/export management for JSON-powered custom metadata templates directly from Settings, including enable/override state and installed-template summaries.

### 💾 Saves, Metadata & Detail View
- **Save transfer tool** — added a dedicated save-transfer modal that detects common save locations for engines like Unity, Unreal, Ren'Py, and RPG Maker, with optional backup before copy.
- **Cloud Save Zip action** — the game detail page can now create a save backup zip and immediately upload it to the configured cloud provider.
- **Richer metadata relations** — expanded IGDB and RAWG relation scraping and upgraded relation rendering in the detail page with labels and outbound links.
- **Provider-aware launch controls** — the detail page now supports “Launch via…” provider selection, launcher-specific open/install labels, and grouped ownership-aware actions.
- **Custom metadata templates** — added installable JSON scraper templates for unsupported storefronts/sites, with Rust-side extraction, optional JS hooks, and custom-source matching in the metadata pipeline.
- **Multi-source metadata aggregation** — metadata records can now retain source snapshots, merge fields across providers, expose source badges/links in the detail page, and show cleaner combined source summaries in exports and feeds.
- **Save transfer and recovery polish** — game pages now expose direct save-transfer actions alongside backup/export tools, making manual migration between installs or versions easier.

### 📸 Screenshots & Media Workflow
- **Screenshot Comparison Tool** — added a dual-pane comparison modal for in-game screenshots with left/right selection, swap, shared zoom, synchronized scrolling, difference overlay, and tag/time-gap summaries.
- **Gallery workflow upgrades** — screenshot lightbox and gallery header now expose direct compare actions so visual regressions or session-to-session differences can be inspected without leaving the current game page.

### 🛠️ Technical
- **Resilient Windows file reads** — Steam/library and launcher metadata reads now use shared-access/retry logic so imports are more reliable while external clients are running.
- **Expanded import surface in Settings** — the Integrations tab now exposes dedicated entry points for Epic, itch.io, protocol-store, and exotic-store import flows in addition to Steam/Lutris/Playnite/GOG.
- **Improved sync UI guidance** — added provider-specific setup guidance, auto-backup explanations, and clearer status messaging for OAuth-based cloud sync.

## 1.7.1 - 2026-04-13

### 🛡️ Critical Fixes
- **Dev/Prod data isolation** — fixed critical issue where development environment metadata could overwrite production data. Debug builds now use a separate data directory with `-dev` suffix (e.g., `libmaly-dev` on Windows) to completely isolate development and production environments.
- **Automatic pre-update backups** — added mandatory backup creation before any app update, protecting against data corruption even when users choose "install without deleting the application" in the installer. Backups are stored with the label "pre-update-backup" and can be restored from Settings.

### 🔍 Search & Metadata
- **Preferred metadata source selector** — added ability to set a preferred metadata source (F95zone, DLsite, VNDB, MangaGamer, Johren, FAKKU) that is used by default in the Link Game Metadata modal.
- **Preferred web search engine selector** — added ability to choose the web search engine (DuckDuckGo, Google, Bing, Brave) used for metadata lookups in Link Game Metadata. This allows users to switch search engines if one is not available or preferred.

## 1.7.0 - 2026-04-12

### 📊 Stats & Visuals
- **Activity Heatmaps** — GitHub-style 365-day play activity grid in the Stats view.
- **Year-in-Review generator** — Automated summary card of the year's gaming habits, favorite developers, and milestones.
- **Productivity Correlation** — Optional "Time well spent" vs "Binge" detection based on session length and frequency.
- **Advanced Backdrop FX** — Dynamic blur and glassmorphism levels based on the current game's cover art colors.

### 🎨 UI / UX
- **Custom CSS / User Styles** — added a new "🎨 Custom CSS" tab in Settings that allows power users to inject custom CSS overrides. Changes are applied immediately and persisted in localStorage.
- **Local-only "Ghost" mode** — added per-game or per-profile setting to disable all outbound metadata/update checks for high-privacy games.
- **Scrollable tab bar** — fixed Settings modal tab overflow by making the tab bar horizontally scrollable.
- **API Keys configuration** — added a "🔑 API Keys" tab in Settings for configuring third-party API credentials.
- **Enhanced Customize Game modal** — added new customization options:
  - **Custom tags** — add free-form tags for organization and filtering with inline editing and removal.
  - **Personal review** — write personal thoughts and notes about games, stored locally.
  - **Manual metadata overrides** — manually set developer, publisher, genres, release date, and description when scrapers don't work or for custom entries.

### 🌐 Sources & Extensibility
- **Third-party store integration** — added metadata providers for generic game databases to cover games not on F95/DLsite.
  - **IGDB (Internet Game Database)** — implemented metadata fetcher using Twitch OAuth authentication. Requires Client ID and Client Secret.
  - **RAWG.io** — implemented metadata fetcher using API key authentication.
  - **MobyGames** — implemented metadata fetcher using API key authentication.
  - **Filter support** — added IGDB, RAWG, and MobyGames as filter options in the game library.
  - **URL detection** — added helper functions to detect and handle IGDB, RAWG, and MobyGames URLs.

### ☁️ Sync & Backup
- **Provider-agnostic library sync** — implemented WebDAV, Nextcloud, and Git backends for state/save sync. S3 backend stubbed for future AWS SDK integration.
  - **WebDAV support** — full WebDAV provider with URL, username, password, and path configuration.
  - **Nextcloud support** — WebDAV-based Nextcloud provider with automatic URL path adjustment.
  - **Git support** — Git provider with repository URL, branch, and optional username/password credentials.
  - **Sync configuration** — integrated sync settings as a "🔄 Sync" tab in Settings modal.
  - **Conflict resolution** — added SyncConflictModal for resolving local/remote state conflicts.
- **Sync API layer** — created TypeScript API layer for frontend sync operations (configure, upload, download, check remote, resolve conflicts).

### 🛡️ Reliability & Recovery
- **Data consistency tests** — added a "🧪 Consistency Tests" tab in Settings that runs integration tests for scan, launch, crash, and recovery scenarios.
  - **Games list validation** — checks for duplicate paths and missing required fields.
  - **Metadata consistency** — verifies metadata matches games list, detects orphaned entries.
  - **Notes consistency** — verifies notes match games list, detects orphaned entries.
  - **Collections consistency** — validates collection game paths against games list.
  - **Storage keys validation** — checks for required storage keys.
  - **JSON validity** — validates all libmaly storage keys contain valid data.

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
