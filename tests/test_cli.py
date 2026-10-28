import importlib.util
import json
import os
from pathlib import Path
import shutil
import secrets
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "tools/disdat.py"


class LocalSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.environment = os.environ.copy()
        for key in ("DEEPGRAM_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY"):
            self.environment.pop(key, None)
        self.environment.update(XDG_CONFIG_HOME=str(self.base / "config"), XDG_STATE_HOME=str(self.base / "state"))
        self.values = {"DEEPGRAM_API_KEY": "private-deepgram-" + secrets.token_hex(16), "GROQ_API_KEY": "private-groq-" + secrets.token_hex(16),
                       "ANTHROPIC_API_KEY": "private-anthropic-" + secrets.token_hex(16)}

    def tearDown(self):
        self.temporary.cleanup()

    def run_cli(self, *arguments, env=None):
        result = subprocess.run([sys.executable, str(CLI), *arguments], text=True,
                                capture_output=True, env=env or self.environment)
        for value in self.values.values():
            self.assertNotIn(value, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        return result

    def setup(self, provider="groq"):
        environment = self.environment | self.values
        result = self.run_cli("setup", "--provider", provider, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_private_install_and_masked_doctor_for_each_provider(self):
        for provider in ("groq", "anthropic"):
            with self.subTest(provider=provider):
                result = self.setup(provider)
                config, runtime = Path(result["config"]), Path(result["extension"])
                self.assertFalse(runtime.is_relative_to(ROOT))
                self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE((runtime / "local-config.js").stat().st_mode), 0o600)
                saved = json.loads(config.read_text())
                self.assertEqual(saved["llmProvider"], provider)
                expected = self.values["GROQ_API_KEY" if provider == "groq" else "ANTHROPIC_API_KEY"]
                self.assertEqual(saved["llmKey"], expected)
                report = self.run_cli("doctor")
                self.assertEqual(report.returncode, 0, report.stderr)
                self.assertEqual(json.loads(report.stdout)["network_calls"], 0)

    def test_missing_credentials_do_not_create_an_install(self):
        result = self.run_cli("setup", "--provider", "groq")
        self.assertEqual(result.returncode, 2)
        self.assertIn("DEEPGRAM_API_KEY", result.stderr)
        self.assertFalse((self.base / "state/disdat/extension").exists())

    def test_env_file_permissions_and_file_values_override_environment(self):
        path = self.base / "private.env"
        path.write_text("DEEPGRAM_API_KEY=" + self.values["DEEPGRAM_API_KEY"] + "\nGROQ_API_KEY=" + self.values["GROQ_API_KEY"] + "\n")
        path.chmod(0o644)
        self.assertEqual(self.run_cli("setup", "--provider", "groq", "--env-file", str(path)).returncode, 2)
        path.chmod(0o600)
        self.assertEqual(self.run_cli("setup", "--provider", "groq", "--env-file", str(path)).returncode, 0)
        alias = self.base / "alias.env"
        alias.symlink_to(path)
        self.assertEqual(self.run_cli("setup", "--provider", "groq", "--env-file", str(alias)).returncode, 2)

    def test_hosted_selection_replaces_own_key_material_in_private_runtime(self):
        self.setup()
        result = self.run_cli("setup", "--mode", "hosted")
        self.assertEqual(result.returncode, 0, result.stderr)
        installed = Path(json.loads(result.stdout)["extension"]) / "local-config.js"
        for value in self.values.values():
            self.assertNotIn(value, installed.read_text())
        self.assertEqual(self.run_cli("doctor").returncode, 0)

    def test_existing_unowned_directory_is_preserved(self):
        runtime = self.base / "state/disdat/extension"
        runtime.mkdir(parents=True)
        (runtime / "keep.txt").write_text("existing user content")
        result = self.run_cli("setup", "--provider", "groq", env=self.environment | self.values)
        self.assertEqual(result.returncode, 2)
        self.assertEqual((runtime / "keep.txt").read_text(), "existing user content")

    def test_local_bundle_unpack_and_malformed_inputs(self):
        source = self.base / "capture.json"
        source.write_text(json.dumps({"format": "disdat.capture/v1", "artifacts": {"core": {"text": "actual facts"}, "dom": {"html": "<main>capture</main>"}}}))
        result = self.run_cli("unpack", str(source))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.base / "capture/core.json").read_text())["text"], "actual facts")
        self.assertEqual(stat.S_IMODE((self.base / "capture/core.json").stat().st_mode), 0o600)
        for malformed in ([], 1, None, "capture", {}, {"format": "disdat.capture/v1", "artifacts": {"core": {}, "../leak": {}}}):
            with self.subTest(type=type(malformed).__name__):
                source.write_text(json.dumps(malformed))
                self.assertEqual(self.run_cli("unpack", str(source), "--out", str(self.base / "bad")).returncode, 2)
                self.assertFalse((self.base / "bad").exists())

    def test_public_package_excludes_private_runtime_and_retains_notices(self):
        self.setup()
        sandbox = self.base / "source"
        shutil.copytree(ROOT, sandbox, ignore=shutil.ignore_patterns("node_modules", "dist", "__pycache__"))
        (sandbox / "NOTICE").write_text("Third-party attribution\n")
        (sandbox / "LICENSE").write_text("Test-only licence fixture\n")
        output = self.base / "public.zip"
        result = subprocess.run([sys.executable, str(sandbox / "tools/disdat.py"), "package", "--out", str(output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(output) as archive:
            self.assertIn("disdat/NOTICE", archive.namelist())
            self.assertIn("disdat/LICENSE", archive.namelist())
            for name in archive.namelist():
                self.assertNotIn("local-config.js", name)
                for value in self.values.values():
                    self.assertNotIn(value.encode(), archive.read(name))
        (sandbox / "extension/local-config.js").write_text("private local configuration")
        result = subprocess.run([sys.executable, str(sandbox / "tools/disdat.py"), "package", "--out", str(self.base / "blocked.zip")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.base / "blocked.zip").exists())
        (sandbox / "extension/local-config.js").unlink()
        (sandbox / "website").mkdir(exist_ok=True)
        (sandbox / "website/legacy.dmg").write_bytes(b"legacy installer")
        result = subprocess.run([sys.executable, str(sandbox / "tools/disdat.py"), "package", "--out", str(self.base / "blocked-installer.zip")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.base / "blocked-installer.zip").exists())


if __name__ == "__main__":
    unittest.main()
