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
- Search, filter (All / Favourites / Hidden / F95 / DLsite / Unlinked) and sort (Name / Last Played / Playtime / **Custom drag-and-drop**)
- **Collections** — Steam-style named groups with custom colours; games can belong to multiple collections
- Hide / favourite / customise display name and artwork per game
- **Age / content warning gate** — optional blur + click-to-reveal for games tagged as adult content
- **RSS Feeds & News** — configurable RSS feed reader built-in, preconfigured with F95zone latest games
- Clear visual indicator badges for hidden games

### 🌐 Metadata
- Link any game to an **F95zone** thread or **DLsite** product page to fetch cover art, hero background, description, tags, developer, version, rating, release date and more
- F95zone login for restricted/adult content
- Metadata cached locally — no repeated network requests

### ⏱ Playtime Tracking
- Tracks total playtime, last-played date and last session duration per game
- Home view shows library stats and a "Recent Games" grid (last 60 days)

### 📸 In-Game Screenshots
- Press **F12** at any time while a game is running to capture its window (uses `WH_KEYBOARD_LL` on Windows — works even when Steam overlay has F12 reserved)
- **Auto-screenshot Timer** — optional background timer to automatically take a screenshot every N minutes while playing
- **Screenshot Tagging** — label screenshots ("Ending", "Bug", "Funny") and instantly filter the gallery to find specific moments
- Screenshots saved as PNG alongside a `tags.json`, browsable in-app with a lightbox

### 📝 Notes
- Per-game Markdown notes with live preview and auto-save

### 🔄 Game Updater
- Point at a new `.zip` archive or folder — LIBMALY diffs the contents, preserves detected save directories, backs them up, then applies the update in-place

### 🔔 Notifications & System Tray
- Closing the window minimises to tray instead of quitting
- **Startup with Windows** — option to launch minimised to the tray automatically on login
- **Panic Button (Boss Key)** — customizable global hotkey (e.g. F11) to instantly hide or forcibly close the active game, optionally mute system audio, and launch a fallback application.
- Tray menu shows the **5 most recently launched games** for quick-launch without opening the UI
- **Live Tray Tooltip** — hover the tray icon to see the currently-running game and live session duration
- **Session End Toast** — native system notification showing total playtime when a game exits
- **Background Update Checker** — quietly checks linked F95/DLsite pages for updates and shows a pulsing green badge in the sidebar
- **Built-in RSS Feed** — configurable "News & Updates" tab to keep track of new releases (pre-configured to F95zone Latest Alpha games)
- Left-click tray icon toggles window visibility
- Playtime timer continues counting while the app is hidden

### 🚀 Launch & Compatibility
- **Launch Arguments** — configure custom command-line flags to pass to any game's executable
- **Multiple Executables** — pin alternative launch targets (e.g., `config.exe` or mod managers) directly to the game's page
- **Wine / Proton (Linux & macOS)** — auto-detects system Wine and Steam Proton installations
- Global Wine/Proton settings (runner type, WINEPREFIX, `STEAM_COMPAT_DATA_PATH`) and a dynamic "Play via Wine" badge when active

---

## Why LIBMALY? (Comparison)

If you're looking for a local game library manager, here is how LIBMALY compares to the popular alternatives, specifically for managing DRM-free, F95zone, or DLsite collections:

| Feature | LIBMALY | Playnite | Heroic Games Launcher |
| :--- | :--- | :--- | :--- |
| **Primary Focus** | Standalone DRM-free, Visual Novels (F95/DLsite) | Mainstream stores (Steam, Epic, Xbox) | Epic, GOG, Amazon |
| **Performance** | **Ultra-lightweight** (Rust/Tauri) | Heavy (WPF / .NET) | Medium (Electron) |
| **Automatic Scraping** | Built-in F95zone & DLsite support | Needs 3rd-party community plugins | Only IGDB/Store API |
| **Update Management** | Built-in `.zip` archiver/updater + Save Backup | Manual / Plugins | Built-in for supported stores |
| **In-Game Screenshots** | Built-in (F12 hooking) + **Tagging** | Needs external tools (Steam/Fraps) | Needs external tools |
| **Time Tracking** | Native + **Steam Playtime Import** | Native | Native |
| **Cross-Platform** | Windows, Linux, macOS | Windows only | Windows, Linux, macOS |
| **Login Gates** | Direct F95/DLsite login to bypass age gates | Plugin dependant | N/A for F95/DLsite |

**The TL;DR:** If you primarily play Steam games, use Playnite. If you play Epic/GOG games on Linux, use Heroic. If you have a large folder of unmanaged, standalone indie games, downloaded zips, or visual novels that you want to track, update, and grab metadata for seamlessly — use **LIBMALY**.

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
