# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PLL Studio: a desktop (Tauri 2, macOS + Windows) and web app for controlling and studying the IDT/Renesas **8V97051** wideband Frac-N RF synthesizer and its **8V9705x EVB**. All engineering logic is Rust (`crates/pll-core`); the UI is React 19 + Tailwind 4 (`src/`). UI language: Russian; register/field names stay in English as in the datasheet.

## Commands

```bash
npm ci                         # first time
npm run app                    # desktop app, hot reload (Tauri dev; Vite on :1420)
make dev                       # web dev: pll-server :7878 + Vite :1420 (Vite proxies /api)
npm run web                    # build UI, run release pll-server on http://127.0.0.1:7878

cargo test -p pll-core         # model tests (registers, planner, loop, noise, sim, RPC)
npm run build                  # tsc --noEmit + vite build
make check                     # version status + build + tests + cargo check
cargo run -p pll-core --example probe -- 2.05e9   # CLI sanity probe of the models

python3 build_macos.py [--universal] [--with-server]   # .app + .dmg → release/vX.Y.Z/
.\build_windows.ps1 [-Bundles nsis|msi] [-WithServer]  # NSIS/MSI → release\vX.Y.Z\
```

## Versioning and releases

- Single source of truth: `config/version.json` (`app_info.version`, `release_date`, `last_updated`). Never edit versions by hand. Use `python3 tools/update_version.py status | bump patch|minor|major | sync [X.Y.Z]`. It updates `Cargo.toml` (`[workspace.package]`), `Cargo.lock`, `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, the README heading and `.github/ISSUE_TEMPLATE/bug.yml`.
- App identity (`name`, `author`, `license`, `repository`, `mirror`) also lives in `app_info`. The same script generates `crates/pll-core/src/about.rs`, synchronizes package/bundle metadata and LICENSE copyright, and checks identity drift. Do not edit generated about constants manually. `get_meta.app` supplies the reactive About screen; use Cmd/Ctrl+0, or 1–9 for the other screens in sidebar order. `open_url` validates HTTP(S) and opens the system browser; never interpolate a URL into shell source.
- `CHANGELOG.md` is hand-written (Keep a Changelog): `## [X.Y.Z] - YYYY-MM-DD`.
- Commit subjects: user-facing description, then `; bump to X.Y.Z` when the version changes.
- Build scripts refuse to build if `status` reports drift. Tag `vX.Y.Z` triggers `.github/workflows/release.yml` (tauri-action, draft release).

## Architecture

**One RPC for both runtimes.** `pll_core::Engine::handle(cmd, args) -> Result<Value>` (`crates/pll-core/src/api.rs`) is the whole backend API. Tauri exposes it as the `rpc` command (`src-tauri/src/lib.rs`), `pll-server` as `POST /api/rpc` → `{ok, data|error}`. The frontend calls `rpc()` from `src/lib/api.ts`, which picks the transport. Add features by adding an RPC command in `api.rs` and mirroring its types in `src/lib/types.ts`.

**pll-core modules**
- `regs.rs` — `FIELDS` table (exact bit positions from the datasheet, access, defaults, RU title/description, options, owning block, double-buffer flag), `defaults()` (datasheet power-on) vs `starter()` (working initial config: band-select clock in range, LD on, MUX=SDO, OUTA on). 12/16-bit FRAC/MOD/PHASE: value16 = field12 << 4 | ext4 (R7).
- `plan.rs` — `derive()` computes every derived quantity and the `issues` list (RU messages, `block` key for UI); `plan()` is an exact rational search (u128 mHz) over doubler/R/÷2/INT/FRAC/MOD.
- `loopfilter.rs` — impedance, open/closed loop, `design()` (datasheet method, E12/E24 snap), non-linear RK4 `transient()`.
- `noise.rs` — phase-noise contributions, jitter integration, spur estimates, virtual `spectrum()`.
- `sim.rs` — `VirtualChip`: written vs active registers (double buffering applied on R0 write), band-select calibration timing/failure, lock model, readback, sticky bits, temperature.
- `transport.rs` — `Link` trait (sim, `SerialBridge` text protocol), port listing, USB scan with vendor hints.
- `api.rs` — `Engine`: settings + regs persistence (JSON), auto-apply writes changed registers R7→R0, SPI transaction log (`Txn` with decoded field changes), snapshot.

**Frontend** — `src/lib/store.ts` (zustand): `snap` (full snapshot after every mutating RPC), `status` (polled every 350 ms: sim lock/VTUNE/LD), log, view routing. `src/components/fields.tsx` renders any register field from metadata. Views live in `src/views/*View.tsx`; `ArchitectureView` is a hand-laid SVG (viewBox 1200×700) whose block ids match `FieldDef.block` and `src/lib/blocks.ts`. Charts are the in-house `components/Plot.tsx` (SVG, log axes, dual y, hover).

## Conventions

- UI strings and model messages are Russian. Datasheet names (INT, FRAC, MOD, ICP, MUX_OUT…) stay English.
- Register bit positions come only from the datasheet — never guess; `regs.rs` tests guard defaults and field round-trips.
- Keep physics in Rust; the frontend formats and plots. Do not duplicate model math in TS beyond trivial display formulas.
- `tsconfig` is strict with `noUnusedLocals/Parameters`; `npm run build` must pass.
- lucide-react 1.x has no brand icons (e.g. no `Github`).
- Hardware safety notes (3.3 V logic, isolate the on-board USB MCU before an external SPI master) must stay in docs/UI.
