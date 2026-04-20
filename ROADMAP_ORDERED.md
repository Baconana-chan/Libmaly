# 🗺️ Libmaly Ordered Roadmap (Planned)

This roadmap organizes remaining tasks from easiest ("Quick Wins") to most difficult ("Epic Projects"). Tasks are grouped to show dependencies, where implementing one feature simplifies the work for the next.

---

## 🟢 Phase 1: Quick Wins & Polish (Low Complexity)
*Tasks that primarily involve UI additions or using existing data.*

### 📊 Stats & Visuals
- [x] **Activity Heatmaps** — GitHub-style 365-day play activity grid in the Stats view.
- [x] **Year-in-Review generator** — Automated summary card of the year's habits.
- [x] **Productivity Correlation** — Optional "Time well spent" vs "Binge" detection.
- [x] **Advanced Backdrop FX** — Dynamic blur/glassmorphism based on cover art colors.

### ⚙️ UI & Core
- [x] **Local-only "Ghost" mode** — Disable outbound checks for high-privacy games (per-game/profile).
- [x] **Custom CSS / User Styles** — Allow power users to inject custom CSS overrides.
- [x] **Data consistency tests** — Integration scenarios for scan/launch/crash/recovery.

> [!TIP]
> **Priority:** Implement **Ghost Mode** early to handle privacy-conscious users before expanding storefront connectors.

---

## 🟡 Phase 2: Enhanced Reliability & Sync (Medium Complexity)
*Building on top of the established versioned state store.*

### ☁️ Cloud & Backup
- [x] **Provider-agnostic library sync** — Add WebDAV, Nextcloud, S3/Git backends for state sync.
- [x] **Google Drive / Dropbox auto-backup** — Optional periodic upload of library state.
- [x] **Save-file cloud sync** — Upload save zips to configured cloud folders.
- [x] **Cloud sync conflict resolver** — UI and logic for 3-way merge (Local/Remote/Base).

### 🛠️ Technical Foundations
- [x] **OAuth & API Vault** — Secure centralized manager for storefront tokens/cookies.
- [ ] **REST/WebSocket API Mode** — Internal API for state access and remote control (foundation for SDK).
- [ ] **SDK / Reference implementation** — Boilerplate for third-party tools.

> [!IMPORTANT]
> **Status:** The **OAuth & API Vault** is complete; remaining API-mode and SDK work can build on the existing credential layer.

---

## 🟠 Phase 3: Storefront & Social (High Complexity)
*Requires complex network interactions and external integrations.*

### 🛒 Storefront Integrations
- [x] **Enhanced Steam Integration** — List owned titles via Web API / profile-ID resolution and trigger `steam://install/<id>` for uninstalled imports.
- [x] **Epic Games Store** — Cloud library listing and Legendary-style integration.
- [x] **itch.io Butler Integration** — Direct purchase management and auto-updates.
- [x] **Cross-Store Ownership Grouping** — Merge multiple entries for the same game into one card.

### 📡 Connectivity (Social/P2P)
- [ ] **Peer-to-Peer Activity "Pulse"** — Local-network broadcast of active games.
- [ ] **Encrypted P2P Chat** — Secure messaging for coordinating multiplayer.
- [ ] **Multi-protocol social linking** — Bridge activity from Discord, Steam, and Libmaly-Relay.

---

## 🔴 Phase 4: The Overlay & Streaming (Very High Complexity)
*Deep system integration, input hooking, and performance-heavy features.*

### 🕹️ Immersive Overlay
- [ ] **Global Hotkey & Input Hooking** — Reliable Rust keyboard hooks for trigger.
- [ ] **Clock & Session Timer Widget** — Simple first widget for the overlay.
- [ ] **Full-screen Dashboard (Shift+Tab)** — High-level navigation hub.
- [ ] **Overlay Workspace & Widgets** (System Monitor, Web Browser, Note Editor).

### 🎮 Controller & Remote Play
- [ ] **Controller profile schema** — Bindings, curves, and macro definitions.
- [ ] **Virtual input backend** — Rust abstraction for input injection.
- [ ] **Universal controller translation layer** — Virtual XInput/SDL pad for games.
- [ ] **Remote Play Host & Guest Flow** — Video/Audio streaming and input relay.

> [!TIP]
> **Priority:** Implement **Global Hotkey & Input Hooking** and the **Controller Profile Schema** first; these are the anchors for all other overlay and controller features.

---

## 🚀 Strategy & Distribution (Ongoing)
- [ ] **Release on itch.io** — Launch page + Butler automation.
- [ ] **Release on Epic Games Store** — Self-publishing + SDK integration.
- [ ] **Release on Steam** — Evaluate stance and prepare submission.
