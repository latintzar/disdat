# Extension download

The public download is the original Chrome extension in setup mode. Its keys are configured locally by the [setup skill](../skills/disdat-setup/SKILL.md), and own-key captures download locally.

Reproduce the current release with Python 3.10+, from any checkout or source archive:

```sh
python3 tools/package-extension.py --output /tmp/disdat-extension.zip
```

The output contains 32 files under `disdat-extension/`. SHA-256:

```text
cc21586ee000ba265c99ba4af95622c4d9cfeb84c01b5271f8f3fdfbd43aa4c4
```

`tools/extension-files.json` pins the 27 original extension files at source commit `ae9f30d003819ebbe1b8394d40b37d076073056a`. `tools/extension-template/` supplies the download README, MIT licence, font notices and a setup-only configuration. The packager verifies every input hash and final ZIP hash, uses sorted paths/fixed metadata, and rejects links, changed reviewed inputs and existing output paths. Extra local files, including private runtime configuration, are outside its file allowlist. It always supplies its own blank setup configuration.

To change the download, review the changed source and installer templates together, update the manifest and expected archive hash, then run the packaging tests. Keep provider values in the private runtime written by `tools/disdat.py setup`. The installer download and the full source archive serve different purposes; `tools/disdat.py package` exports the source, skills, website and tests.
