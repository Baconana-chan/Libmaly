## 🚀 Release & Distribution

Mobile app work is tracked separately in [TODO_MOBILE.md](TODO_MOBILE.md) so the desktop roadmap stays focused on the current Tauri app.

- [ ] **Release on itch.io** — create landing page, configure game categories, and set up Butler for automated build pushes.
- [ ] **Release on Epic Games Store** — fulfill self-service publishing requirements and integrate basic EGS SDK features.
- [ ] **Release on WinGet / Scoop** — publish portable/installer manifests so Windows users can install and update Libmaly from package managers.

---

## 🎨 UI / UX

- [ ] **Theme Marketplace/Gallery** — browse and install community-made JSON themes from a trusted relay
- [ ] **Game detail layout presets** — switch between metadata-first, screenshots-first, and notes-first page layouts per profile
- [ ] **Quick side panel** — optional secondary panel for notes / achievements / media without fully leaving the current view
---

## 📊 Stats & Tracking

- [ ] **Session timeline explorer** — zoomable per-day/per-week timeline to inspect exactly when and how long each session happened
- [ ] **Tag / developer breakdowns** — charts for most-played genres, tags, engines, developers, and collections over time

---

## 📸 Screenshots 

- [ ] **Instant Replay (Short Clips)** — capture the last 15–30 seconds of gameplay as a GIF or MP4 (experimental Rust-side buffer)
- [ ] **Auto-highlight detection** — optionally detect scene changes / rapid motion and suggest “best moment” screenshots from replay buffers

---

## 🌐 Sources & Extensibility

- [ ] **Interactive game maps integration** — attach maps from an external provider (for example Map Genie–style services or community map sources) directly on the game page / overlay when a game is supported
- [ ] **Guide / wiki provider slots** — configurable external links/providers for walkthroughs, maps, patch notes, and modding resources per game
- [ ] **Metadata post-processing rules** — user-defined cleanup/merge rules for titles, tags, developers, and source priority after multi-source fetches

---

## 🕹️ Universal In-Game Overlay

- [ ] **Full-screen Dashboard (Shift+Tab)** — immersive UI that pauses in-game input and provides a centralized navigation hub
- [ ] **Overlay Workspace & Widgets** — drag-and-drop widget layout:
  - [ ] **Clock & Session Timer** — keep track of time and playtime milestones
  - [ ] **In-game Web Browser** — mini-WebView for guides, walkthroughs, or searching F95/DLsite mid-game
  - [ ] **Markdown Note Editor** — view and edit game notes/achievements without Alt-Tabbing
  - [ ] **System Monitor** — floating FPS counter and basic CPU/GPU telemetry
- [ ] **Global Hotkey & Input Hooking** — reliable Rust-side keyboard hook for guaranteed overlay trigger even in administrative-level fullscreen games
- [ ] **Context-aware metadata** — show the currently running game's version and "New Update Available" status directly in the overlay
- [ ] **Interaction Layer** — toggle `setIgnoreCursorEvents` dynamically to allow interacting with the overlay while the game runs in the background

---


## 🎮 Controller & Remote Play

- [ ] **Controller overlay for unsupported games** — on-screen radial / quick-action overlay to trigger keyboard or mouse-mapped actions for games with no native controller support
- [ ] **Per-game controller mapping profiles** — bind gamepad buttons / sticks to keyboard, mouse, macros, and save separate profiles per game
- [ ] **Overlay shortcut wheel** — Steam Input-style surface for common actions like screenshot, suspend input, alt-tab, volume, and custom macros
- [ ] **Radial menus / action layers** — hold a controller button to open a Steam Input-style radial menu for save/load, inventory, notes, screenshot, exit, or custom actions
- [ ] **Controller-friendly launcher mode** — big-picture style navigation for the library, game pages, and screenshots with no mouse required
- [ ] **Input injection safety layer** — focus-aware input routing so remapped controller input only goes to the active game and does not leak into the desktop
- [ ] **Universal controller translation layer** — present a consistent virtual Xbox/SDL-style pad to games even when the physical device is unusual or only partially supported
- [ ] **Remote Play host mode** — stream video/audio from the host PC and relay remote input for couch/co-op or handheld play
- [ ] **Remote Play guest join flow** — simple invite code or local-network pairing flow to connect another device as a viewer/controller
- [ ] **Remote Play overlay controls** — in-session overlay for bitrate, latency, audio device, connected controllers, and quick disconnect
- [ ] **Local-network streaming first** — LAN-first mode before internet relay; optimise for low setup friction on the same Wi‑Fi/router
- [ ] **Virtual gamepad relay** — expose remote input as a virtual XInput/SDL controller on the host for games that support pads directly
- [ ] **Remote co-op input slots** — map local + remote players into separate controller slots for shared-screen games
- [ ] **Session-safe streaming recovery** — reconnect guest after host hiccup/suspend without corrupting session state or leaving stuck inputs

