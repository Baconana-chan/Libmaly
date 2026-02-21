# LIBMALY — Ideas & Roadmap

## 🔥 High Priority

### Library & Scanning
- [x] **Multi-folder library** — scan multiple root directories instead of one; each shown as a separate section or merged
- [x] **Manual game add** — "Add Game" button to point directly at an .exe without scanning a folder
- [x] **Executable override** — per-game setting to choose a different .exe when multiple launchers exist in the same folder
- [x] **Sub-folder grouping** — detect when multiple games live under one parent dir and show them grouped (e.g. a "Games" folder with 50 subdirs)
- [x] **Rescan selected folder** — right-click a game → "Rescan folder" to pick up new files without re-scanning the whole library

### Game Detail
- [ ] **Age / content warning gate** — optional blur + click-to-reveal for games tagged as adult content
- [x] **Custom sort order** — drag-and-drop reordering of games in the sidebar (saved per collection too)
- [ ] **Multiple executables per game** — let the user pin 2–3 launch targets (e.g. game.exe + config.exe)
- [ ] **Launch arguments** — text field per game for command-line flags passed to the executable
- [x] **Launch count** — track number of sessions (not just total time); show "played 42 times"

---

## 🎨 UI / UX

- [ ] **Themes** — Dark (current), Light, OLED-black; accent colour picker
- [ ] **Sidebar width** — resizable via drag handle
- [ ] **Grid view** — toggle between list (current) and a cover-art grid (Steam-style)
- [ ] **Compact list mode** — denser rows with tiny thumbnail, for large libraries
- [ ] **Keyboard navigation** — arrow keys to move through game list, Enter to select, Space to launch
- [ ] **Global search** — Ctrl+K command palette; search by name, tag, developer, notes content
- [ ] **Sidebar badge** — show total hidden count next to "Hidden" filter chip
- [ ] **Animated cover placeholder** — shimmer skeleton while metadata is loading
- [ ] **Scroll-to-selected** — sidebar scrolls to keep the selected game visible
- [ ] **Back / Forward navigation** — browser-style history for jumping between views

---

## 📊 Stats & Tracking

- [ ] **Play history log** — timestamped session log per game (date, duration); show as a timeline
- [ ] **Milestones** — "10 hours played" badges, shown on the detail page
- [ ] **Weekly / monthly chart** — bar chart of playtime over time (per game or total library)
- [ ] **Most played this week** — widget on HomeView alongside recent games
- [ ] **Import playtime from Steam** — read `localconfig.vdf` to pre-fill hours for recognised titles
- [ ] **Session notes** — optional short note per play session ("finished chapter 3", "found secret ending")

---

## 🌐 Metadata

- [ ] **Auto-link by name** — fuzzy-match game folder name against F95 / DLsite and suggest a link without manual URL entry
- [ ] **Batch metadata refresh** — "Update all linked games" button that re-fetches all entries in the background
- [ ] **VNDB support** — fetch metadata from vndb.org for visual novels (cover, tags, relations, release date)
- [ ] **MangaGamer / Johren / Fakku support** — additional store scrapers
- [ ] **Metadata diff view** — when re-fetching, show "changed: version 0.9 → 1.0" before applying
- [ ] **Cache expiry** — auto-re-fetch metadata older than N days (configurable)
- [ ] **Developer grouping** — sidebar section "By Developer"; click to filter all games from one circle/studio

---

## ☁️ Sync & Backup

- [ ] **Cloud config sync** — export/import the full library state (stats, metadata, notes, collections) as a single JSON file
- [ ] **Google Drive / Dropbox sync** — optional auto-backup of library JSON to a cloud folder
- [ ] **Save-file backup** — detect common save directories and zip them on demand or on exit
- [ ] **Save-file cloud sync** — upload save zips to a configured folder (Google Drive, local NAS, etc.)
- [ ] **Migration wizard** — "Move game folder" that updates all internal paths without losing stats/metadata

---

## 🔔 Notifications & Tray

- [ ] **Update checker** — optional notification when a linked F95/DLsite game has a new version posted
- [ ] **New version badge** — show a "!" indicator in sidebar next to games with available updates
- [ ] **Session end toast** — system notification when a game exits: "Played Foo for 1h 23m"
- [ ] **Tray tooltip** — show currently-running game name + live session duration in tray tooltip
- [ ] **Startup with Windows** — option to launch minimized to tray on Windows login

---

## 🖼️ Screenshots

- [ ] **Screenshot annotation** — simple draw/text overlay tool before saving
- [ ] **Auto-screenshot on launch** — optional periodic screenshot (every N minutes) while a game runs
- [ ] **Screenshot tagging** — tag screenshots with free-form labels ("ending", "bug", "funny moment")
- [ ] **Export gallery** — zip all screenshots for a game and save/share them
- [ ] **Non-Windows screenshot** — implement X11/Wayland window capture for Linux

---

## 🍷 Wine / Proton (Linux & macOS)

- [ ] **Per-game runner config** — override the global Wine/Proton config for individual games
- [ ] **Wine prefix manager** — create, list and delete prefixes from within the UI
- [ ] **DXVK / VKD3D auto-install** — detect if DXVK is present in a prefix; offer to install it
- [ ] **Winetricks integration** — run common winetricks verbs (vcrun2019, d3dx9, etc.) from a dropdown
- [ ] **Proton-GE support** — auto-detect Proton-GE builds alongside official Steam Proton
- [ ] **Lutris import** — read Lutris's game database to import already-configured Wine games

---

## 🛠️ Developer / Technical

- [ ] **Plugin system** — allow JS/WASM plugins to add metadata sources or UI panels
- [ ] **REST API mode** — optional local HTTP server so external scripts can query/control the library
- [ ] **CLI interface** — `libmaly launch <name>` from a terminal
- [ ] **Deep link protocol** — `libmaly://launch/<game-path>` URI scheme for launching from external tools
- [ ] **Portable mode** — store all data next to the exe instead of AppData (flag for USB-stick installs)
- [ ] **Log viewer** — in-app console showing recent Rust-side errors/warnings for debugging
- [ ] **Crash reporter** — catch panics and offer to copy a report to clipboard
- [ ] **i18n / l10n** — internationalisation framework; provide RU, JA, ZH translations

---

## 🤝 Community / Social (long-term)

- [ ] **Friend activity** — optional peer-to-peer "what are friends playing" via a relay server
- [ ] **Public wishlist** — export a sharable HTML page of your library/wishlist
- [ ] **Review & rating** — personal 1–10 rating + short review stored locally; exportable
- [ ] **Achievement tracker** — manual checklist per game for tracking in-game achievements or routes

---

## 🐛 Known Limitations to Address

- [/] Screenshot support on Linux/macOS (Manual capture works; global hotkey pending)
- [ ] DLsite pages behind age-gate require manual cookies / session (no login flow yet)
- [x] Very large libraries (1000+ games) may cause slow initial renders — virtualise the sidebar list
- [x] `kill_game` on Linux/macOS sends SIGTERM first with a timeout fallback
- [ ] Tray icon on macOS requires `NSStatusItem` — test and fix if needed after macOS build is set up
