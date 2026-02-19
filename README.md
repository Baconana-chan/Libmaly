# LIBMALY

A personal game library manager built with **Tauri 2 + React/TSX + Tailwind CSS**.  
Designed for managing local game collections — with metadata from F95zone & DLsite, playtime tracking, in-game screenshots, collections, notes, and Wine/Proton support on Linux & macOS.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)
![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20React%20%2B%20Rust-orange)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

### 📚 Library
- Scan a local folder — finds all game executables recursively, filters out installers and crash handlers automatically
- **Incremental sync** — only re-checks directories whose modification time changed, so large libraries resync in milliseconds
- Search, filter (All / Favourites / Hidden / F95 / DLsite / Unlinked) and sort (Name / Last Played / Playtime)
- **Collections** — Steam-style named groups with custom colours; games can belong to multiple collections
- Hide / favourite / customise display name and artwork per game

### 🌐 Metadata
- Link any game to an **F95zone** thread or **DLsite** product page to fetch cover art, hero background, description, tags, developer, version, rating, release date and more
- F95zone login for restricted/adult content
- Metadata cached locally — no repeated network requests

### ⏱ Playtime Tracking
- Tracks total playtime, last-played date and last session duration per game
- Home view shows library stats and a "Recent Games" grid (last 60 days)

### 📸 In-Game Screenshots (Windows)
- Press **F12** at any time while a game is running to capture its window (uses `WH_KEYBOARD_LL` — works even when Steam overlay has F12 reserved)
- Screenshots saved as PNG, browsable in-app with a lightbox; "Open Folder" shortcut
- Manual capture button always available

### 📝 Notes
- Per-game Markdown notes with live preview and auto-save

### 🔄 Game Updater
- Point at a new `.zip` archive or folder — LIBMALY diffs the contents, preserves detected save directories, backs them up, then applies the update in-place

### 🖥 System Tray
- Closing the window minimises to tray instead of quitting
- Tray menu shows the **5 most recently launched games** for quick-launch without opening the UI
- Left-click tray icon toggles window visibility
- Playtime timer continues counting while the app is hidden

### 🍷 Wine / Proton (Linux & macOS)
- Auto-detects system Wine and all Steam Proton installations
- Global Wine/Proton settings with runner type (Wine / Proton / custom path), WINEPREFIX and `STEAM_COMPAT_DATA_PATH` support
- Play button shows "Play via Wine" badge when a runner is active

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| Frontend | React 18 (TSX), Tailwind CSS v4, Vite |
| Backend | Rust (stable) |
| Package manager | [Bun](https://bun.sh) |
| Metadata scraping | `reqwest` + `scraper` (HTML) |
| Screenshots | WinAPI GDI (`PrintWindow` + `GetDIBits`) |
| Image encoding | `image` crate (PNG) |
| Markdown | `marked` (JS) |

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs) stable toolchain (1.77+)
- [Bun](https://bun.sh) (or Node.js 20+)
- [Tauri CLI prerequisites](https://tauri.app/start/prerequisites/) for your OS
  - **Windows**: Microsoft C++ Build Tools or Visual Studio
  - **Linux**: `libwebkit2gtk-4.1-dev pkg-config libssl-dev libayatana-appindicator3-dev`
  - **macOS**: Xcode Command Line Tools

### Install & run (development)

```bash
git clone https://github.com/yourname/libmaly.git
cd libmaly
bun install
bun tauri dev
```

### Build (release)

```bash
bun tauri build
```

The compiled installer / AppImage / `.app` bundle will be under `src-tauri/target/release/bundle/`.

---

## Project Structure

```
libmaly/
├── src/                    # React frontend (TSX)
│   └── App.tsx             # All components, state and IPC calls
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # Core commands: scan, launch, tray, Wine/Proton
│   │   ├── metadata.rs     # F95zone & DLsite scrapers
│   │   ├── screenshot.rs   # F12 hook, GDI window capture, PNG save
│   │   └── updater.rs      # Game updater (diff + apply)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/
├── TODO.md                 # Feature backlog & ideas
├── CONTRIBUTING.md
└── README.md
```

---

## Data & Privacy

Everything is stored locally. No accounts, no telemetry, no cloud required.

| Data | Location |
|---|---|
| Library / metadata / stats | Browser `localStorage` inside the Tauri WebView |
| Screenshots | `%APPDATA%\libmaly\screenshots\` (Windows) |
| | `~/.local/share/libmaly/screenshots/` (Linux) |
| | `~/Library/Application Support/libmaly/screenshots/` (macOS) |

---

## Roadmap

See [TODO.md](TODO.md) for the full feature backlog and ideas.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE)
