# AGENTS.md

Инструкции для ИИ-агентов (Codex, Cursor, Claude Code и др.), работающих с этим репозиторием. Подробная техническая справка — в [CLAUDE.md](CLAUDE.md).

## Проект

PLL Studio — приложение для управления и изучения RF-синтезатора IDT/Renesas 8V97051 и платы 8V9705x EVB. Rust-ядро (`crates/pll-core`), desktop-оболочка Tauri 2 (`src-tauri`), веб-сервер (`crates/pll-server`), интерфейс React 19 + Tailwind 4 (`src`), прошивка SPI-моста (`firmware`).

## Обязательные правила

1. **Версия** меняется только через `python3 tools/update_version.py` (`status`, `bump patch|minor|major`, `sync X.Y.Z`). Источник — `config/version.json`. Никаких ручных правок версий в `Cargo.toml`, `package.json`, `tauri.conf.json`.
2. **CHANGELOG.md** обновляется вручную в разделе `## [Unreleased]` при каждом заметном изменении; при релизе раздел переименовывается в `## [X.Y.Z] - YYYY-MM-DD`.
3. **Перед завершением работы**: `make check` (или по отдельности: `python3 tools/update_version.py status`, `npm run build`, `cargo test -p pll-core`, `cargo check -p pll-server -p pll-studio`).
4. **Позиции битов регистров** — только из даташита 8V97051. Не угадывать. При изменении `regs.rs` обновить тесты.
5. **Физика и расчёты** — в Rust (`pll-core`). Фронтенд только отображает.
6. **Новая функция бэкенда** = команда в `Engine::handle` (`api.rs`) + типы в `src/lib/types.ts` + вызов через `useStore().call()`.
7. **Язык интерфейса** — русский; имена регистров и полей — как в даташите (английские).
8. **Безопасность железа**: предупреждения о логике 3.3 В и изоляции штатного USB-контроллера EVB не удалять из документации и интерфейса.
9. **Сведения о программе**: название, автор, лицензия, репозитории и дата — из `config/version.json`. После изменения выполнить штатный `sync`; `crates/pll-core/src/about.rs` генерируется, вручную не редактируется. UI использует `get_meta.app` через подписку стора. Экран «О программе» — ⌘/Ctrl+0, остальные экраны — 1…9 в порядке меню.

## Стиль коммитов

`<описание для пользователя>` и, если менялась версия, `; bump to X.Y.Z`. Пример: `Свип частоты показывает ядро ГУН; bump to 0.1.1`.

## Структура документации

| Файл | Назначение |
|---|---|
| `README.md` | обзор, быстрый старт, возможности |
| `BUILD.md` | сборка macOS / Windows / веб |
| `VERSION_MANAGEMENT.md` | версия и релизный чек-лист |
| `CHANGELOG.md` | история изменений |
| `SECURITY.md` | безопасность ПО и железа |
| `docs/INDEX_ru.md` | индекс руководств |
| `docs/FIRST_RUN_ru.md` | первый запуск с платой |
| `docs/SPI_BRIDGE_ru.md` | прошивка, схема и протокол SPI-моста |
| `docs/ARCHITECTURE_ru.md` | архитектура кода |
| `docs/release_guide_ru.md` | выпуск релиза |

## Что не коммитить

`target/`, `node_modules/`, `dist/`, `release/`, `src-tauri/gen/`, `.env`, `.claude/settings.local.json`, даташиты производителя (PDF) — ссылки на них давать в документации.
