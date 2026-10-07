import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("bump_version", ROOT / "bin" / "bump_version.py")
bump_version = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bump_version)

VERSION_FILES = tuple(bump_version.VERSION_PATTERNS)


class TestNextVersion(unittest.TestCase):
    def test_bumps_each_part_and_resets_lower_ones(self):
        self.assertEqual(bump_version.next_version("1.4.7", "major"), "2.0.0")
        self.assertEqual(bump_version.next_version("1.4.7", "minor"), "1.5.0")
        self.assertEqual(bump_version.next_version("1.4.7", "patch"), "1.4.8")

    def test_rejects_non_semver(self):
        with self.assertRaises(SystemExit):
            bump_version.next_version("1.4.7-beta", "patch")


class TestBump(unittest.TestCase):
    """Runs against copies of the real version files so the patterns stay honest."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        for name in VERSION_FILES:
            shutil.copy(ROOT / name, self.root / name)
        self.original = bump_version.current_version(self.root)

    def versions(self) -> dict[str, str]:
        return {
            name: pattern.search((self.root / name).read_text()).group(2)
            for name, pattern in bump_version.VERSION_PATTERNS.items()
        }

    def test_repo_version_files_are_in_sync(self):
        self.assertEqual(set(self.versions().values()), {self.original})

    def test_bump_updates_every_file_and_nothing_else(self):
        before = {name: (self.root / name).read_text() for name in VERSION_FILES}

        old, new = bump_version.bump(self.root, "minor")

        self.assertEqual(old, self.original)
        self.assertEqual(new, bump_version.next_version(self.original, "minor"))
        self.assertEqual(set(self.versions().values()), {new})
        for name in VERSION_FILES:
            after = (self.root / name).read_text()
            self.assertEqual(after.replace(new, old, 1), before[name], name)

    def test_dry_run_writes_nothing(self):
        before = {name: (self.root / name).read_text() for name in VERSION_FILES}

        _, new = bump_version.bump(self.root, "major", dry_run=True)

        self.assertNotEqual(new, self.original)
        for name in VERSION_FILES:
            self.assertEqual((self.root / name).read_text(), before[name], name)

    def test_out_of_sync_file_aborts_without_writing(self):
        package_json = self.root / "package.json"
        package_json.write_text(package_json.read_text().replace(self.original, "9.9.9", 1))
        pyproject_before = (self.root / "pyproject.toml").read_text()

        with self.assertRaises(SystemExit):
            bump_version.bump(self.root, "patch")

        self.assertEqual((self.root / "pyproject.toml").read_text(), pyproject_before)
