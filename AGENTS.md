# Working on Dis Dat

Start with README.md, docs/architecture.md and RELEASE-STATUS.md. PROVENANCE.json identifies the source snapshot and relocated paths.

For installation or provider configuration, use skills/disdat-setup/SKILL.md. For processing a recorded page, use skills/disdat/SKILL.md.

Runtime files and provider credentials belong outside this checkout. Setup takes private environment variables, an owned mode-0600 env file or hidden terminal input. Doctor reports configuration checks and makes zero provider calls. A doctor pass establishes local setup; live provider authentication and browser permissions have their own checks.

Own-key mode uses its selected provider even if Chrome retains a hosted session. It keeps artifacts local and disables the existing hosted telemetry and upload path. Preserve those boundaries when changing capture or provider code. Hosted mode remains an explicit alternative.

Validate changes with:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/runtime.test.cjs
```

With Playwright and Chromium installed, `python3 tests/browser_extension.py` loads the real extension and records a fake microphone. It checks same-tab navigation, foreign-tab exclusion, inactive screenshot handling, closed-overlay and Blob privacy, recursive storage redaction, extension-owned download and agent unpack using mocked provider HTTP. Tests use synthetic captures and make zero live provider calls. Live provider calls incur the user's own usage and require their selected account.

Package source with `python3 tools/disdat.py package --out /private/disdat-source.zip`. Packaging includes notices and rejects private configuration found in the selected source. A successful package check is one part of release review; RELEASE-STATUS.md retains the wider scope.
