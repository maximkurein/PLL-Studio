#!/usr/bin/env python3
"""Управление версией PLL Studio.

Единственный источник версии — config/version.json (app_info).
Скрипт синхронизирует её во все файлы, где версия должна совпадать:
Cargo.toml (workspace), Cargo.lock, package.json, package-lock.json,
src-tauri/tauri.conf.json, about.rs, LICENSE, README.md и шаблон баг-репорта.
Автор, лицензия и репозитории также синхронизируются из app_info.

Только стандартная библиотека Python — venv не нужен.

    python3 tools/update_version.py status
    python3 tools/update_version.py bump patch|minor|major [--dry-run]
    python3 tools/update_version.py sync [X.Y.Z] [--release-date DD.MM.YYYY] [--last-updated YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "config" / "version.json"
CARGO_TOML = ROOT / "Cargo.toml"
CARGO_LOCK = ROOT / "Cargo.lock"
PACKAGE_JSON = ROOT / "package.json"
PACKAGE_LOCK = ROOT / "package-lock.json"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
README = ROOT / "README.md"
BUG_TEMPLATE = ROOT / ".github" / "ISSUE_TEMPLATE" / "bug.yml"
ABOUT = ROOT / "crates" / "pll-core" / "src" / "about.rs"
LICENSE = ROOT / "LICENSE"

# crates of this workspace (their entries in Cargo.lock carry the app version)
WORKSPACE_CRATES = ("pll-core", "pll-server", "pll-studio")

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


# ───────────────────────── helpers ─────────────────────────

def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str, dry: bool) -> None:
    if path.exists() and read(path) == text:
        print(f"Unchanged {rel(path)}")
        return
    if dry:
        print(f"[DRY RUN] Would update {rel(path)}")
        return
    # LF везде (см. .gitattributes)
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"Updated {rel(path)}")


def load_json(path: Path) -> dict:
    return json.loads(read(path))


def dump_json(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def parse_semver(v: str) -> tuple[int, int, int]:
    if not SEMVER.match(v):
        raise ValueError(f"Некорректная семантическая версия: {v!r} (ожидается X.Y.Z)")
    a, b, c = (int(x) for x in v.split("."))
    return a, b, c


def bump(v: str, part: str) -> str:
    major, minor, patch = parse_semver(v)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def replace_once(text: str, pattern: str, repl: str, what: str, flags: int = 0) -> str:
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n == 0:
        raise RuntimeError(f"Не удалось обновить {what}: строка по шаблону {pattern!r} не найдена")
    return new


# ───────────────────────── source of truth ─────────────────────────

def get_source() -> dict:
    info = load_json(SOURCE)["app_info"]
    parse_semver(info["version"])
    for key in ("name", "author", "license", "repository", "mirror", "release_date"):
        if not isinstance(info[key], str) or not info[key].strip():
            raise ValueError(f"Пустое поле app_info.{key}")
    return info


def set_source(meta: dict, dry: bool) -> None:
    data = load_json(SOURCE)
    data["app_info"].update(meta)
    if dry:
        print(f"[DRY RUN] Would update {rel(SOURCE)}")
        return
    SOURCE.write_text(dump_json(data), encoding="utf-8")
    print(f"Updated {rel(SOURCE)}")


# ───────────────────────── tracked files ─────────────────────────

def copyright_line(info: dict) -> str:
    return f"Copyright (c) {info['release_date'][-4:]} {info['author']}"


def about_text(info: dict) -> str:
    constants = "\n".join(
        f"pub const {key.upper()}: &str = {json.dumps(info[key], ensure_ascii=False)};"
        for key in ("name", "version", "release_date", "author", "license", "repository", "mirror")
    )
    return """// Значения синхронизируются из config/version.json, вручную не править.
// Обновление: python3 tools/update_version.py sync

""" + constants + """

pub fn title() -> String {
    format!("{NAME} v{VERSION} · {AUTHOR}")
}

