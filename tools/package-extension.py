#!/usr/bin/env python3
"""Reproduce the local-mode extension download from reviewed source files."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DATE = (2026, 10, 28, 0, 0, 0)


class PackageError(Exception):
    pass


def reviewed_file(root, name, expected):
    relative = PurePosixPath(name)
    if relative.is_absolute() or '..' in relative.parts or '\\' in name:
        raise PackageError('Invalid reviewed source path.')
    path = root.joinpath(*relative.parts)
    if any(p.is_symlink() for p in (path, *path.parents)) or not path.is_file():
        raise PackageError('Missing or linked reviewed source: ' + name)
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected:
        raise PackageError('Reviewed source changed: ' + name)
    return content


def package(output, root=ROOT):
    root = Path(root).resolve()
    output = Path(output).expanduser().absolute()
    if output.exists() or output.is_symlink():
        raise PackageError('Choose a fresh output filename.')
    if output.resolve().is_relative_to(root):
        raise PackageError('Choose an output outside the source checkout.')
    lock = json.loads((root / 'tools/extension-files.json').read_text())
    members = {name: reviewed_file(root / 'extension', name, expected)
               for name, expected in lock['files'].items()}
    for name, expected in lock['template_files'].items():
        target = 'local-config.js' if name == 'local-config.template.js' else name
        members[target] = reviewed_file(root / 'tools/extension-template', name, expected)
    version = json.loads(members['manifest.json'])['version']
    if version != lock['manifest_version']:
        raise PackageError('Review the extension version before packaging.')
    output.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            created = True
            for name, content in sorted(members.items()):
                info = zipfile.ZipInfo('disdat-extension/' + name, DATE)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, content)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        if digest != lock['zip_sha256']:
            raise PackageError('Archive differs from the reviewed extension download.')
    except BaseException:
        if created:
            output.unlink(missing_ok=True)
        raise
    return {'files': len(members), 'sha256': digest, 'version': version,
            'configuration': 'local', 'source_commit': lock['source_commit']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='Fresh ZIP path outside this checkout')
    args = parser.parse_args()
    try:
        print(json.dumps(package(args.output), indent=2))
    except (PackageError, OSError, KeyError, ValueError, zipfile.BadZipFile) as error:
        # Never echo config contents or arbitrary exception values.
        print(str(error) if isinstance(error, PackageError) else 'Check the reviewed source and output path.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
