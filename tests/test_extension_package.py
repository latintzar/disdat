import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('extension_package', ROOT / 'tools/package-extension.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class ExtensionPackageTests(unittest.TestCase):
    def test_exact_reproducible_unconfigured_download(self):
        with tempfile.TemporaryDirectory() as temporary:
            a, b = [Path(temporary) / name for name in ('a.zip', 'b.zip')]
            receipt = packager.package(a)
            packager.package(b)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(receipt['sha256'], json.loads((ROOT / 'tools/extension-files.json').read_text())['zip_sha256'])
            with zipfile.ZipFile(a) as archive:
                lock = json.loads((ROOT / 'tools/extension-files.json').read_text())
                expected = set(lock['files']) | {('local-config.js' if n == 'local-config.template.js' else n) for n in lock['template_files']}
                self.assertEqual(len(archive.namelist()), len(expected))
                self.assertRegex(archive.read('disdat-extension/local-config.js'), rb'mode:[\x22\x27]setup[\x22\x27]')
                for name in ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'licenses/Inter-OFL.txt', 'licenses/Fraunces-OFL.txt']:
                    self.assertIn('disdat-extension/' + name, archive.namelist())

    def test_private_extras_are_ignored_but_reviewed_changes_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / 'source'
            shutil.copytree(ROOT / 'extension', root / 'extension')
            shutil.copytree(ROOT / 'tools/extension-template', root / 'tools/extension-template')
            shutil.copy2(ROOT / 'tools/extension-files.json', root / 'tools/extension-files.json')
            (root / 'extension/local-config.js').write_text('PRIVATE SENTINEL')
            (root / 'extension/.env').write_text('PRIVATE SENTINEL')
            out = base / 'clean.zip'
            packager.package(out, root)
            with zipfile.ZipFile(out) as archive:
                self.assertNotIn('disdat-extension/.env', archive.namelist())
                self.assertNotIn(b'PRIVATE SENTINEL', archive.read('disdat-extension/local-config.js'))
            (root / 'extension/background.js').write_text('unexpected change')
            with self.assertRaises(packager.PackageError):
                packager.package(base / 'changed.zip', root)
            self.assertFalse((base / 'changed.zip').exists())

    def test_symlinks_and_overwrite_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            (base / 'target').write_text('example')
            (base / 'link').symlink_to(base / 'target')
            with self.assertRaises(packager.PackageError):
                packager.reviewed_file(base, 'link', '')
            with self.assertRaises(packager.PackageError):
                packager.reviewed_file(base, '../target', '')
            with self.assertRaises(packager.PackageError):
                packager.package(base / 'target')
            self.assertEqual((base / 'target').read_text(), 'example')

    def test_full_source_archive_contains_a_working_installer_packager(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source = base / 'source.zip'
            subprocess.run([sys.executable, str(ROOT / 'tools/disdat.py'), 'package', '--out', str(source)],
                           check=True, capture_output=True, text=True)
            with zipfile.ZipFile(source) as archive:
                archive.extractall(base / 'unpacked')
                self.assertIn('disdat/.github/workflows/check.yml', archive.namelist())
                self.assertIn('disdat/website/.env.example', archive.namelist())
            script = base / 'unpacked/disdat/tools/package-extension.py'
            result = subprocess.run([sys.executable, str(script), '--output', str(base / 'extension.zip')],
                                    check=True, capture_output=True, text=True)
            self.assertEqual(json.loads(result.stdout)['configuration'], 'unconfigured')


if __name__ == '__main__':
    unittest.main()
