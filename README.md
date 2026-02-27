# LIBMALY

Local game library manager built with **Tauri 2 + Preact/TSX + Rust**.

LIBMALY is focused on unmanaged/standalone games (including F95zone and DLsite): scan folders, launch, track playtime, capture screenshots, keep notes, and manage Wine/Proton on Linux/macOS.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)
![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20Preact%20%2B%20Rust-orange)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### Library & UI
- Recursive scan + incremental re-scan by directory mtime
- Multiple library folders
- Search, sort, filters, custom ordering, collections
- Home / Feed / Stats views
- Developer grouping filter (`By Developer`)
- NSFW blur/reveal gate
- Light / Dark / OLED themes + accent color
- Theme scheduler (manual / OS / time-based)
- Back/Forward navigation history
- Migration wizard: move game folders without losing local data

### Metadata
- Link games to F95zone/DLsite/VNDB/MangaGamer/Johren/FAKKU
- Fetch title, version, developer/circle, tags, overview, media, and more
- F95/DLsite login support for age-gated pages
- FAKKU login support
- Batch metadata refresh
- Metadata diff + per-game version history timeline
- Wishlist support

### Launching
- Direct launch + per-game launch args
- Deep links:
  - `libmaly://launch/<game-path>`
  - `libmaly://launch-name/<name>`
- CLI launch:
  - `libmaly launch <name>`
- Global/per-game executable override and pinned executables
- Tray integration + startup in tray

### Tracking & Notes
- Session tracking (total time, last played/session, launch count)
- Timeline + per-session notes
- Markdown game notes
- Steam playtime import
- All-time stats view + weekly activity widgets
- Completion statuses
- Personal rating/review (multiple rating scales + category ratings)

### Screenshots
- In-game gallery with tags + ZIP export
- Manual screenshot command
- Windows capture path + non-Windows global hotkey flow
- Auto-screenshot interval
- Screenshot annotation before save

### Diagnostics
- In-app Rust Log Viewer (level filter + export + copy diagnostics JSON)
- Crash reporter modal with copyable report
- Recent Rust log buffer + panic report persistence
- Issue link in diagnostics UI: https://github.com/Baconana-chan/Libmaly/issues

### Wine / Proton (Linux & macOS)
- Auto-detect Wine, Steam Proton, and Proton-GE
- Global runner config (runner type/path + prefix path)
- Per-game runner override
- Prefix manager (list/create/delete)
- DXVK/VKD3D detection + one-click install
- Winetricks verb runner (e.g. `vcrun2019`, `d3dx9`)
- Lutris import (games + per-game runner/prefix mapping)

### Import & Interop
- Playnite import
- GOG Galaxy import
- Deep link + CLI launch integration for external tools

### Sync & Backup
- Cloud config export/import JSON (library state, stats, metadata, notes, collections, settings)
- Save-file backup (detect common save directories, zip on demand or on game exit)
- Portable mode (store data next to executable using `portable.mode` marker)

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| Frontend | Preact + TypeScript + Vite + Tailwind |
| Backend | Rust |
| Networking/scraping | `reqwest`, `scraper` |
| Packaging | Bun |

## Getting Started

### Prerequisites
- Rust stable
- Bun
- Tauri OS prerequisites: https://tauri.app/start/prerequisites/

### Development

```bash
bun install
bun tauri dev
```

### Build

```bash
bun tauri build
```

## Project Structure

```
libmaly/
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── views/          # HomeView / FeedView / StatsView
│   │   ├── game/           # GameDetail and related UI
│   │   ├── modals/         # AppUpdate / Diagnostics and others
│   │   └── common/
│   └── lib/                # frontend helpers (scanner merge, etc.)
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # tauri commands + app lifecycle
│   │   ├── metadata.rs
│   │   ├── screenshot.rs
│   │   └── updater.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── TODO.md
├── CONTRIBUTING.md
└── README.md
```

## Data & Privacy

- Local-first app: no mandatory cloud, no telemetry requirement in default flow.
- Default mode: app state is stored in local WebView storage; Rust-side files in app data directory.
- Portable mode: state/logs/screenshots/cookies/backups are stored next to the executable (`libmaly-data`).

## Roadmap

See [TODO.md](TODO.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
