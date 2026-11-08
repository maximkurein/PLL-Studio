# Управление версией

Где хранится версия PLL Studio, как её безопасно менять и какие файлы держатся синхронно.

Связанное: [BUILD.md](BUILD.md) · [docs/release_guide_ru.md](docs/release_guide_ru.md) · [CHANGELOG.md](CHANGELOG.md)

## Источник истины

Единственный источник версии релиза — `config/version.json`:

```json
{
  "app_info": {
    "name": "PLL Studio",
    "version": "X.Y.Z",
    "release_date": "DD.MM.YYYY",
    "last_updated": "YYYY-MM-DD",
    "author": "Kurein M N",
    "license": "MIT",
    "repository": "https://github.com/maximkurein/PLL-Studio",
    "mirror": "http://100.64.0.12:3000/mxm/PLL-Studio"
  }
}
```

Версия, название, дата выпуска, автор, лицензия и репозитории в интерфейсе поступают из `get_meta.app`. Ядро берёт их из генерируемого `crates/pll-core/src/about.rs`, синхронизируемого из этого файла. Модуль содержит константы, `info()` и `title()`; тест сверяет версию с `CARGO_PKG_VERSION` и все сведения с источником. Вручную модуль не редактируется. Изменив сведения в `app_info`, выполните `python3 tools/update_version.py sync`.

## Команды

`tools/update_version.py` использует только стандартную библиотеку Python — виртуальное окружение не нужно.

| Команда | Версия | Даты релиза |
|---|---|---|
| `status` | показывает все отслеживаемые файлы | — |
| `bump patch\|minor\|major` | следующая семантическая версия | сегодня |
| `sync X.Y.Z` | устанавливает `X.Y.Z` | сегодня |
| `sync` | повторно применяет текущую версию источника | сохраняются из источника |

Флаги `bump` и `sync`: `--release-date DD.MM.YYYY`, `--last-updated YYYY-MM-DD`, `--dry-run` (показать, что изменится, ничего не записывая).

```text
$ python3 tools/update_version.py bump patch
Target version:      0.1.1
Target release date: 08.11.2026
Target last updated: 2026-11-08

Updated config/version.json
Updated Cargo.toml
Updated Cargo.lock
Updated package.json
Updated package-lock.json
Updated src-tauri/tauri.conf.json
Updated README.md
Updated .github/ISSUE_TEMPLATE/bug.yml
```

Короткие варианты: `make version`, `make version-status`, `make bump-patch` / `bump-minor` / `bump-major`.

## Что синхронизируется

| Метка в `status` | Файл | Что меняется |
|---|---|---|
| `source` | `config/version.json` | `app_info`: версия, даты и сведения о проекте |
| `cargo` | `Cargo.toml` | `[workspace.package] version`, `authors`, `repository`, `license`; все крейты наследуют эти поля |
| `cargo_lock` | `Cargo.lock` | версии `pll-core`, `pll-server`, `pll-studio` |
| `npm` | `package.json` | `version`, `author`, `license`, `repository` |
| `npm_lock` | `package-lock.json` | `version`, `packages[""].version` и лицензия корневого пакета |
| `tauri` | `src-tauri/tauri.conf.json` | версия и название бандла; `publisher`, `copyright`, `homepage`, `license` |
| `about` | `crates/pll-core/src/about.rs` | все семь констант и метаданные для RPC `get_meta.app` |
| `license` | `LICENSE` | строка копирайта: год даты выпуска и автор |
| `readme` | `README.md` | заголовок `# PLL Studio vX.Y.Z` |
| `bug_form` | `.github/ISSUE_TEMPLATE/bug.yml` | подсказка версии |

Намеренно **не** синхронизируются: `CHANGELOG.md` (пишется вручную), упоминания версий в `docs/` (история), версия протокола прошивки `PLLBRIDGE 1.0` (меняется только при изменении протокола моста).

`status` обнаруживает также расхождение автора, лицензии, репозиториев и даты в генерируемых сведениях. `make check` запускает пять проверок скрипта синхронизации: идемпотентность, изменение метаданных, dry-run без записи и восстановление отсутствующего модуля; отсутствующие lock-файлы отмечаются и создаются менеджерами пакетов.

## Чек-лист релиза

1. Поднять версию:
   ```bash
   python3 tools/update_version.py bump patch
   ```
   Windows: `python tools\update_version.py bump patch`.
2. В `CHANGELOG.md` переименовать `## [Unreleased]` в `## [X.Y.Z] - YYYY-MM-DD` (та же дата, что `last_updated`).
3. Проверить, что ничего не разошлось:
   ```bash
   python3 tools/update_version.py status
   ```
   Все строки должны быть `OK`.
4. `make check`, коммит, push. Сообщение коммита: описание для пользователя, затем `; bump to X.Y.Z`.
5. Сборка: `build_macos.py` / `build_windows.ps1` берут версию из `config/version.json` и отказываются собирать при расхождении. Либо тег `vX.Y.Z` → GitHub Actions соберёт релиз.

## Семантика версий

- **patch** (0.1.0 → 0.1.1) — исправления, уточнения моделей, тексты.
- **minor** (0.1.x → 0.2.0) — новые экраны, эксперименты, драйверы подключения, новые поля конфигурации.
- **major** (0.x → 1.0.0) — несовместимые изменения формата экспорта/настроек или протокола SPI-моста.

## Проблемы

**`status` показывает `DIFF`** — файл правили вручную. `sync` (сохраняет версию и даты источника).

**`RuntimeError: Не удалось обновить …`** — строку, которую ищет инструмент, переформатировали. Верните ожидаемый вид (см. таблицу) и повторите `sync`.

**`cargo_lock` = `mixed`** — Cargo.lock частично обновлён. `sync`, затем `cargo check` (Cargo сам допишет остальное).

## Правило

Меняйте версию только через `tools/update_version.py` — никогда поиском-заменой по репозиторию. Источник истины — `config/version.json`. Перед релизом всегда `status`.
