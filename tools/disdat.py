#!/usr/bin/env python3
"""Local setup, diagnostics, artifact unpacking and source packaging for Dis Dat."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ENV_KEYS = ("DEEPGRAM_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY")
DEFAULT_MODELS = {"groq": "openai/gpt-oss-20b", "anthropic": "claude-sonnet-4-6"}
ARTIFACTS = {"core", "dom", "screenshots", "assets", "sources"}
MARKER = "disdat-private-runtime-v1"
PUBLIC_DIRS = ("extension", "skills", "mcp", "docs", "tools", "tests", "website", "licenses", ".github")
PUBLIC_FILES = ("README.md", "AGENTS.md", "PROVENANCE.json", "RELEASE-STATUS.md",
                "disdat.config.example.json", ".env.example", ".gitignore", "LICENSE",
                "LICENSE.md", "NOTICE", "NOTICE.md", "THIRD-PARTY-NOTICES.md")


class SetupError(Exception):
    pass


def paths(args):
    config_root = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    state_root = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state")))
    return (Path(args.config).expanduser() if args.config else config_root / "disdat/config.json",
            Path(args.runtime_dir).expanduser() if args.runtime_dir else state_root / "disdat/extension")


def outside_source(path):
    path = path.absolute()
    if path.is_symlink():
        raise SetupError("Choose a regular private path for runtime configuration.")
    if path.resolve().is_relative_to(ROOT):
        raise SetupError("Choose a runtime/config path outside the source checkout.")
    return path


def write_private(path, content):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".disdat-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_private(path):
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        raise SetupError("Private configuration is unavailable; check its path and permissions.") from None
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise SetupError("Private input must be an owned regular file with mode 0600.")
        return stream.read()


def env_file(path):
    result = {}
    for number, line in enumerate(read_private(path).splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            raise SetupError(f"Expected NAME=value at input line {number}.")
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise SetupError(f"Invalid variable name at input line {number}.")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if name in ENV_KEYS:
            result[name] = value
    return result


def configuration(args):
    if args.mode == "hosted":
        return {"schemaVersion": 1, "mode": "hosted"}
    if args.mode == "local":
        return {"schemaVersion": 1, "mode": "local"}
    if not args.provider:
        raise SetupError("Choose --provider groq or --provider anthropic for own-key mode.")
    supplied = {key: os.environ.get(key, "") for key in ENV_KEYS}
    if args.env_file:
        supplied.update(env_file(Path(args.env_file).expanduser()))
    required = ("DEEPGRAM_API_KEY", "GROQ_API_KEY" if args.provider == "groq" else "ANTHROPIC_API_KEY")
    for key in required:
        if not supplied.get(key) and args.prompt:
            if not sys.stdin.isatty():
                raise SetupError("Hidden input needs a local interactive terminal.")
            supplied[key] = getpass.getpass(key + ": ")
    missing = [key for key in required if not supplied.get(key)]
    if missing:
        raise SetupError("Set private input for: " + ", ".join(missing))
    for key in required:
        value = supplied[key]
        if len(value) < 8 or any(char.isspace() or ord(char) < 32 for char in value):
            raise SetupError("Check the private value for " + key + ".")
    model = args.model or DEFAULT_MODELS[args.provider]
    if not re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", model):
        raise SetupError("Use a provider model identifier for --model.")
    return {"schemaVersion": 1, "mode": "byok", "llmProvider": args.provider,
            "llmModel": model, "deepgramKey": supplied[required[0]], "llmKey": supplied[required[1]]}


def install_runtime(directory, config, model_lib=None):
    if directory.exists():
        marker = directory / ".disdat-runtime.json"
        if not marker.is_file() or marker.is_symlink():
            raise SetupError("Existing runtime directory needs a Dis Dat ownership marker; choose a fresh path.")
        try:
            owned = json.loads(marker.read_text()).get("format") == MARKER
        except (OSError, ValueError):
            owned = False
        if not owned:
            raise SetupError("Existing directory belongs to another runtime; choose a fresh path.")
    directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = Path(tempfile.mkdtemp(prefix=".disdat-runtime-", dir=directory.parent))
    backup = None
    try:
        for source in (ROOT / "extension").rglob("*"):
            relative = source.relative_to(ROOT / "extension")
            if source.is_symlink():
                raise SetupError("Review extension symlinks before preparing a runtime.")
            if source.is_file():
                if source.name in {"local-config.js", "dd-config.js"} or source.name.startswith(".env"):
                    raise SetupError("Private files found in extension source; use a clean checkout.")
                target = temporary / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
        if config["mode"] == "local":
            if model_lib is None:
                raise SetupError("Local mode requires --model-lib with a compatible WebLLM model WASM.")
            source_model = Path(model_lib).expanduser()
            if not source_model.is_file() or source_model.stat().st_size > 100_000_000:
                raise SetupError("Provide a model WASM file under 100 MB.")
            with source_model.open("rb") as stream:
                if stream.read(4) != b"\0asm":
                    raise SetupError("Model library is not a WebAssembly file.")
            shutil.copyfile(source_model, temporary / "vendor" / "user-model.wasm")
        write_private(temporary / "local-config.js", "self.DISDAT_CONFIG = " + json.dumps(config) + ";\n")
        write_private(temporary / ".disdat-runtime.json", json.dumps({"format": MARKER,
                      "source": str(ROOT), "version": json.loads((temporary / "manifest.json").read_text())["version"]}) + "\n")
        if directory.exists():
            backup = directory.parent / (".disdat-old-" + secrets.token_hex(6))
            directory.rename(backup)
        try:
            temporary.rename(directory)
        except OSError:
            if backup is not None:
                backup.rename(directory)
            raise
        if backup is not None:
            shutil.rmtree(backup)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def setup(args):
    config_path, runtime_path = (outside_source(item) for item in paths(args))
    config = configuration(args)
    install_runtime(runtime_path, config, getattr(args, "model_lib", None))
    write_private(config_path, json.dumps(config, indent=2) + "\n")
    print(json.dumps({"mode": config["mode"], "provider": config.get("llmProvider"),
                      "config": str(config_path), "extension": str(runtime_path),
                      "next": "Load this directory in chrome://extensions, then allow microphone access."}, indent=2))


def doctor(args):
    config_path, runtime_path = paths(args)
    config_path, runtime_path = outside_source(config_path), outside_source(runtime_path)
    try:
        config = json.loads(read_private(config_path))
    except (ValueError, TypeError):
        raise SetupError("Run setup to create valid private configuration.") from None
    if not isinstance(config, dict) or config.get("mode") not in {"byok", "hosted", "local"}:
        raise SetupError("Run setup to select a supported runtime mode.")
    if config["mode"] == "byok" and config.get("llmProvider") not in DEFAULT_MODELS:
        raise SetupError("Run setup to select a supported briefing provider.")
    mode = config.get("mode")
    checks = {"mode_selected": mode in {"byok", "hosted", "local"}, "runtime_present": runtime_path.is_dir(),
              "runtime_private": runtime_path.is_dir() and stat.S_IMODE(runtime_path.stat().st_mode) == 0o700}
    if mode == "local":
        model_file = runtime_path / "vendor" / "user-model.wasm"
        checks["model_library_present"] = model_file.is_file()
    if mode == "byok":
        checks.update({"provider_selected": config.get("llmProvider") in DEFAULT_MODELS,
                       "deepgram_key_present": bool(config.get("deepgramKey")),
                       "llm_key_present": bool(config.get("llmKey"))})
    try:
        installed = read_private(runtime_path / "local-config.js")
        expected = "self.DISDAT_CONFIG = " + json.dumps(config) + ";\n"
        checks["runtime_matches_configuration"] = installed == expected
    except SetupError:
        checks["runtime_matches_configuration"] = False
    print(json.dumps({"ok": all(checks.values()), "mode": mode, "provider": config.get("llmProvider"),
                      "checks": checks, "provider_authentication": "not_checked",
                      "browser_permissions": "check_in_browser", "network_calls": 0}, indent=2))
    return 0 if all(checks.values()) else 1


def unpack(args):
    source = Path(args.capture).expanduser()
    try:
        capture = json.loads(source.read_text())
    except (OSError, ValueError):
        raise SetupError("Choose a readable Dis Dat capture JSON file.") from None
    artifacts = capture.get("artifacts") if isinstance(capture, dict) else None
    if not isinstance(capture, dict) or capture.get("format") != "disdat.capture/v1" or not isinstance(artifacts, dict) or "core" not in artifacts:
        raise SetupError("Choose a Dis Dat local capture bundle (disdat.capture/v1).")
    if set(artifacts) - ARTIFACTS:
        raise SetupError("Capture contains an unsupported artifact name.")
    destination = Path(args.out).expanduser() if args.out else source.with_suffix("")
    if destination.exists():
        raise SetupError("Choose a fresh --out directory for the unpacked capture.")
    destination.mkdir(parents=True, mode=0o700)
    for name, value in artifacts.items():
        write_private(destination / (name + ".json"), json.dumps(value, ensure_ascii=False) + "\n")
    write_private(destination / "HANDOFF.md", "# Dis Dat capture\n\nStart with core.json. Load the other artifact files when the task needs them.\n")
    print(json.dumps({"directory": str(destination.absolute()), "artifacts": sorted(artifacts),
                      "start": str((destination / "core.json").absolute())}, indent=2))


def public_sources():
    result = []
    for name in PUBLIC_FILES:
        path = ROOT / name
        if path.is_symlink():
            raise SetupError("Review source symlinks before packaging.")
        if path.is_file():
            result.append(path)
    for pattern in ("LICENSE*", "NOTICE*", "COPYING*", "OFL*", "*.license", "*.LICENSE"):
        for path in ROOT.glob(pattern):
            if path.is_symlink():
                raise SetupError("Review source symlinks before packaging.")
            if path.is_file():
                result.append(path)
    for name in PUBLIC_DIRS:
        for path in (ROOT / name).rglob("*"):
            if any(part in {"node_modules", "dist", "__pycache__", ".git", ".vercel"} for part in path.relative_to(ROOT).parts):
                continue
            if path.is_symlink():
                raise SetupError("Review source symlinks before packaging.")
            if path.is_file():
                if path.name in {"local-config.js", "dd-config.js", "config.json", "user-model.wasm"} or (path.name.startswith(".env") and path.name != ".env.example"):
                    raise SetupError("Private configuration found in source; use a clean checkout before packaging.")
                if path.suffix.lower() in {".dmg", ".pkg", ".exe", ".msi"}:
                    raise SetupError("Review legacy installer binaries before packaging: " + str(path.relative_to(ROOT)))
                result.append(path)
    detectors = [r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", r"sk-ant-[A-Za-z0-9_-]{20,}",
                 r"gsk_[A-Za-z0-9]{20,}", r"AKIA[0-9A-Z]{16}"]
    for path in result:
        if path.suffix in {".js", ".mjs", ".py", ".json", ".md", ".ts", ".tsx", ".html", ".css", ".sh", ".yaml", ".yml"}:
            content = path.read_text(errors="replace")
            for index, pattern in enumerate(detectors):
                if not re.search(pattern, content):
                    continue
                # The recovered, unchanged WebLLM bundle contains five AWS-pattern
                # coincidences inside embedded base64 data. Pin the entire file.
                reviewed_bundle = (index == 3 and path.relative_to(ROOT).as_posix() == "extension/vendor/web-llm.js"
                    and hashlib.sha256(path.read_bytes()).hexdigest() == "4917bf1b8969ca20a0b74b2773cbc9c14f77ce7427df491cd56c252f9a6070c7")
                if not reviewed_bundle:
                    raise SetupError("Credential-like literal found in " + str(path.relative_to(ROOT)) + "; review before packaging.")
    return sorted(set(result))


def package(args):
    output = Path(args.out).expanduser().absolute()
    if output.exists():
        raise SetupError("Choose a fresh output filename for the public source package.")
    if output.is_relative_to(ROOT):
        raise SetupError("Choose a package output outside the source checkout.")
    files = public_sources()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, str(Path("disdat") / path.relative_to(ROOT)))
    print(json.dumps({"path": str(output), "files": len(files), "status": "source_archive"}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("setup", "doctor"):
        command = commands.add_parser(name)
        command.add_argument("--config", help="Private config file outside the checkout")
        command.add_argument("--runtime-dir", help="Private unpacked extension directory outside the checkout")
        command.set_defaults(handler=setup if name == "setup" else doctor)
        if name == "setup":
            command.add_argument("--mode", choices=("byok", "hosted", "local"), default="byok")
            command.add_argument("--model-lib", help="Path to a compatible, operator-supplied WebLLM model WASM")
            command.add_argument("--provider", choices=tuple(DEFAULT_MODELS))
            command.add_argument("--model")
            command.add_argument("--env-file", help="Owned mode-0600 env file (values stay local)")
            command.add_argument("--prompt", action="store_true", help="Ask for missing values with hidden terminal input")
    command = commands.add_parser("unpack")
    command.add_argument("capture")
    command.add_argument("--out")
    command.set_defaults(handler=unpack)
    command = commands.add_parser("package")
    command.add_argument("--out", required=True)
    command.set_defaults(handler=package)
    args = parser.parse_args()
    try:
        return args.handler(args) or 0
    except SetupError as error:
        print("Dis Dat: " + str(error), file=sys.stderr)
        return 2
    except OSError:
        print("Dis Dat: local file operation failed; check paths, ownership and available space.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
