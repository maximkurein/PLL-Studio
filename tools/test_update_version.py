"""Regression checks for version and identity synchronization; no project files are changed."""
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update_version as version


class VersionSyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        names = ("SOURCE", "CARGO_TOML", "CARGO_LOCK", "PACKAGE_JSON", "PACKAGE_LOCK", "TAURI_CONF", "README", "BUG_TEMPLATE", "ABOUT", "LICENSE")
        values = {"ROOT": root}
        for name in names:
            source = getattr(version, name)
            dest = root / source.relative_to(version.ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(source.read_bytes())
            values[name] = dest
        self.patch = patch.multiple(version, **values)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def test_sync_updates_identity_dates_and_is_idempotent(self):
        info = {**version.get_source(), "version": "9.8.7", "author": "Test Author", "release_date": "01.02.2030", "last_updated": "2030-02-01"}
        version.sync(info, False)
        self.assertEqual(version.status(), 0)
        self.assertIn('pub const AUTHOR: &str = "Test Author";', version.read(version.ABOUT))
        self.assertIn("Copyright (c) 2030 Test Author", version.read(version.LICENSE))
        before = {p: version.read(p) for _, p, _ in version.targets(info)}
        version.sync(info, False)
        self.assertEqual(before, {p: version.read(p) for p in before})

    def test_status_detects_identity_drift_with_matching_version(self):
        version.ABOUT.write_text(version.read(version.ABOUT).replace(version.get_source()["author"], "Wrong Author"))
        self.assertEqual(version.status(), 1)

    def test_dry_run_preserves_every_file(self):
        before = {p: p.read_bytes() for p in version.ROOT.rglob("*") if p.is_file()}
        version.sync({**version.get_source(), "version": "9.9.9", "release_date": "02.03.2031"}, True)
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_missing_generated_module_is_reported_and_recreated(self):
        version.ABOUT.unlink()
        self.assertEqual(version.status(), 1)
        version.sync(version.get_source(), False)
        self.assertEqual(version.status(), 0)

    def test_missing_lock_is_reported_without_fabricating_it(self):
        version.CARGO_LOCK.unlink()
        version.sync(version.get_source(), False)
        self.assertFalse(version.CARGO_LOCK.exists())
        self.assertEqual(version.status(), 1)


if __name__ == "__main__":
    unittest.main()
