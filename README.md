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
- Layout presets manager + customizable sidebar sections
- Custom CSS / user styles support
- Advanced backdrop FX based on cover art colors
- Developer grouping filter (`By Developer`)
- NSFW blur/reveal gate
- Light / Dark / OLED themes + accent color
- Theme scheduler (manual / OS / time-based)
- Back/Forward navigation history
- Migration wizard: move game folders without losing local data

### Metadata
- Link games to F95zone/DLsite/VNDB/MangaGamer/Johren/FAKKU
- Add custom metadata scrapers via JSON templates (selectors / regex / JS hooks)
- Aggregate metadata from multiple sources into one merged record
- Fetch title, version, developer/circle, tags, overview, media, and more
- F95/DLsite login support for age-gated pages
- FAKKU login support
- Batch metadata refresh
- Ghost mode for local-only/privacy-sensitive games
- Third-party metadata providers (IGDB / RAWG / MobyGames)
- Metadata diff + per-game version history timeline
- Wishlist support
- Scraper health diagnostics + broken-source validation

### Launching
- Direct launch + per-game launch args
- Cross-store ownership grouping + launch-via-provider selection
- Deep links:
  - `libmaly://launch/<game-path>`
  - `libmaly://launch-name/<name>`
- CLI launch:
  - `libmaly launch <name>`
- Global/per-game executable override and pinned executables
- Remote install flow for supported external launchers
- Tray integration + startup in tray

### Tracking & Notes
- Session tracking (total time, last played/session, launch count)
- Timeline + per-session notes
- Markdown game notes
- Steam playtime import
- All-time stats view + weekly activity widgets
- Activity heatmaps + year-in-review summary
- Productivity correlation heuristics for session patterns
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
- Media playback diagnostics — detect missing Media Foundation / Quartz / WMP-style components in a prefix
- One-click install of recommended media fix verbs for a prefix
- Per-game media diagnostics, launch-time warnings, and compatibility presets are planned in the roadmap (`TODO.md`)

### Import & Interop
- Playnite import
- GOG Galaxy import
- Deep link + CLI launch integration for external tools

### Sync & Backup
- Cloud config export/import JSON (library state, stats, metadata, notes, collections, settings)
- Provider-agnostic sync backends (Google Drive / Dropbox / WebDAV / Nextcloud / S3 / Git)
- 3-way local/remote/base conflict resolver
- Portable mode (store data next to executable using `portable.mode` marker)
- Save-file backup on game exit (optional)
- Save-file cloud sync uploads for configured providers
- Backup retention policy (daily/weekly/monthly pruning)
- State snapshots before risky operations + manual restore wizard
- Crash-safe writes with atomic temp-and-rename flow
- Auto-recovery mode after crash with deferred background work
- OAuth & API vault for provider/storefront credentials
- Release reliability checks in Settings for crash recovery, auto-heal, conflict resolution, metadata fallback, and backup/restore
- Google Drive and Dropbox periodic library-state auto-backup are supported via the Sync settings tab

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| Frontend | Preact + TypeScript + Vite |
| UI / styling | Tailwind CSS 4 + custom CSS variables |
| Desktop integrations | Tauri plugins for dialog, deep links, notifications, autostart, opener, CLI, global shortcuts |
| Backend | Rust 2021 |
| Networking / scraping | `reqwest`, `scraper`, `regex` |
| Storage / sync | Versioned JSON state store, snapshots, sync backends, OS credential vault via `keyring` |
| Extensibility | JSON-based custom metadata templates with optional JS hooks via `boa_engine` |
| Tooling | Bun or npm for frontend workflows, Cargo for Rust builds |

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
├── public/                  # static assets, mirrored public changelog
├── src/
│   ├── App.tsx
│   ├── screenshotOverlay.tsx
│   ├── components/
│   │   ├── views/          # Home / Feed / Stats screens
│   │   ├── game/           # GameDetail and game-specific UI
│   │   ├── modals/         # Settings, diagnostics, sync, update, save transfer
│   │   └── common/         # shared UI pieces such as overlays
│   ├── i18n/               # translations and custom language loading
│   ├── lib/                # storage, sync, scanner, helpers, app constants
│   └── utils/              # smaller app-side utilities
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs          # Tauri commands, state/reliability helpers, app lifecycle
│   │   ├── metadata.rs     # built-in metadata fetchers + scraper health
│   │   ├── custom_metadata.rs
│   │   ├── sync.rs         # provider-agnostic sync backends
│   │   ├── vault.rs        # OS credential vault integration
│   │   ├── save_transfer.rs
│   │   ├── screenshot.rs
│   │   ├── discord.rs
│   │   └── updater.rs
│   ├── capabilities/       # Tauri capability manifests
│   ├── Cargo.toml
│   └── tauri.conf.json
├── third_party/             # bundled third-party SDKs/assets
├── TODO.md
├── ROADMAP_ORDERED.md
├── CONTRIBUTING.md
└── README.md
```

## Data & Privacy

- Local-first app: no mandatory cloud, no telemetry requirement in default flow.
- Default mode: app state is stored in a versioned Rust-side JSON state store inside the app data directory, with snapshots/backups kept alongside other app-managed files.
- Sensitive credentials (sync tokens, storefront secrets, API keys) are stored in the OS credential vault instead of plaintext config files.
- Portable mode: state, logs, screenshots, cookies, snapshots, and backups are stored next to the executable when `portable.mode` is present.
- Cloud sync and auto-backup are opt-in; the app remains usable offline without a required account.

## Roadmap

See [TODO.md](TODO.md) for the active backlog and [ROADMAP_ORDERED.md](ROADMAP_ORDERED.md) for the dependency-ordered roadmap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
