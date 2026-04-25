# 📱 Libmaly Mobile TODO

This backlog tracks a separate Android-first mobile client for Libmaly.

The working assumption is that the mobile app should be treated as a mostly separate product surface rather than a thin port of the desktop Tauri UI. Tauri 2 is the preferred foundation so Libmaly can keep sharing Rust/domain logic where it is practical, while still allowing a dedicated Android-first UI and packaging flow.

Current product direction, based on the latest scope discussion:
- metadata-first companion app for browsing the same library/state as desktop
- maps viewer for the future desktop/mobile map feature
- optional Android launch surface for locally known `APK` / `AAB` entries where this is practical
- Remote Play as a later-stage feature, not part of the first mobile milestone
- Android-first delivery; iOS is explicitly not a near-term target

---

## 🎯 Product Direction

- [ ] **Lock mobile scope as companion-first** — prioritise metadata browsing, maps, and low-friction second-screen usage before any larger standalone-mobile ambitions
- [ ] **Commit to Tauri 2 mobile** — use Tauri 2 as the default mobile foundation unless a concrete Android limitation forces a fallback later
- [ ] **Lock Android-first strategy** — optimise scope, testing, packaging, and release flow for Android before considering any iOS work
- [ ] **Define shared vs separate modules** — document which parts can stay common with desktop (sync schema, metadata contracts, import/export formats) and which must diverge
- [ ] **Set packaging boundary** — keep APK/AAB artifacts fully out of the desktop build pipeline and maintain separate Android release jobs

---

## 🧱 Foundation

- [ ] **Create separate Android app shell** — initialize a dedicated Tauri mobile surface instead of adding phone screens directly into the current desktop frontend
- [ ] **Establish mobile design system** — spacing, typography, cards, bottom navigation, touch targets, safe-area behavior, and tablet breakpoints
- [ ] **Define Android-first navigation model** — library, search, collections, stats, sync, and settings flows designed for portrait-first use on phones/tablets
- [ ] **Set up environment/config handling** — API endpoints, relay URLs, feature flags, and debug/release config for desktop vs Android targets
- [ ] **Decide offline storage layer** — local cache/database for library snapshots, notes, covers, and sync state

---

## 🔄 Shared Data & Sync

- [ ] **Reuse Libmaly state formats where possible** — keep imports/exports compatible with desktop profiles and backups
- [ ] **Mobile-safe sync client** — support library sync, backup restore, and conflict handling with intermittent connectivity in mind
- [ ] **Account/token strategy** — decide how mobile authenticates to cloud backends without copying desktop-only vault assumptions blindly
- [ ] **Background sync policy** — define what can run in background on Android and what must stay manual
- [ ] **Schema compatibility tests** — verify desktop and mobile can exchange state snapshots without corruption or silent field loss

---

## 📚 Core Mobile MVP

- [ ] **Library browsing** — searchable game list/grid optimized for phones and tablets, focused first on synced desktop library content
- [ ] **Game detail screen** — metadata, screenshots, notes, achievements, tags, links, and update status in a mobile layout
- [ ] **Collections and filters** — quick filtering by status, source, tag, developer, and collection
- [ ] **Play history and stats summary** — mobile-friendly summary cards instead of desktop-dense charts by default
- [ ] **Notes and achievements editing** — touch-friendly editing for the fields most likely to be updated away from the PC
- [ ] **Cover/media caching** — lazy loading and storage limits for screenshots/covers on limited devices
- [ ] **Maps viewer** — show supported game maps in a dedicated mobile-friendly reader with zoom, layers, and external-provider attribution
- [ ] **Cross-device metadata parity** — make sure the same linked metadata, screenshots, and notes are visible on desktop and mobile without surprise field loss

---

## 🤖 Android Game Launching

- [ ] **APK/AAB library model** — decide how Android-native titles appear in the shared library without polluting desktop-specific launcher logic
- [ ] **APK install / launch flow** — support launching or handing off to install/open flows for Android packages where platform rules allow it
- [ ] **Android package metadata bridge** — map package IDs, icons, version info, and install state into Libmaly entries
- [ ] **Desktop/mobile separation rules** — prevent Android-only launch targets from appearing as broken launch actions on desktop

---

## 🧭 Companion Features

- [ ] **Desktop companion mode** — use the phone as a second-screen companion for notes, achievements, metadata, and maps while a game runs on PC
- [ ] **Remote launch/control hooks** — trigger desktop actions through the planned API/WebSocket mode when available
- [ ] **Notification bridge** — optional alerts for finished backups, update availability, sync conflicts, and long-running tasks
- [ ] **Session companion widgets** — quick note capture, checklist toggles, and “currently playing” glance cards

---

## 📸 Mobile-Specific UX

- [ ] **Portrait-first layouts** — no desktop sidebar assumptions; bottom tabs and stacked detail sections first
- [ ] **Tablet adaptations** — wider split-view layouts for tablets without treating phones as shrunken desktop windows
- [ ] **Touch gestures** — swipe actions for favorite/hide/status changes where they improve speed without causing accidental edits
- [ ] **Media budget controls** — Wi-Fi-only downloads, cache limits, thumbnail quality controls, and reduced-data mode
- [ ] **Accessibility pass** — dynamic font scaling, contrast, screen-reader labels, and one-hand reachability review

---

## 🔐 Security & Privacy

- [ ] **Secure token storage on mobile** — platform-native secure storage instead of desktop vault assumptions
- [ ] **App lock / sensitive-content controls** — optional PIN/biometric gate and adult-content blur behavior adapted for mobile
- [ ] **Crash-safe local persistence** — avoid corrupting cached state on app suspend/kill/resume cycles
- [ ] **Telemetry/privacy policy for mobile** — define what is stored locally, what is synced, and what is never uploaded

---

## 🧪 Mobile QA & Release

- [ ] **Android device matrix** — define minimum supported Android versions and a realistic test device set
- [ ] **State migration tests** — backup/import/export compatibility across desktop and mobile versions
- [ ] **Small-screen QA pass** — verify critical flows on narrow portrait screens before feature growth
- [ ] **Play Store / sideload readiness** — app icons, screenshots, privacy labels, signing, Play Console metadata, and release checklist
- [ ] **Separate Android CI/CD** — independent mobile build/release workflow so APK/AAB outputs never bloat the desktop release pipeline

---

## 🎮 Remote Play (Later)

- [ ] **Remote Play companion roadmap** — define how mobile Remote Play fits after the metadata/maps companion app is stable
- [ ] **Touch-friendly Remote Play controls** — overlays for disconnect, bitrate, audio route, and controller/touch mode switching
- [ ] **Session handoff from desktop** — join an active desktop-hosted session from mobile without redoing full library sync first
- [ ] **Network quality diagnostics** — mobile-specific visibility into bitrate, latency, jitter, and reconnect state

---

## ✅ Non-Goals For The First Mobile Iteration

- [ ] **Do not port the desktop overlay** — overlay/input-hooking belongs to desktop-first architecture
- [ ] **Do not bundle emulator/desktop-specific binaries** — no Windows DLLs, NSIS/MSI concerns, or desktop packaging assumptions
- [ ] **Do not force one shared responsive UI for every platform** — prefer separate presentation layers over a compromised universal layout
- [ ] **Do not make Remote Play a launch blocker** — the first useful mobile release should exist before full streaming/control ambitions land
- [ ] **Do not target iOS in the first wave** — avoid Apple platform/signing/review complexity until the Android companion app proves its value