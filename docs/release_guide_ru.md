# Выпуск релиза PLL Studio

Связанное: [VERSION_MANAGEMENT.md](../VERSION_MANAGEMENT.md) · [BUILD.md](../BUILD.md) · [CHANGELOG.md](../CHANGELOG.md)

## Чек-лист

1. **Версия**
   ```bash
   python3 tools/update_version.py bump patch     # или minor / major
   ```
2. **CHANGELOG.md** — `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD`, добавить новый пустой `## [Unreleased]` сверху.
3. **Проверка**
   ```bash
   python3 tools/update_version.py status         # все строки OK
   make check
   ```
4. **Ручная проверка** — `npm run app`: архитектура, планировщик (применить 2.45 ГГц → захват), регистры (прочитать всё → readback ✓), петля, шум, лаборатория (свип). С платой — несущая на анализаторе.
5. **Коммит**
   ```bash
   git commit -am "Краткое описание для пользователя; bump to X.Y.Z"
   git push
   ```
6. **Сборка**
   - локально: `python3 build_macos.py --universal --with-server` (Mac) и `.\build_windows.ps1 -WithServer` (Windows) → `release/vX.Y.Z/` + `checksum.txt`;
   - или в GitHub: `git tag vX.Y.Z && git push origin vX.Y.Z` → workflow **Release** соберёт `.dmg` (universal), `.exe`, `.msi` и создаст черновик релиза.
7. **Публикация** — проверьте черновик релиза, вставьте раздел из CHANGELOG и контрольные суммы, опубликуйте.

## Именование артефактов

| Платформа | Файл |
|---|---|
| macOS | `PLL-Studio-vX.Y.Z-macos-<arm64\|x64\|universal>.dmg`, `….app.zip` |
| Windows | `PLL-Studio-Setup-vX.Y.Z-x64.exe`, `PLL-Studio-vX.Y.Z-x64.msi` |
| Сервер | `pll-server-vX.Y.Z-<платформа>` |
| Контрольные суммы | `checksum.txt` (SHA-256) |
