"""Tests de los hooks que leen canon-index.json: la ruta se resuelve en cada llamada."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pre_edit_canon as canon  # noqa: E402
import pre_edit_decision_guard as guard  # noqa: E402


class LoadIndexResolvesThePathAtEachCallTests(unittest.TestCase):
    """`load_index` llama a `canon_index_path()` al correr, no al importar: la
    ruta que valía en el import no queda atada al proceso."""

    def _index(self, tmp: str, name: str, payload: dict) -> Path:
        path = Path(tmp) / name
        path.write_text(json.dumps(payload))
        return path

    def test_pre_edit_canon(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, second = self._index(tmp, "a.json", {"v": 1}), self._index(tmp, "b.json", {"v": 2})
            with mock.patch.object(canon, "canon_index_path", return_value=first):
                self.assertEqual(canon.load_index(), {"v": 1})
            with mock.patch.object(canon, "canon_index_path", return_value=second):
                self.assertEqual(canon.load_index(), {"v": 2})

    def test_pre_edit_decision_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, second = self._index(tmp, "a.json", {"v": 1}), self._index(tmp, "b.json", {"v": 2})
            with mock.patch.object(guard, "canon_index_path", return_value=first):
                self.assertEqual(guard.load_index(), {"v": 1})
            with mock.patch.object(guard, "canon_index_path", return_value=second):
                self.assertEqual(guard.load_index(), {"v": 2})


if __name__ == "__main__":
    unittest.main()
