"""Tests of the canon scripts in `.claude/scripts/`: paths from the shared
resolver, and a generator that fails closed on an `appliesTo` that cannot fire."""

import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import _common  # noqa: E402

HOOKS_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = HOOKS_DIR.parent / "scripts"
GENERATOR = SCRIPTS_DIR / "migrate-canon-index.py"
LIVE_PATTERN = ".claude/hooks-py/"
DEAD_PATTERN = "apps/zz-no-such-dir-fixture/"


def _load_script(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _entry(title: str, applies_to: str | None = None) -> str:
    applies = f"- **Applies to**: `{applies_to}`\n" if applies_to else ""
    return f"### {title}\n\n- **Key takeaway**: fixture takeaway.\n{applies}\n"


def _markdown(*sections: tuple[str, list[str]]) -> str:
    return "# Canon\n\n" + "".join(f"## {area}\n\n" + "".join(entries) for area, entries in sections)


class GeneratorResolvesItsPathsOnThisMachineTests(unittest.TestCase):
    """Without `--source`, the generator reads the markdown from the memory
    directory `_common` resolves; it used to point at another machine's home
    directory and exit 1."""

    def test_generator_reads_the_source_under_the_resolved_memory_dir(self):
        relative_memory = _common.memory_dir().relative_to(Path.home())
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            memory = home / relative_memory
            memory.mkdir(parents=True)
            (memory / "canon_research_index.md").write_text(_markdown(("Fixture area", [_entry("Live entry", LIVE_PATTERN)])))
            out = Path(tmp) / "out.json"
            result = subprocess.run(
                [sys.executable, str(GENERATOR), "--out", str(out)],
                env={**os.environ, "HOME": str(home)},
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            index = json.loads(out.read_text())
        self.assertEqual(index["entryCount"], 1)
        self.assertEqual(index["entries"]["live-entry"]["appliesTo"], [LIVE_PATTERN])


class GeneratorFailsClosedTests(unittest.TestCase):
    """A dead pattern or an undeclared empty `appliesTo`: the generator names
    every offender on stderr, exits non-zero, and writes nothing."""

    def setUp(self):
        self.migrate = _load_script(GENERATOR)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _generate(self, markdown: str) -> tuple[int, str, Path]:
        source = self.tmp / "canon_research_index.md"
        source.write_text(markdown)
        out = self.tmp / "canon-index.json"
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code = self.migrate.main(["--source", str(source), "--out", str(out)])
        return code, err.getvalue(), out

    def test_a_dead_pattern_is_named_with_its_entries_and_nothing_is_written(self):
        code, err, out = self._generate(_markdown(("Fixture area", [_entry("Dead one", DEAD_PATTERN), _entry("Dead two", DEAD_PATTERN)])))
        self.assertNotEqual(code, 0)
        self.assertIn(DEAD_PATTERN, err)
        self.assertIn("dead-one", err)
        self.assertIn("dead-two", err)
        self.assertFalse(out.exists())

    def test_an_empty_applies_to_in_an_undeclared_area_is_named(self):
        code, err, out = self._generate(_markdown(("Zz unmapped fixture area", [_entry("Orphan entry")])))
        self.assertNotEqual(code, 0)
        self.assertIn("orphan-entry", err)
        self.assertIn("Zz unmapped fixture area", err)
        self.assertFalse(out.exists())

    def test_a_declared_pathless_area_admits_an_empty_applies_to(self):
        area = next(iter(self.migrate.PATHLESS_AREAS))
        code, err, out = self._generate(_markdown((area, [_entry("Pathless entry")])))
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out.read_text())["entries"]["pathless-entry"]["appliesTo"], [])

    def test_a_live_tree_writes_the_index_with_the_source_name_only(self):
        code, err, out = self._generate(_markdown(("Fixture area", [_entry("Live entry", LIVE_PATTERN)])))
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out.read_text())["source"], "canon_research_index.md")


class GeneratorDataTests(unittest.TestCase):
    """The generator's data: every path exists in the tree, and `packages/core`
    — where the domain and application layers live — is covered."""

    def setUp(self):
        self.migrate = _load_script(GENERATOR)

    def test_every_mapped_path_is_live(self):
        mapped = {path for paths in self.migrate.AREA_TO_PATHS.values() for path in paths}
        self.assertEqual(sorted(p for p in mapped if not _common.applies_to_pattern_is_live(p)), [])

    def test_packages_core_is_covered(self):
        mapped = {path for paths in self.migrate.AREA_TO_PATHS.values() for path in paths}
        self.assertTrue(any(path.startswith("packages/core/") for path in mapped), sorted(mapped))

    def test_every_pathless_area_carries_a_reason_and_maps_to_no_path(self):
        self.assertTrue(self.migrate.PATHLESS_AREAS)
        for area, reason in self.migrate.PATHLESS_AREAS.items():
            with self.subTest(area=area):
                self.assertTrue(reason.strip())
                self.assertEqual(self.migrate.guess_paths(area), [])


class SiblingScriptsResolveTheSharedPathsTests(unittest.TestCase):
    """The scripts that read or write the index take their paths from the same
    resolver as the hooks, not from a constant naming another machine's home."""

    def test_each_script_points_at_the_resolved_memory_dir(self):
        cases = (
            ("canon-finalize.py", "CANON_MD", _common.canon_research_index_path),
            ("canon-finalize.py", "CANON_JSON", _common.canon_index_path),
            ("canon-staleness-report.py", "CANON_JSON", _common.canon_index_path),
        )
        for script, attribute, resolver in cases:
            with self.subTest(script=script, attribute=attribute):
                self.assertEqual(getattr(_load_script(SCRIPTS_DIR / script), attribute), resolver())


class NoHomeDirectoryLiteralTests(unittest.TestCase):
    """No hook or script source names a fixed home directory: memory is
    resolved through `_common.memory_dir()`. The needle is built by
    concatenation so this file does not match itself."""

    def test_hook_and_script_sources_name_no_home_directory(self):
        needle = re.compile("/" + "home/[a-z]+/")
        sources = [*HOOKS_DIR.glob("*.py"), *(HOOKS_DIR / "tests").glob("*.py"), *SCRIPTS_DIR.glob("*.py")]
        offenders = [f"{p.name}:{n}" for p in sources for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1) if needle.search(line)]
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