pub fn info() -> serde_json::Value {
    serde_json::json!({
        "name": NAME, "version": VERSION, "release_date": RELEASE_DATE,
        "author": AUTHOR, "license": LICENSE, "repository": REPOSITORY, "mirror": MIRROR,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_package_and_source() {
        assert_eq!(VERSION, env!("CARGO_PKG_VERSION"));
        let source: serde_json::Value = serde_json::from_str(include_str!("../../../config/version.json")).unwrap();
        for key in ["name", "version", "release_date", "author", "license", "repository", "mirror"] {
            assert_eq!(info()[key], source["app_info"][key], "{key}");
        }
        assert_eq!(title(), format!("{} v{} · {}", NAME, VERSION, AUTHOR));
    }
}
"""


def targets(info: dict) -> list[tuple[str, Path, str]]:
    """Expected contents, derived from the source while preserving unrelated settings."""
    v = info["version"]
    cargo = read(CARGO_TOML)
    section = re.search(r"(\[workspace\.package\]\n)(.*?)(?=^\[|\Z)", cargo, re.M | re.S)
    if not section:
        raise RuntimeError("Нет [workspace.package] в Cargo.toml")
    body = section.group(2)
    for key, value in dict(version=v, authors=[info["author"]], repository=info["repository"], license=info["license"]).items():
        line = f"{key} = {json.dumps(value, ensure_ascii=False)}"
        if re.search(rf"^{key}\s*=", body, re.M):
            body = re.sub(rf"^{key}\s*=.*$", lambda _: line, body, count=1, flags=re.M)
        else:
            body = body.rstrip() + "\n" + line + "\n\n"
    cargo = cargo[:section.start(2)] + body + cargo[section.end(2):]
    result = [("cargo", CARGO_TOML, cargo)]
    if CARGO_LOCK.exists():
        lock = read(CARGO_LOCK)
        for crate in WORKSPACE_CRATES:
            lock = replace_once(lock, rf'(^name = "{re.escape(crate)}"\r?\nversion = ")[^"]+(")', rf"\g<1>{v}\g<2>", f"Cargo.lock ({crate})", re.M)
        result.append(("cargo_lock", CARGO_LOCK, lock))
    else:
        result.append(("cargo_lock", CARGO_LOCK, ""))
    package = load_json(PACKAGE_JSON)
    package.update(version=v, author=info["author"], license=info["license"], repository={"type": "git", "url": info["repository"] + ".git"})
    result.append(("npm", PACKAGE_JSON, dump_json(package)))
    if PACKAGE_LOCK.exists():
        lock = load_json(PACKAGE_LOCK)
        lock["version"] = v
        lock.setdefault("packages", {}).setdefault("", {}).update(version=v, license=info["license"])
        result.append(("npm_lock", PACKAGE_LOCK, dump_json(lock)))
    else:
        result.append(("npm_lock", PACKAGE_LOCK, ""))
    conf = load_json(TAURI_CONF)
    conf.update(version=v, productName=info["name"])
    conf["bundle"].update(publisher=info["author"], copyright=copyright_line(info), homepage=info["repository"], license=info["license"])
    result.append(("tauri", TAURI_CONF, dump_json(conf)))
    result.append(("about", ABOUT, about_text(info)))
    result.append(("license", LICENSE, replace_once(read(LICENSE), r'^Copyright .*$', copyright_line(info), "LICENSE copyright", re.M)))
    result.append(("readme", README, replace_once(read(README), r"^# PLL Studio v\d+\.\d+\.\d+", f"# PLL Studio v{v}", "заголовок README.md", re.M)))
    result.append(("bug_form", BUG_TEMPLATE, replace_once(read(BUG_TEMPLATE), r'(id: version.*?placeholder: ")[^"]+(")', rf"\g<1>{v}\g<2>", "версия bug.yml", re.S)))
    return result


# ───────────────────────── commands ─────────────────────────

def status() -> int:
    src = get_source()
    print(f"Source  {rel(SOURCE)}: v{src['version']}  (release {src['release_date']}, updated {src['last_updated']})\n")
    bad = 0
    for label, path, expected in targets(src):
        state = "MISSING" if not path.exists() else "OK" if read(path) == expected else "DIFF"
        bad += state != "OK"
        print(f"  {label:<11} {state:<8} {rel(path)}")
    if bad:
        print(f"\n{bad} file(s) out of sync — run: python3 tools/update_version.py sync")
        return 1
    print("\nAll tracked versions and app metadata match.")
    return 0


def sync(meta: dict, dry: bool) -> None:
    info = {**get_source(), **meta}
    print(f"Target version:      {info['version']}")
    print(f"Target release date: {info['release_date']}")
    print(f"Target last updated: {info['last_updated']}\n")
    expected = targets(info)
    set_source(info, dry)
    for label, path, content in expected:
        if label in ("cargo_lock", "npm_lock") and not path.exists():
            print(f"Skip {rel(path)} (создаётся менеджером пакетов)")
            continue
        write(path, content, dry)
    print("\nCHANGELOG.md: обновите раздел Unreleased; при выпуске переименуйте в ## [%s] - %s" % (info["version"], info["last_updated"]))


def check_date(value: str, fmt: str, flag: str) -> str:
    try:
        datetime.strptime(value, fmt)
    except ValueError as e:
        raise SystemExit(f"{flag}: неверная дата {value!r}: {e}")
    return value


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Управление версией PLL Studio (источник: config/version.json)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="показать состояние всех файлов с версией")
    for name, hlp in (("sync", "синхронизировать файлы с источником (или задать X.Y.Z)"), ("bump", "увеличить версию patch|minor|major и синхронизировать")):
        sp = sub.add_parser(name, help=hlp)
        if name == "sync":
            sp.add_argument("version", nargs="?", help="новая версия X.Y.Z (по умолчанию — текущая из источника)")
        else:
            sp.add_argument("part", choices=["patch", "minor", "major"])
        sp.add_argument("--release-date", help="дата релиза DD.MM.YYYY (по умолчанию — сегодня)")
        sp.add_argument("--last-updated", help="дата обновления YYYY-MM-DD (по умолчанию — сегодня)")
        sp.add_argument("--dry-run", action="store_true", help="показать изменения, ничего не записывая")
    a = p.parse_args(argv)

    try:
        if a.cmd == "status":
            return status()
        src = get_source()
        today = date.today()
        if a.cmd == "bump":
            version = bump(src["version"], a.part)
            fresh = True
        elif a.version:
            parse_semver(a.version)
            version = a.version
            fresh = True
        else:
            version = src["version"]
            fresh = False
        meta = {
            "version": version,
            "release_date": a.release_date or (today.strftime("%d.%m.%Y") if fresh else src.get("release_date", today.strftime("%d.%m.%Y"))),
            "last_updated": a.last_updated or (today.isoformat() if fresh else src.get("last_updated", today.isoformat())),
        }
        check_date(meta["release_date"], "%d.%m.%Y", "--release-date")
        check_date(meta["last_updated"], "%Y-%m-%d", "--last-updated")
        sync(meta, a.dry_run)
        return 0
    except (ValueError, RuntimeError, KeyError, FileNotFoundError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
