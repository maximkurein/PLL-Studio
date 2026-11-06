#!/usr/bin/env python3
"""Сборка PLL Studio для macOS: .app + .dmg (Tauri 2).

Версия берётся из config/version.json — перед сборкой проверяется, что все
файлы синхронизированы (tools/update_version.py status).

    python3 build_macos.py                 # архитектура этого Mac
    python3 build_macos.py --universal     # Apple Silicon + Intel в одном бинарнике
    python3 build_macos.py --with-server   # плюс консольный pll-server (веб-режим)
    python3 build_macos.py --open          # открыть папку с результатом

Результат: release/vX.Y.Z/
    PLL-Studio-vX.Y.Z-macos-<arch>.dmg
    PLL-Studio-vX.Y.Z-macos-<arch>.app.zip
    [pll-server-vX.Y.Z-macos-<arch>]
    checksum.txt  (SHA-256)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION_FILE = ROOT / "config" / "version.json"
PRODUCT = "PLL Studio"
SLUG = "PLL-Studio"


def info(msg: str) -> None:
    print(f"\033[36m▸\033[0m {msg}", flush=True)


def ok(msg: str) -> None:
    print(f"\033[32m✓\033[0m {msg}", flush=True)


def fail(msg: str) -> "None":
    print(f"\033[31m✗ {msg}\033[0m", file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd: list[str], **kw) -> None:
    print(f"  $ {' '.join(cmd)}", flush=True)
    r = subprocess.run(cmd, cwd=ROOT, **kw)
    if r.returncode != 0:
        fail(f"команда завершилась с кодом {r.returncode}: {' '.join(cmd)}")


def version() -> str:
    return json.loads(VERSION_FILE.read_text(encoding="utf-8"))["app_info"]["version"]


def need(tool: str, hint: str) -> None:
    if shutil.which(tool) is None:
        fail(f"не найден `{tool}` — {hint}")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description="Сборка PLL Studio для macOS")
    ap.add_argument("--universal", action="store_true", help="универсальный бинарник arm64 + x86_64")
    ap.add_argument("--with-server", action="store_true", help="дополнительно собрать pll-server (веб / удалённая лаборатория)")
    ap.add_argument("--skip-version-check", action="store_true", help="не проверять синхронизацию версий")
    ap.add_argument("--skip-npm-install", action="store_true", help="не запускать npm ci, даже если node_modules нет")
    ap.add_argument("--open", action="store_true", help="открыть папку с результатом в Finder")
    a = ap.parse_args()

    if sys.platform != "darwin":
        fail("этот скрипт собирает только под macOS; для Windows используйте build_windows.ps1")

    v = version()
    arch = "universal" if a.universal else ("arm64" if platform.machine() == "arm64" else "x64")
    print(f"\n\033[1m{PRODUCT} v{v} — сборка macOS ({arch})\033[0m\n")
    t0 = time.time()

    # 1. окружение
    need("cargo", "установите Rust: https://rustup.rs")
    need("node", "установите Node.js 20+ (https://nodejs.org или brew install node)")
    need("npm", "входит в Node.js")
    need("xcrun", "установите Xcode Command Line Tools: xcode-select --install")
    ok("инструменты найдены")

    # 2. версии
    if not a.skip_version_check:
        info("проверка версий (tools/update_version.py status)")
        r = subprocess.run([sys.executable, "tools/update_version.py", "status"], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout)
            fail("версии в файлах расходятся — выполните: python3 tools/update_version.py sync")
        ok(f"версия v{v} синхронизирована")

    # 3. зависимости фронтенда
    if not (ROOT / "node_modules").exists() and not a.skip_npm_install:
        info("установка npm-зависимостей")
        run(["npm", "ci"])

    # 4. цели Rust
    triple = None
    if a.universal:
        triple = "universal-apple-darwin"
        info("цели Rust для universal-сборки")
        run(["rustup", "target", "add", "aarch64-apple-darwin", "x86_64-apple-darwin"])

    # 5. тесты модели (быстро, ловят регрессии расчётов)
    info("тесты pll-core")
    run(["cargo", "test", "-q", "-p", "pll-core"])

    # 6. сборка Tauri (beforeBuildCommand сам соберёт фронтенд)
    info("сборка приложения (tauri build)")
    cmd = ["npx", "tauri", "build", "--bundles", "app,dmg"]
    if triple:
        cmd += ["--target", triple]
    run(cmd)

    bundle = ROOT / "target" / (triple or "") / "release" / "bundle"
    apps = sorted((bundle / "macos").glob("*.app"))
    dmgs = sorted((bundle / "dmg").glob("*.dmg"))
    if not apps:
        fail(f"не найден .app в {bundle / 'macos'}")

    # 7. артефакты
    out = ROOT / "release" / f"v{v}"
    out.mkdir(parents=True, exist_ok=True)
    produced: list[Path] = []
    zip_path = out / f"{SLUG}-v{v}-macos-{arch}.app.zip"
    zip_path.unlink(missing_ok=True)
    run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(apps[0]), str(zip_path)])
    produced.append(zip_path)
    if dmgs:
        dst = out / f"{SLUG}-v{v}-macos-{arch}.dmg"
        shutil.copy2(dmgs[0], dst)
        produced.append(dst)

    if a.with_server:
        info("сборка pll-server")
        scmd = ["cargo", "build", "--release", "-p", "pll-server"]
        if a.universal:
            for t in ("aarch64-apple-darwin", "x86_64-apple-darwin"):
                run(scmd + ["--target", t])
            dst = out / f"pll-server-v{v}-macos-universal"
            run(["lipo", "-create", "-output", str(dst),
                 str(ROOT / "target/aarch64-apple-darwin/release/pll-server"),
                 str(ROOT / "target/x86_64-apple-darwin/release/pll-server")])
        else:
            run(scmd)
            dst = out / f"pll-server-v{v}-macos-{arch}"
            shutil.copy2(ROOT / "target/release/pll-server", dst)
        produced.append(dst)

    lines = [f"{sha256(p)}  {p.name}" for p in produced]
    (out / "checksum.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print()
    ok(f"готово за {time.time() - t0:.0f} с → {out.relative_to(ROOT)}/")
    for p in produced:
        print(f"    {p.name}  ({p.stat().st_size / 1e6:.1f} МБ)")
    print("    checksum.txt")
    print("\nПриложение подписано ad-hoc. При первом запуске macOS может предупредить о неизвестном разработчике:")
    print("  правый клик → «Открыть», или: xattr -dr com.apple.quarantine \"/Applications/PLL Studio.app\"")
    if a.open:
        subprocess.run(["open", str(out)])


if __name__ == "__main__":
    main()
