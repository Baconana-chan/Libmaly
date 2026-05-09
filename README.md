# LIBMALY

Local game library manager built with **Tauri 2 + Preact/TSX + Rust**.

LIBMALY is focused on unmanaged/standalone games (including F95zone and DLsite): scan folders, launch, track playtime, capture screenshots, keep notes, and manage Wine/Proton on Linux/macOS.

The README tracks the current desktop line, including the 1.8.x / 1.9.x feature set and the 1.10.0 development work listed under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).

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
- Settings dashboard with profile, vault, sync, integrations, maintenance, plugin, and API surfaces
- Global notes panel in the sidebar
- Custom CSS / user styles support
- Advanced backdrop FX based on cover art colors
- Developer grouping filter (`By Developer`)
- NSFW blur/reveal gate
- Light / Dark / OLED themes + accent color
- Theme scheduler (manual / OS / time-based)
- Theme marketplace/gallery + custom theme background images
- Back/Forward navigation history
- Migration wizard: move game folders without losing local data
- Quick side panel on game pages for notes, tracker, and media

### Metadata
- Link games to F95zone/DLsite/VNDB/MangaGamer/Johren/FAKKU
- Add custom metadata scrapers via JSON templates (selectors / regex / JS hooks)
- Install JS metadata-source plugins with custom `fetchMetadata(url, html)` logic
- Aggregate metadata from multiple sources into one merged record
- Metadata source snapshots, source badges, relation links, and source-priority post-processing rules
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
- Provider-aware install/open actions for local, placeholder, and external-launcher games
- Deep links:
  - `libmaly://launch/<game-path>`
  - `libmaly://launch-name/<name>`
- CLI launch:
  - `libmaly launch <name>`
  - `libmaly quick-launch-exe <path>`
  - `libmaly quick-install-zip <path>`
- Global/per-game executable override and pinned executables
- Remote install flow for supported external launchers
- Tray integration + startup in tray
- Optional Windows Explorer context-menu actions for launching `.exe` files and installing `.zip` archives through Libmaly

### Tracking & Notes
- Session tracking (total time, last played/session, launch count)
- Timeline + per-session notes
- Markdown game notes
- Steam playtime import
- All-time stats view + weekly activity widgets
- Activity heatmaps + year-in-review summary
- Productivity correlation heuristics for session patterns
- Session timeline explorer + tag/developer/engine/collection trend charts
- Completion statuses
- Personal rating/review (multiple rating scales + category ratings)
- Global notes, per-game achievements/checklists, and overlay-editable notes

### Screenshots
- In-game gallery with tags + ZIP export
- Manual screenshot command
- Windows capture path + non-Windows global hotkey flow
- Auto-screenshot interval
- Screenshot annotation before save
- Screenshot comparison tool with synchronized zoom and difference overlay
- In-game screenshot toast/history strip
- Instant Replay clips with GIF export, optional MP4 export, F9 save hotkey, and auto-highlight detection

### Diagnostics
- In-app Rust Log Viewer (level filter + export + copy diagnostics JSON)
- Crash reporter modal with copyable report
- Recent Rust log buffer + panic report persistence
- Issue link in diagnostics UI: https://github.com/Baconana-chan/Libmaly/issues
- Consistency tests for state, metadata, notes, collections, storage keys, and JSON validity
- Scraper, sync, permissions, Wine/Proton media, and release-candidate diagnostics surfaces

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
- Per-game media diagnostics, launch-time warnings, dry-run previews, post-install verification, and compatibility presets
- DXVK/Proton shader cache import/export and warmup hints

### Compatibility Helpers
- MUGEN/Ikemen GO auto-detection from executable names and characteristic data files
- Windows-only single-core CPU affinity toggle for unstable legacy games
- Large Address Aware read/toggle action with automatic `*.exe.laa.bak` safety backup
- dgVoodoo2 wrapper copy/remove actions for D3D/DDraw compatibility fixes
- Per-game compatibility sections in customisation modals when a known engine is detected

### Import & Interop
- Playnite import
- GOG Galaxy import
- Deep link + CLI launch integration for external tools
- Steam installed-library import, Steam Web API owned-library import, uninstalled placeholders, install triggers, and playtime sync
- Epic via Legendary import/launch/install flow plus EOS SDK integration for ownership and achievements
- itch.io Butler browsing, install, update, and cave tracking
- EA App / Ubisoft Connect / Rockstar protocol-store import
- GameJolt & Battle.net experimental manifest import
- RetroArch/emulator profile import for ROM targets
- SteamGridDB artwork sync for covers, heroes, logos, and icons

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