### Internal Interfaces / Types (planned)
- [ ] **Controller profile schema** — per-game bindings, stick curves, deadzones, turbo/macro settings, and overlay layout slots
- [ ] **Virtual input backend** — host-side abstraction for keyboard/mouse injection and virtual controller output
- [ ] **Remote session model** — `pairing` / `connecting` / `streaming` / `reconnecting` / `ended`
- [ ] **Overlay action registry** — typed action catalogue for screenshot, note, mute, quit, macro, and custom command entries
- [ ] **Stream diagnostics report schema** — bitrate, RTT, decode delay, packet loss, input lag estimate, and disconnect reasons

---

## 🛒 Launcher & Store Integrations

- [ ] **RetroArch / emulator launcher integration** — import ROM launch targets and launch through configured emulator profiles without treating them as plain `.exe` entries
- [ ] **SteamGridDB / artwork sync** — fetch alternate covers, heroes, logos, and icons to improve library presentation for imported/non-store games

---

## 🛠️ Technical

- [ ] **Plugin system** — allow JS/WASM plugins to add metadata sources or UI panels
- [ ] **Desktop UI modularisation** — split the current monolithic App/page orchestration into feature modules so desktop UI can grow without App.tsx remaining the main bottleneck
- [ ] **Shared frontend core extraction** — move reusable non-UI logic into shared modules so future desktop/mobile/web surfaces can reuse data logic without sharing layouts
- [ ] **REST/WebSocket API Mode** — open API for third-party developers:
  - [ ] **Remote Control** — launch games, control volume, and monitor status from external apps
  - [ ] **State Access** — read library metadata, stats, and notes for external dashboards/sidecar apps
  - [ ] **Extension hooks** — allow external scripts to "push" notifications or widgets into the Libmaly overlay
- [ ] **SDK / Reference implementation** — provide a boilerplate for third-party developers to build fan-made tools on top of Libmaly


### Internal Interfaces / Types (planned)



### Reliability Test Scenarios (planned)
Automated dry-run checks now live in Settings -> Consistency Tests. Run them on each target OS before shipping a release candidate.

---

## 📡 Social & Connectivity (Local-first)

- [ ] **Peer-to-Peer Activity "Pulse"** — local-network broadcast + optional encrypted relay to see what friends are playing without a central server
- [ ] **Agnostic Social Backend** — user-configurable relay URL system:
  - [ ] Support official **Libmaly Cloud** relay
  - [ ] Support fan-made/self-hosted relay implementations without feature-gating
