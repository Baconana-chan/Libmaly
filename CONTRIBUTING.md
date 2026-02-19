# Contributing to LIBMALY

Thank you for your interest in contributing! This document explains how to set up a development environment, the conventions used in the codebase, and the process for submitting changes.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Workflow](#development-workflow)
3. [Project Conventions](#project-conventions)
4. [Submitting a Pull Request](#submitting-a-pull-request)
5. [Reporting Bugs](#reporting-bugs)
6. [Suggesting Features](#suggesting-features)

---

## Getting Started

### Prerequisites

- **Rust** stable toolchain — install via [rustup](https://rustup.rs)
- **Bun** — install via [bun.sh](https://bun.sh) (or use Node.js 20+ with npm/yarn)
- **Tauri system dependencies** for your OS — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

### Fork & clone

```bash
git clone https://github.com/yourname/libmaly.git
cd libmaly
bun install
```

### Run the dev server

```bash
bun tauri dev
```

This starts the Vite dev server and the Tauri window simultaneously with hot-reload for the frontend and automatic Rust recompilation on save.

---

## Development Workflow

### Branches

| Branch | Purpose |
|---|---|
| `main` | Stable, releasable code |
| `dev` | Integration branch for new features |
| `feature/<name>` | Individual feature branches, branched from `dev` |
| `fix/<name>` | Bug-fix branches |

Always branch from `dev` for new work. Target `dev` in your pull request.

### Type-checking (frontend)

```bash
bun run tsc --noEmit
```

Run this before opening a PR. The CI will also run it.

### Rust compilation check

```bash
cd src-tauri
cargo check
cargo clippy -- -D warnings
```

Address all `clippy` warnings before submitting. The project uses `#[allow(...)]` sparingly and with a comment explaining why.

### Formatting

**Rust** — `cargo fmt`  
**TypeScript/TSX** — the project uses the VS Code default formatter (Prettier-compatible). Run it on save or manually before committing.

---

## Project Conventions

### Rust (`src-tauri/src/`)

- All Tauri commands are `#[tauri::command]` functions in `lib.rs`; domain logic lives in sub-modules (`metadata.rs`, `screenshot.rs`, `updater.rs`)
- Platform-specific code uses `#[cfg(windows)]` / `#[cfg(target_os = "linux")]` / `#[cfg(target_os = "macos")]` — avoid `std::env::consts::OS` strings at runtime for platform branching
- Use `Result<T, String>` as the return type for Tauri commands; map errors to human-readable strings with `.map_err(|e| e.to_string())`
- Long-running operations (game launch, metadata fetch) must be spawned on a background thread or inside `tokio::spawn` — never block the command handler
- Module layout: one file per concern; keep `lib.rs` as an orchestrator, not a dumping ground

### TypeScript / React (`src/`)

- The entire frontend lives in `src/App.tsx` — single-file architecture, components defined in order (small helpers → modals → major views → `App`)
- State that needs to survive app restarts goes through `loadCache` / `saveCache` (`localStorage`). Every persistent key is a `const SK_*` at the top of the file
- Style everything inline or with Tailwind utilities — no separate CSS modules. The dark-blue Steam-inspired colour palette is `#1b2838` (background), `#2a475e` (panel), `#66c0f4` (accent)
- Keep components pure where possible; lift state to `App` only when two or more components need it
- Avoid `any` types. Use proper interfaces (see the `Game`, `GameMetadata`, `GameStats`, `LaunchConfig` etc. patterns already in the file)

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-game launch arguments support
fix: DLsite rating extracted from JSON blob instead of Vue template
refactor: move tray helpers into dedicated tray.rs module
docs: update README prerequisites section
```

Scope is optional but helpful: `feat(tray):`, `fix(metadata):`, `fix(screenshot):`.

---

## Submitting a Pull Request

1. **Open an issue first** for non-trivial changes so we can discuss the approach
2. Make sure `bun run tsc --noEmit` and `cargo check && cargo clippy -- -D warnings` both pass
3. Write a clear PR description: what changed, why, and how to test it
4. Reference any related issues with `Closes #N` or `Relates to #N`
5. Keep PRs focused — one logical change per PR; split unrelated fixes into separate PRs
6. Add or update inline comments for non-obvious code (especially in Rust `unsafe` blocks and platform-specific paths)

---

## Reporting Bugs

Open a GitHub issue with:

- **Environment**: OS + version, LIBMALY version or commit hash
- **Steps to reproduce** — minimal and specific
- **Expected behaviour**
- **Actual behaviour** — include any error messages or console output
- **Screenshots** if relevant

---

## Suggesting Features

Check [TODO.md](TODO.md) first — your idea may already be on the backlog.

If it is not, open an issue with the **enhancement** label. Describe:

- The problem it solves
- A rough idea of the implementation (frontend change, new Rust command, both?)
- Any trade-offs or edge cases you can think of

---

## Code of Conduct

Be respectful and constructive. Contributions of all skill levels are welcome.