### In-Game Overlay
- Full-screen Shift+Tab overlay with passive/active cursor modes
- Live session timer, version/update badges, notes, goals, captures, alerts, and telemetry
- Editable Markdown notes directly inside the overlay
- Floating in-game browser window for guides, search, F95zone, DLsite, VNDB, Google, Wikipedia, and YouTube
- System monitor widget with CPU/RAM/GPU telemetry
- API-injected overlay notifications and HTML widgets

### Social & Connectivity
- Discord Social SDK integration with Rich Presence, idle presence, join secrets, cover art, and diagnostics
- Peer-to-peer Activity Pulse with local-network broadcast and optional encrypted relay
- Relay feature negotiation for official or self-hosted Libmaly-compatible relays
- Friend activity, multi-provider identity linking, and portable social identity export/import
- Encrypted P2P chat backed by locally stored conversations
- Optional anonymized global trending
- Decentralized sharing to Nostr and ActivityPub/Mastodon

### Plugins & Extensions
- Install plugin ZIP archives containing `manifest.json` and declared entrypoints
- Enable, disable, and uninstall plugins with cleanup
- Metadata-source plugins are resolved alongside built-in providers
- UI-panel plugins render inside Settings using sandboxed iframe panels and `postMessage`
- Manifest fields cover id, name, version, author, kind, URL patterns, panel title/icon, and entrypoint

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) |
| Frontend | Preact + TypeScript + Vite |
| UI / styling | Tailwind CSS 4 + custom CSS variables |
| Desktop integrations | Tauri plugins for dialog, deep links, notifications, autostart, opener, CLI, global shortcuts |
| Backend | Rust 2021 |
| Networking / scraping | `reqwest`, `scraper`, `regex`, `axum` local API |
| Storage / sync | Versioned JSON state store, snapshots, sync backends, OS credential vault via `keyring` |
| Extensibility | JSON templates, JS metadata plugins via `boa_engine`, UI-panel plugins, REST/WebSocket API, TypeScript SDK |
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
│   ├── gameOverlay.tsx
│   ├── screenshotOverlay.tsx
│   ├── components/
│   │   ├── views/          # Home / Feed / Stats screens
│   │   ├── game/           # GameDetail and game-specific UI
│   │   ├── modals/         # Settings, diagnostics, sync, update, save transfer
│   │   └── common/         # shared UI pieces such as overlays
│   ├── core/               # platform-agnostic data logic shared by future surfaces
│   ├── hooks/              # frontend hooks for app state and UI behaviour
│   ├── i18n/               # translations and custom language loading
│   ├── lib/                # Tauri invoke wrappers and desktop-specific adapters
│   ├── types/              # shared TypeScript app types
│   └── utils/              # smaller app-side utilities
├── sdk/
│   ├── libmaly-sdk.ts      # TypeScript REST/WebSocket client
│   ├── DOCS.md             # local API and SDK reference
│   └── examples/           # Node/browser integration examples
├── src-tauri/
│   ├── src/
│   │   ├── api_server.rs   # loopback REST/WebSocket API
│   │   ├── lib.rs          # Tauri commands, state/reliability helpers, app lifecycle
│   │   ├── metadata.rs     # built-in metadata fetchers + scraper health
│   │   ├── custom_metadata.rs
│   │   ├── plugin_manager.rs
│   │   ├── sync.rs         # provider-agnostic sync backends
│   │   ├── vault.rs        # OS credential vault integration
│   │   ├── save_transfer.rs
│   │   ├── screenshot.rs
│   │   ├── replay.rs
│   │   ├── eos.rs
│   │   ├── discord.rs
│   │   ├── pulse.rs
│   │   ├── p2p_chat.rs
│   │   ├── decentralized_share.rs
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
- Social/private keys and relay credentials are stored locally or in the OS credential vault depending on sensitivity.
- Portable mode: state, logs, screenshots, cookies, snapshots, and backups are stored next to the executable when `portable.mode` is present.
- Cloud sync and auto-backup are opt-in; the app remains usable offline without a required account.
- Social publishing, global trending, relay activity, Discord presence, and decentralized sharing are opt-in surfaces.

## Third-Party Integration

Libmaly exposes an optional local **REST + WebSocket API** so fan-made tools, dashboards, and scripts can read the library, control game launches, inject overlay widgets, and subscribe to real-time events.

- **Enable:** Settings → 🌐 API → toggle on, copy the bearer token
- **SDK:** [`sdk/libmaly-sdk.ts`](sdk/libmaly-sdk.ts) — TypeScript client for Node.js ≥ 22 and browsers
- **Examples:** [`sdk/examples/`](sdk/examples/) — 6 annotated scripts + a zero-install HTML dashboard
- **Full documentation:** [sdk/DOCS.md](sdk/DOCS.md)

## Roadmap

See [TODO.md](TODO.md) for the active backlog and [ROADMAP_ORDERED.md](ROADMAP_ORDERED.md) for the dependency-ordered roadmap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
