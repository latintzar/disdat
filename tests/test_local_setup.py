import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("disdat_setup_local", ROOT / "tools/disdat.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class LocalSetupTest(unittest.TestCase):
    def test_installs_only_operator_supplied_model_in_private_runtime(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            fake_root = base / "source"
            (fake_root / "extension/vendor").mkdir(parents=True)
            (fake_root / "extension/manifest.json").write_text('{"version":"test"}')
            (fake_root / "extension/vendor/engine.js").write_text("// fixture")
            model = base / "compatible.wasm"
            model.write_bytes(b"\0asm" + b"fixture")
            destination = base / "runtime"
            original = setup.ROOT
            try:
                setup.ROOT = fake_root
                setup.install_runtime(destination, {"schemaVersion":1,"mode":"local"}, model)
            finally:
                setup.ROOT = original
            self.assertEqual((destination / "vendor/user-model.wasm").read_bytes(), model.read_bytes())
            self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
            self.assertNotIn("compatible.wasm", (destination / "local-config.js").read_text())

    def test_rejects_missing_and_invalid_model_library(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td); fake_root = base / "source"
            (fake_root / "extension/vendor").mkdir(parents=True)
            (fake_root / "extension/manifest.json").write_text('{"version":"test"}')
            model = base / "bad.wasm"; model.write_bytes(b"not wasm")
            original = setup.ROOT
            try:
                setup.ROOT = fake_root
                for value in (None, model):
                    with self.assertRaises(setup.SetupError):
                        setup.install_runtime(base / "runtime", {"mode":"local"}, value)
                    self.assertFalse((base / "runtime").exists())
            finally:
                setup.ROOT = original

if __name__ == "__main__":
    unittest.main()
