# LIBMALY — Ideas & Roadmap

---

## 🎨 UI / UX




---

## 📊 Stats & Tracking



---

## 🌐 Metadata




---

## 🖼️ Screenshots

- [ ] **Screenshot overlay history** — quick recent-captures strip in the overlay to confirm/save/tag the last few screenshots without leaving the game


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

## 🧰 Background Jobs



---

## 🛡️ Reliability & Recovery

- [ ] **Unified storage with schema migrations** — move to a versioned state store with forward migrations and rollback on migration failure

---

## ☁️ Sync & Backup

- [ ] **Google Drive / Dropbox auto-backup** — optional periodic upload of library JSON to a cloud folder
- [ ] **Save-file cloud sync** — upload save zips to a configured folder (Google Drive, local NAS, etc.)
- [ ] **Multiple library profiles** — separate profiles for different PCs or users; switchable from the tray
- [ ] **Cloud sync conflict resolver** — 3-way merge for local/remote/base snapshots to avoid silent data loss

---

## 🍷 Wine / Proton (Linux & macOS)

- [/] **Media playback diagnostics for Wine/Proton** — detect missing Media Foundation / Quartz / WMP-style components in a prefix and explain likely intro-video playback issues
  - [x] Prefix-level media component detection for `mf` / `quartz` / `wmp` / `lavfilters`-style gaps
  - [x] Human-readable summary + recommended fix verbs in Wine/Proton settings
  - [ ] Per-game media diagnostics — combine prefix health with game executable / engine hints to estimate actual intro-video risk
  - [ ] Launch-time warning for likely broken video playback — warn before first launch when the selected prefix is missing required media components
  - [ ] Diagnostics export integration — include media compatibility findings in JSON diagnostics / support reports
  - [ ] Known-issues knowledge base — map common engines / launchers to recommended media fixes and known bad combinations
- [/] **One-click media compatibility fixes** — install recommended media playback components for a prefix via winetricks / compatibility helpers
  - [x] One-click install of recommended media fix verbs for a prefix
  - [ ] Per-game apply flow — install fixes directly from a game page using that game’s effective prefix/runner
  - [ ] Dry-run / preview step — show which verbs/components will be installed before applying
  - [ ] Post-install verification — re-scan the prefix and show which components were actually fixed
  - [ ] Compatibility presets — offer safe presets like `Legacy WMV videos`, `RPG Maker intro fix`, `WMP-heavy game`, `Fallback filters only`
  - [ ] Failure-specific guidance — when `winetricks` fails, surface actionable next steps instead of only raw stderr
- [ ] **Shader pre-caching / DXVK cache management** — detect, import, export, and optionally share DXVK/Proton shader cache artifacts to reduce first-run stutter
- [ ] **Per-game shader cache warmup hints** — show when a game is likely to benefit from shader cache prep and surface cache status before first launch
- [ ] **Prefix compatibility presets** — optional quick presets for common Windows-game issues (video playback, fonts, DirectShow, xact, input quirks)


---

## 📥 Import & Interop

- [/] **Steam launch bridge / playtime sync** — optionally launch imported Steam titles through Steam and pull updated playtime back into LIBMALY with best-effort session tracking

---

## 🛠️ Technical

- [ ] **i18n / l10n** — internationalisation framework; provide RU, JA, ZH translations
- [ ] **Plugin system** — allow JS/WASM plugins to add metadata sources or UI panels
- [ ] **REST API mode** — optional local HTTP server so external scripts can query/control the library
- [ ] **Custom notification layer migration** — replace most system notifications with themed in-app / in-overlay notifications while keeping OS notifications only as optional fallback
- [ ] **Data consistency tests** — integration scenarios for scan → launch → crash → recovery across Windows/Linux/macOS
- [ ] **Roadmap hygiene task** — keep README and TODO in sync for backup/sync feature status

### Internal Interfaces / Types (planned)



### Reliability Test Scenarios (planned)
- [ ] **Crash during write** — verify state remains recoverable and library is not fully lost
- [ ] **Root folder rename** — verify automatic path healing restores most mapped games
- [ ] **Local vs cloud conflict** — verify merge keeps playtime and notes deterministically
- [ ] **Broken metadata source** — verify graceful degradation without blocking core UI
- [ ] **Cross-platform backup/restore** — validate backup restore and integrity check on Windows/Linux/macOS

---

## 🤝 Community / Social (long-term)

- [ ] **Achievement tracker** — manual checklist per game for tracking in-game routes or achievements
- [ ] **Public wishlist** — export a sharable static HTML page of your collection/wishlist
- [ ] **Friend activity** — optional peer-to-peer "what are friends playing" via a relay server

---
---

## ✅ Completed

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

### UI / UX
- [x] **Sidebar width** — resizable via drag handle
- [x] **Grid view** — toggle between list and cover-art grid (Steam-style)
- [x] **Compact list mode** — denser rows with tiny thumbnail for large libraries
- [x] **Keyboard navigation** — arrow keys through game list, Space to launch
- [x] **Global search** — Ctrl+K command palette; search by name, tag, developer, notes
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

### Wine / Proton
- [x] **Global Wine/Proton config** — set Wine binary and prefix globally; used for all non-Windows games
- [x] **Per-game Wine toggle** — enable/disable Wine wrapper per game on Linux/macOS
- [x] **Per-game runner config** — override the global Wine/Proton settings for individual games
- [x] **Wine prefix manager** — create, list and delete prefixes from within the UI
- [x] **DXVK / VKD3D auto-install** — detect if DXVK is present in a prefix; offer to install it
- [x] **Winetricks integration** — run common verbs (vcrun2019, d3dx9, etc.) from a dropdown
- [x] **Proton-GE support** — auto-detect Proton-GE builds alongside official Steam Proton
- [x] **Lutris import** — read Lutris's game database to import already-configured Wine games

### Performance & Stability
- [x] **Virtual sidebar list** — windowed rendering for 1000+ game libraries
- [x] **kill_game on Linux/macOS** — SIGTERM with timeout fallback to SIGKILL

### Import & Interop
- [x] **Deep link protocol** — `libmaly://launch/<game-path>` URI scheme for external tools
- [x] **CLI interface** — `libmaly launch <name>` from a terminal
- [x] **Import from Playnite / GOG Galaxy** — read existing launchers' databases and merge into library
- [x] **Steam library import** — read installed Steam manifests, import detected games into LIBMALY, and attach Steam app IDs for launch integration

### Technical
- [x] **Log viewer** — in-app console showing recent Rust-side errors/warnings for debugging
- [x] **Crash reporter** — catch panics and offer to copy a report to clipboard
- [x] **Tray icon on macOS** — verify/fix `NSStatusItem` behaviour once macOS build is stable
- [x] **Portable mode** — store all data next to the exe instead of AppData (USB-stick installs)

### Community / Social (long-term)
- [x] **Review & rating** — personal 1–10 rating + short review stored locally; exportable

### Sync & Backup
- [x] **Cloud config sync** — export/import full library state (stats, metadata, notes, collections) as JSON
- [x] **Migration wizard** — "Move game folder" that updates all internal paths without losing stats/metadata
- [x] **Save-file backup** — detect common save directories and zip them on demand or on exit
- [x] **Backup retention policy** — rotate backups by daily/weekly/monthly rules and auto-prune old archives
- [x] **One-click restore wizard** — restore state from backup with overwrite preview before apply

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