- [ ] **Concurrent Social Providers** — architecture to link multiple social identities (e.g. Libmaly-Relay + Discord + Steam) without sources "extinguishing" or overriding each other
- [ ] **Relay Feature Negotiation** — auto-detect relay capabilities and dynamically adjust UI (e.g. hide 'Chat' if the relay doesn't support it)
- [ ] **Anonymized Global Trending** — optional opt-in to fetch/publish aggregate local-only stats ("Most played this week globally") without personal identity tracking
- [ ] **Portable Social Identity** — export/import social profile keys (Display Name, Avatar, PGP/ED25519 keys) to stay independent of any specific relay or server
- [ ] **Encrypted P2P Chat** — basic secure messaging for coordinating multiplayer or sharing game notes
- [ ] **Decentralized sharing (Nostr/ActivityPub)** — publish reviews, ratings, and screenshots to decentralized social feeds directly from the UI
- [ ] **Multi-protocol social linking** — bridge activity from Discord, Steam, and Libmaly-Relay into a single unified local feed
- [ ] **Friend activity** — optional peer-to-peer "what are friends playing" via a relay server


---
---

## ✅ Completed

### Recently Completed / Moved From Active Roadmap
- [x] **Custom CSS / User Styles** — allow power users to inject custom CSS to override any part of the UI
- [x] **Layout Presets Manager** — save and switch between global layout configurations (e.g. "Minimalist", "Data-heavy", "Console-mode")
- [x] **Advanced Backdrop FX** — dynamic blur and glassmorphism levels based on the current game's cover art colors
- [x] **Year-in-Review generator** — automated summary card of the year's gaming habits, favorite developers, and milestones
- [x] **Activity Heatmaps** — GitHub-style 365-day play activity grid in the Stats view
- [x] **Productivity Correlation** — optional "Time well spent" vs "Binge" detection based on session length and frequency
- [x] **Screenshot Comparison Tool** — dual-pane view to compare visual differences between game versions or session moments
- [x] **Universal data-source engine** — allow adding custom metadata scrapers via JSON templates (URL patterns, CSS selectors, regex, or simple JS hooks)
- [x] **Multi-source metadata aggregation** — fetch and merge data from multiple sources for a single game (e.g. F95 version tags + VNDB media + DLsite descriptions)
- [x] **Local-only "Ghost" mode** — per-game or per-profile setting to disable all outbound metadata/update checks for high-privacy games
- [x] **Third-party store integration** — metadata providers for generic stores (IGDB, RAWG, MobyGames) to cover games not on F95/DLsite
- [x] **Provider-agnostic library sync** — add WebDAV, Nextcloud, and generic S3/Git backends for state/save sync beyond Google Drive/Dropbox
- [x] **Database Vacuum/Optimize** — periodic background task to prune old logs and optimize local state storage
- [x] **Unified storage with schema migrations** — move to a versioned state store with forward migrations and rollback on migration failure
- [x] **Google Drive / Dropbox auto-backup** — optional periodic upload of library JSON to a cloud folder
- [x] **Save-file cloud sync** — upload save zips to a configured folder (Google Drive, local NAS, etc.)
- [x] **Cloud sync conflict resolver** — 3-way merge for local/remote/base snapshots to avoid silent data loss
- [x] **Unified Cloud Library Sync** — fetch complete ownership lists (including uninstalled titles) from major storefronts
- [x] **Enhanced Steam Integration** — list all library titles via Web API / ID hunting; trigger `steam://install/<id>` for uninstalled games
- [x] **Epic Games Store** — cloud-based library listing and Legendary-style launch integration
- [x] **itch.io Butler Integration** — browse, download, and auto-update itch.io purchases directly within Libmaly
- [x] **EA App / Ubisoft Connect / Rockstar** — protocol-based library discovery and "Launch from Store" support
- [x] **GameJolt & Battle.net** — experimental manifests reading for installed titles and cloud metadata sync
- [x] **Cross-Store Ownership Grouping** — automatically merge multiple entries for the same game owned on different platforms into a single UI card with a "Launch via..." provider selector
- [x] **Remote Install Flow** — trigger game installation in external launchers directly from the Libmaly detail page
- [x] **OAuth & API Vault** — secure centralized manager for storefront tokens and cookies (integrated with Libmaly Profile persistence)
- [x] **Data consistency tests** — integration scenarios for scan → launch → crash → recovery across Windows/Linux/macOS
- [x] **Crash during write** — verify state remains recoverable and library is not fully lost
- [x] **Root folder rename** — verify automatic path healing restores most mapped games
- [x] **Local vs cloud conflict** — verify merge keeps playtime and notes deterministically
- [x] **Broken metadata source** — verify graceful degradation without blocking core UI
- [x] **Cross-platform backup/restore** — validate backup restore and integrity check on Windows/Linux/macOS

### Library & Scanning
- [x] **Multi-folder library** — scan multiple root directories instead of one; each shown as a separate section or merged
- [x] **Manual game add** — "Add Game" button to point directly at an .exe without scanning a folder
- [x] **Executable override** — per-game setting to choose a different .exe when multiple launchers exist in the same folder
- [x] **Sub-folder grouping** — detect when multiple games live under one parent dir and show them grouped
- [x] **Rescan selected folder** — right-click a game → "Rescan folder" without re-scanning the whole library

### Game Detail
- [x] **Age / content warning gate** — optional blur + click-to-reveal for games tagged as adult content
- [x] **RSS Feeds & News** — configurable RSS feed reader built-in, preconfigured with F95zone latest games
- [x] **Keep game data on uninstall** — option to keep playtime/metadata when deleting or physically moving a game folder, marking it as "uninstalled/missing"
- [x] **Custom sort order** — drag-and-drop reordering of games in the sidebar (saved per collection)
- [x] **Multiple executables per game** — pin 2–3 launch targets (e.g. game.exe + config.exe)
- [x] **Launch arguments** — text field per game for command-line flags
- [x] **Launch count** — track number of sessions; show "played 42 times"
- [x] **Achievement tracker** — manual per-game checklist for routes, endings, or goals; auto-save; Ctrl+K search matches checklist text

### UI / UX
- [x] **Sidebar width** — resizable via drag handle
- [x] **Grid view** — toggle between list and cover-art grid (Steam-style)
- [x] **Compact list mode** — denser rows with tiny thumbnail for large libraries
- [x] **Minimal / customizable sidebar** — compact sidebar mode with per-section visibility toggles for News, Stats, filters, Collections, Developers, Wishlist, Surprise, Add, Settings, and Logs
- [x] **Keyboard navigation** — arrow keys through game list, Space to launch
- [x] **Global search** — Ctrl+K command palette; search by name, tag, developer, notes, achievement checklist rows
- [x] **Sidebar badge** — total hidden count next to "Hidden" filter chip
- [x] **Animated cover placeholder** — shimmer skeleton while metadata is loading
- [x] **Scroll-to-selected** — sidebar scrolls to keep selected game visible
- [x] **Fullscreen cover wall** — kiosk mode hiding all chrome; just the game grid
- [x] **Export library as HTML/CSV** — sharable static page or spreadsheet of your collection
- [x] **Themes** — Dark (current), Light, OLED-black; accent colour picker
- [x] **Theme scheduler** — auto-switch Light ↔ Dark based on time of day or OS setting
- [x] **Back / Forward navigation** — browser-style history for jumping between views
- [x] **Mystery launch button** — "Surprise me" launches a random game from the library (excluding hidden/dropped)
- [x] **Dynamic seasonal themes** — small seasonal visual presets (winter/summer/halloween) with manual switch
- [x] **Session mood stickers** — quick mood tag after each session (`hype` / `chill` / `chaos`) shown in play history

### Stats & Tracking
- [x] **Play history log** — timestamped session log per game shown as a timeline (max 50 entries)
- [x] **Milestones** — 1h / 5h / 10h / 25h / 50h / 100h badges with progress bar to next milestone
- [x] **Weekly chart** — 7-day SVG bar chart per game and library-wide in HomeView
- [x] **Most played this week** — HomeView widget with top-5 progress-bar ranking
- [x] **Import playtime from Steam** — reads `localconfig.vdf`, fuzzy-matches by name, merges playtime
- [x] **Session notes** — toast after each session (≥30 s); editable inline from Play History timeline
- [x] **All-time stats page** — total hours, busiest day of week, longest single session, most-launched game
- [x] **Game completion status** — mark games as Playing / Completed / On Hold / Dropped; filter sidebar by status
- [x] **Session time budget** — optional daily/session time limit per game with a toast warning when reached

### Metadata
- [x] **F95Zone scraper** — cover, tags, version, developer, screenshots
- [x] **DLsite scraper** — cover, tags, version, circle name, rating
- [x] **DLsite age-gate cookies** — manual cookie/session support; no login flow required
- [x] **Auto-link by name** — fuzzy-match game folder name against F95 / DLsite and suggest a link without manual URL entry
- [x] **Batch metadata refresh** — "Update all linked games" button that re-fetches all entries in the background
- [x] **Cache expiry** — auto-re-fetch metadata older than N days (configurable)
- [x] **Custom user tags** — free-form tags beyond the scraped ones; filterable in sidebar
- [x] **Wishlist** — add un-owned games with a link and release status; separate sidebar section
- [x] **Metadata diff view** — when re-fetching, show "changed: version 0.9 → 1.0" before applying
- [x] **Game version history** — log each time you update a game (date + note); shown as timeline entries
- [x] **Developer grouping** — sidebar section "By Developer"; click to filter all games from one circle/studio
- [x] **VNDB support** — fetch metadata from vndb.org for visual novels (cover, tags, relations, release date)
- [x] **MangaGamer / Johren / Fakku support** — additional store scrapers
- [x] **Scraper health monitor** — detect source-wide parser failures and surface per-source failure reasons in diagnostics

### Notifications & Tray
- [x] **Update checker** — notification when a linked F95/DLsite game has a new version posted
- [x] **New version badge** — "!" indicator in sidebar next to games with available updates
- [x] **App self-update checker** — checks GitHub releases at startup; shows sidebar button if newer version exists
- [x] **Session end toast** — system notification on game exit: "Played Foo for 1h 23m"
- [x] **Tray tooltip** — currently-running game name + live session duration
- [x] **Startup with Windows** — option to launch minimised to tray on login
- [x] **Settings fallback button** — topbar fallback keeps settings reachable when the sidebar settings button is hidden

### Screenshots (Windows)
- [x] **F12 global hotkey** — capture foreground window while any game is running
- [x] **Screenshot gallery** — per-game gallery with thumbnails in the detail panel
- [x] **Screenshot deletion** — remove individual screenshots from the gallery
- [x] **Auto-screenshot timer** — periodic screenshot every N minutes while a game runs
- [x] **Screenshot tagging** — label screenshots ("ending", "bug", "funny moment"); filterable gallery
- [x] **Non-Windows screenshot** — global hotkey via X11/Wayland on Linux; CGWindow on macOS
- [x] **Export gallery** — zip all screenshots for a game and save / share
- [x] **Screenshot annotation** — simple draw / text overlay before saving
- [x] **In-game screenshot confirmation toast** — show a Steam-style overlay toast when a screenshot is captured, with optional thumbnail/tag feedback instead of silent save
- [x] **Screenshot overlay history** — quick recent-captures strip in the overlay to confirm/save/tag the last few screenshots without leaving the game

### Wine / Proton
- [x] **Global Wine/Proton config** — set Wine binary and prefix globally; used for all non-Windows games
- [x] **Per-game Wine toggle** — enable/disable Wine wrapper per game on Linux/macOS
- [x] **Per-game runner config** — override the global Wine/Proton settings for individual games
- [x] **Wine prefix manager** — create, list and delete prefixes from within the UI
- [x] **DXVK / VKD3D auto-install** — detect if DXVK is present in a prefix; offer to install it
- [x] **Winetricks integration** — run common verbs (vcrun2019, d3dx9, etc.) from a dropdown
- [x] **Proton-GE support** — auto-detect Proton-GE builds alongside official Steam Proton
- [x] **Lutris import** — read Lutris's game database to import already-configured Wine games
- [x] **Per-game intro-video risk** — merge prefix media scan with engine/exe/path heuristics; banner on game page; smarter launch confirm; diagnostics export includes per-game rows + `mediaPlaybackKnowledgeBase`
- [x] **Media fix preview & verify** — modal shows `winetricks -q` verb list before install; after success re-lists prefixes and diffs MF/Quartz/WMP/LAV/WMV markers; failures append heuristic hints; Rust merges stdout into error text
- [x] **Media playback diagnostics for Wine/Proton** — detect missing Media Foundation / Quartz / WMP-style components in a prefix and explain likely intro-video playback issues
  - [x] Prefix-level media component detection for `mf` / `quartz` / `wmp` / `lavfilters`-style gaps
  - [x] Human-readable summary + recommended fix verbs in Wine/Proton settings
  - [x] Per-game media diagnostics — combine prefix health with game executable / engine hints to estimate actual intro-video risk
  - [x] Launch-time warning for likely broken video playback — warn before first launch when the selected prefix is missing required media components
  - [x] Diagnostics export integration — include media compatibility findings in JSON diagnostics / support reports
  - [x] Known-issues knowledge base — map common engines / launchers to recommended media fixes and known bad combinations
- [x] **One-click media compatibility fixes** — install recommended media playback components for a prefix via winetricks / compatibility helpers
  - [x] One-click install of recommended media fix verbs for a prefix
- [x] **Per-game apply flow** — install fixes directly from a game page using that game's effective prefix/runner
  - [x] Dry-run / preview step — show which verbs/components will be installed before applying
  - [x] Post-install verification — re-scan the prefix and show which components were actually fixed
  - [x] Compatibility presets — offer safe presets like `Legacy WMV videos`, `RPG Maker intro fix`, `WMP-heavy game`, `Fallback filters only`
  - [x] Failure-specific guidance — when `winetricks` fails, surface actionable next steps instead of only raw stderr
- [x] **Shader pre-caching / DXVK cache management** — detect, import, export, and optionally share DXVK/Proton shader cache artifacts to reduce first-run stutter
- [x] **Per-game shader cache warmup hints** — show when a game is likely to benefit from shader cache prep and surface cache status before first launch
- [x] **Prefix compatibility presets** — optional quick presets for common Windows-game issues (video playback, fonts, DirectShow, xact, input quirks)

### Performance & Stability
- [x] **Virtual sidebar list** — windowed rendering for 1000+ game libraries
- [x] **kill_game on Linux/macOS** — SIGTERM with timeout fallback to SIGKILL

### Import & Interop
- [x] **Deep link protocol** — `libmaly://launch/<game-path>` URI scheme for external tools
- [x] **CLI interface** — `libmaly launch <name>` from a terminal
- [x] **Import from Playnite / GOG Galaxy** — read existing launchers' databases and merge into library
- [x] **Steam library import** — read installed Steam manifests, import detected games into LIBMALY, and attach Steam app IDs for launch integration
- [x] **Steam launch bridge / playtime sync** — optionally launch imported Steam titles through Steam and pull updated playtime back into LIBMALY with best-effort session tracking

### Technical
- [x] **Log viewer** — in-app console showing recent Rust-side errors/warnings for debugging
- [x] **Crash reporter** — catch panics and offer to copy a report to clipboard
- [x] **Tray icon on macOS** — verify/fix `NSStatusItem` behaviour once macOS build is stable
- [x] **Portable mode** — store all data next to the exe instead of AppData (USB-stick installs)
- [x] **i18n / l10n** — internationalisation framework; provide RU, JA, ZH translations
- [x] **Custom notification layer migration** — replace most system notifications with themed in-app / in-overlay notifications while keeping OS notifications only as optional fallback
- [x] **Roadmap hygiene task** — keep README and TODO in sync for backup/sync feature status

### Community / Social (long-term)
- [x] **Review & rating** — personal 1–10 rating + short review stored locally; exportable
- [x] **Profile identity customization** — local profile identity fields (`displayName`, `handle`, `tagline`, `avatarUrl`, `bannerUrl`, `accentColor`) as groundwork for future online/social features
- [x] **Public wishlist** — export a sharable static HTML page of your collection/wishlist

### Sync & Backup
- [x] **Cloud config sync** — export/import full library state (stats, metadata, notes, collections) as JSON
- [x] **Migration wizard** — "Move game folder" that updates all internal paths without losing stats/metadata
- [x] **Save-file backup** — detect common save directories and zip them on demand or on exit
- [x] **Backup retention policy** — rotate backups by daily/weekly/monthly rules and auto-prune old archives
- [x] **One-click restore wizard** — restore state from backup with overwrite preview before apply
- [x] **Multiple library profiles** — separate profiles for different PCs or users; switchable from the tray
  - [x] Per-profile library/state/settings storage namespaces
  - [x] Tray profile switching
  - [x] Custom profile identity fields (`displayName`, `handle`, `tagline`, `avatarUrl`, `bannerUrl`, `accentColor`)

### Internal Interfaces / Types (planned)
- [x] **`run_integrity_check` command** — app-level command for integrity scan and JSON/UI report output
- [x] **`create_snapshot` command** — app-level command to create manual or pre-op state snapshots
- [x] **`restore_snapshot` command** — app-level command to restore from snapshot with dry-run preview support
- [x] **`resolve_sync_conflicts` command** — app-level command to resolve local/remote/base state conflicts
- [x] **Background job status model** — `queued` / `running` / `retrying` / `failed` / `permanent_failed`
- [x] **Integrity/restore report schema** — structured report type for UI rendering and JSON export

### Reliability & Recovery
- [x] **Crash-safe writes** — atomic state writes via temp + rename and a small recent-ops journal
- [x] **Auto-recovery mode** — safe startup mode after crash (no background refresh/scraping) with one-click recovery prompt
- [x] **Library integrity check** — command to validate broken paths, duplicate IDs, and invalid executables
- [x] **Auto-heal paths** — auto-fix moved/renamed game folders using file signatures + fuzzy matching
- [x] **Process lifecycle hardening** — more reliable game start/exit detection and orphan process cleanup
- [x] **State snapshots before risky ops** — auto snapshot before batch metadata refresh, imports, and migration wizard operations
- [x] **Permissions diagnostics** — detect and explain permission failures for screenshots/saves/backups with actionable fixes

### Background Jobs
- [x] **Queue with retry/backoff** — unified metadata/update/sync queue with retry, exponential backoff, and concurrency limits
