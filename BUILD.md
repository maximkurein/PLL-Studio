# Сборка PLL Studio

Как собрать **приложение для macOS** (`.app` + `.dmg`) и **установщик для Windows** (`.exe` NSIS + `.msi`), а также веб-сервер `pll-server`.

Связанное: [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) · [docs/release_guide_ru.md](docs/release_guide_ru.md) · [CHANGELOG.md](CHANGELOG.md)

## Модели сборки

| Платформа | Результат | Нужен ли пользователю Rust/Node? |
|-----------|-----------|----------------------------------|
| **macOS** | `PLL-Studio-vX.Y.Z-macos-<arch>.dmg` и `.app.zip` (Tauri, ad-hoc подпись) | Нет |
| **Windows** | `PLL-Studio-Setup-vX.Y.Z-x64.exe` (NSIS) и `PLL-Studio-vX.Y.Z-x64.msi` | Нет. WebView2 есть в Windows 10/11; установщик докачает при необходимости |
| **Веб / сервер** | `pll-server` + папка `dist/` | Нет |

Все артефакты складываются в `release/vX.Y.Z/` вместе с `checksum.txt` (SHA-256).

## Требования

| | macOS | Windows |
|---|---|---|
| Rust | `rustup` stable (`curl https://sh.rustup.rs -sSf \| sh`) | `rustup` stable, toolchain **MSVC** |
| Node.js | 20+ (`brew install node`) | 20+ (nodejs.org) |
| Системное | Xcode Command Line Tools: `xcode-select --install` | Visual Studio Build Tools 2022, компонент «Desktop development with C++» |
| Python | `python3` (есть в macOS) — для проверки версии | Python 3 (необязательно — без него проверка версии пропускается) |

Первый раз в папке проекта:

```bash
npm ci
```

---

## Шаг 1. Версия (только через инструмент)

Никогда не правьте версию вручную. Единственный источник — `config/version.json`.

```bash
python3 tools/update_version.py status        # всё ли синхронно
python3 tools/update_version.py bump patch    # 0.1.0 → 0.1.1 во всех файлах
```

Затем добавьте раздел `## [X.Y.Z] - YYYY-MM-DD` в `CHANGELOG.md`. Подробности — [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md).

## Шаг 2. Проверка

```bash
make check     # версии + tsc + vite build + cargo test + cargo check
```

## Шаг 3. Сборка

### macOS

```bash
python3 build_macos.py                         # архитектура этого Mac (arm64 или x64)
python3 build_macos.py --universal             # один бинарник для Apple Silicon и Intel
python3 build_macos.py --universal --with-server --open
```

или `make build-mac` / `make build-mac-universal`.

Скрипт проверяет инструменты и версии, при необходимости делает `npm ci`, запускает тесты `pll-core`, затем `tauri build --bundles app,dmg` и собирает артефакты:

```text
release/v0.1.0/
  PLL-Studio-v0.1.0-macos-arm64.dmg
  PLL-Studio-v0.1.0-macos-arm64.app.zip
  pll-server-v0.1.0-macos-arm64        (с --with-server)
  checksum.txt
```

Приложение подписано **ad-hoc** (`signingIdentity: "-"` в `tauri.conf.json`), без нотаризации. При первом запуске скачанного `.dmg` macOS может предупредить о неизвестном разработчике: правый клик → «Открыть», или

```bash
xattr -dr com.apple.quarantine "/Applications/PLL Studio.app"
```

Для распространения с нотаризацией нужен сертификат Developer ID: задайте `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` — Tauri подпишет и нотаризует автоматически.

### Windows

```powershell
.\build_windows.ps1                    # NSIS + MSI
.\build_windows.ps1 -Bundles nsis      # только NSIS
.\build_windows.ps1 -WithServer -Open
```

или из CMD: `build_windows.bat` (те же параметры).

```text
release\v0.1.0\
  PLL-Studio-Setup-v0.1.0-x64.exe
  PLL-Studio-v0.1.0-x64.msi
  pll-server-v0.1.0-x64.exe            (с -WithServer)
  checksum.txt
```

Установщик не подписан — SmartScreen может показать предупреждение («Подробнее» → «Выполнить в любом случае»). Язык установщика — русский.

### Веб-режим / удалённая лаборатория

```bash
make build-web
./target/release/pll-server --host 0.0.0.0 --port 7878 --dist dist
```

Откройте `http://<адрес>:7878`. Параметры: `--host` (по умолчанию `127.0.0.1`), `--port` (7878), `--dist` (папка интерфейса), `--config` (файл состояния, по умолчанию `~/.pll-studio/server.json`). Открывая сервер в сеть (`0.0.0.0`), помните: аутентификации нет — см. [SECURITY.md](SECURITY.md).

---

## Сборка в GitHub Actions

- `.github/workflows/ci.yml` — на каждый push/PR: проверка версий, `npm run build`, `cargo test -p pll-core`, `cargo check`. Ручной запуск (`workflow_dispatch`) дополнительно собирает `.dmg` (universal) и `.exe`/`.msi` как артефакты.
- `.github/workflows/release.yml` — по тегу `vX.Y.Z` проверяет совпадение тега с `config/version.json` и публикует черновик релиза с установщиками (tauri-action).

## Где что лежит после сборки

| Что | Путь |
|---|---|
| Фронтенд | `dist/` |
| Бинарники Rust | `target/release/` (или `target/<triple>/release/`) |
| Бандлы Tauri | `target/[<triple>/]release/bundle/{macos,dmg,nsis,msi}/` |
| Готовые артефакты | `release/vX.Y.Z/` |

## Проблемы и решения

**`версии в файлах расходятся`** — кто-то изменил версию вручную. `python3 tools/update_version.py sync`.

**macOS: `xcrun: error: invalid active developer path`** — `xcode-select --install`.

**macOS universal: `target may not be installed`** — `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

**Windows: `link.exe not found`** — установите Visual Studio Build Tools с компонентом C++ и перезапустите терминал.

**Windows: `running scripts is disabled on this system`** — запускайте через `build_windows.bat` или `powershell -ExecutionPolicy Bypass -File build_windows.ps1`.

**Приложение показывает старую версию** — пересоберите после `sync`; версия в интерфейсе (внизу боковой панели) берётся из `Cargo.toml` при компиляции.

**`npm ci` ругается на lock-файл** — `npm install` обновит `package-lock.json`; затем снова `python3 tools/update_version.py status`.

## Штатный USB платы EVB

Экспериментальный транспорт FT2232/SC18IS602 входит в `pll-core` и обе оболочки без новых библиотек. Доступ к устройству зависит от драйвера ОС: Windows — WinUSB на интерфейсе A; macOS/Linux — свободный USB-интерфейс и права. [Подключение, ограничения и возврат к Timing Commander](docs/NATIVE_USB_ru.md).
