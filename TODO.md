# LIBMALY — Ideas & Roadmap

---

## 🎨 UI / UX

- [x] **Themes** — Dark (current), Light, OLED-black; accent colour picker
- [x] **Theme scheduler** — auto-switch Light ↔ Dark based on time of day or OS setting
- [x] **Back / Forward navigation** — browser-style history for jumping between views

---

## 📊 Stats & Tracking



---

## 🌐 Metadata

- [ ] **VNDB support** — fetch metadata from vndb.org for visual novels (cover, tags, relations, release date)
- [ ] **MangaGamer / Johren / Fakku support** — additional store scrapers

---

## 🖼️ Screenshots

- [ ] **Screenshot annotation** — simple draw / text overlay before saving

---

## ☁️ Sync & Backup

- [ ] **Cloud config sync** — export/import full library state (stats, metadata, notes, collections) as JSON
- [ ] **Google Drive / Dropbox auto-backup** — optional periodic upload of library JSON to a cloud folder
- [ ] **Save-file backup** — detect common save directories and zip them on demand or on exit
- [ ] **Save-file cloud sync** — upload save zips to a configured folder (Google Drive, local NAS, etc.)
- [ ] **Migration wizard** — "Move game folder" that updates all internal paths without losing stats/metadata
- [ ] **Multiple library profiles** — separate profiles for different PCs or users; switchable from the tray

---

## 🍷 Wine / Proton (Linux & macOS)



---

## 📥 Import & Interop

- [ ] **Import from Playnite / GOG Galaxy** — read existing launchers' databases and merge into library

---

## 🛠️ Technical

- [ ] **Portable mode** — store all data next to the exe instead of AppData (USB-stick installs)
- [ ] **i18n / l10n** — internationalisation framework; provide RU, JA, ZH translations
- [ ] **Plugin system** — allow JS/WASM plugins to add metadata sources or UI panels
- [ ] **REST API mode** — optional local HTTP server so external scripts can query/control the library

---

## 🤝 Community / Social (long-term)

- [ ] **Review & rating** — personal 1–10 rating + short review stored locally; exportable
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

### Technical
- [x] **Log viewer** — in-app console showing recent Rust-side errors/warnings for debugging
- [x] **Crash reporter** — catch panics and offer to copy a report to clipboard
- [x] **Tray icon on macOS** — verify/fix `NSStatusItem` behaviour once macOS build is stable
