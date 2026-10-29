# Dis Dat source beta

28 October 2026. Initial source beta of the Dis Dat browser client, agent skills, token MCP and website. Peter Neyra's original code uses MIT; third-party material retains its own notices.

## Included

- Current point-and-talk browser extension, with its original sensors and direct provider adapters.
- Own-key CLI setup, masked diagnostics, explicit provider/mode selection and private runtime files.
- Local capture download and agent unpacking.
- Existing capture/skillify skill and script; new setup skill.
- Existing token MCP server and website source.
- Approved Disdat.dev Home/Download components, bundled OFL fonts and a portable packager that reproduces the released local-mode extension ZIP exactly.
- Original capture/architecture specifications, source provenance, MIT licence and font notices.

## Deferred source

The recovered hosted server, Figma plugin and native macOS sources are included as described below; their live integration and distribution acceptance remain separate. Hosted mode uses the existing service. [Export scope](docs/export-scope.md) and PROVENANCE.json record the omitted historical compiled-orb experiment and unused reference demos/media.

## Validation

Local verification:

- Seven CLI tests: private installation/permissions, each provider, masked diagnostics, hosted replacement, malformed bundles, local unpack and public-package credential exclusion/notices.
- Sixteen extension Node runtime tests: selected providers despite stale hosted auth, telemetry/upload gates, request/response fields, tab/window/frame session boundaries, screenshot rejection, local download receipts, recursive redaction, microphone readiness/failure and cancelled-session isolation.
- Two offline MCP tests: Figma variable values retain their declared numeric/Boolean/color/string JSON types; invalid numeric values are rejected.
- Actual unpacked Chromium extension: own-key onboarding at 1600/390; microphone failure recovery, held start/cancel/quick restart, stale acknowledgment isolation and a real recorder-chunk barrier; same-tab navigation; foreign-tab/screenshot boundaries; closed briefing UI and malicious-page Blob/selection probes; nested storage redaction; two mocked provider requests; extension-owned download and CLI unpack. Page-side and worker checks observed zero owner/upload requests.
- Four installer tests verify exact repeatable ZIP bytes/notices, exclusion of private extras, rejection of changed sources/symlinks and overwrite protection; the full source archive reproduces the installer too. Three website configuration tests cover blank/partial/recipient settings, URL boundaries and rejection of privileged Supabase keys.
- Setup-skill validation; standalone website installation and Vite build; actual root-to-install checks at 1600/390. Agent installation is the primary path, and the legacy macOS binary is excluded. The approved Home/Download React components build through ordinary Vite with self-hosted OFL fonts. The clean website uses a supported patched Vite toolchain and its locked dependencies report zero npm audit findings on 28 October 2026.
- Portable website update: TypeScript passes; actual Chromium checks 20 page/viewport combinations (1600/390), with zero external requests, missing resources, page errors or horizontal overflow. Library JSON download and its default chat setup state pass. A synthetic privileged Supabase key fails the build before output, with its value omitted from diagnostics.

CI is configured for thirteen Python tests (seven CLI, two offline MCP and four installer-package tests), nineteen Node tests (sixteen extension runtime and three hosted-configuration tests) and website `npm ci`/build on Python 3.12 and Node 22. A separate Chromium job runs the fake-microphone/privacy/download proof with Playwright 1.58.0 and mocked providers. Official actions use pinned commit SHAs and read-only repository permissions.

## Acceptance limits

The Chromium recording proof used a fake microphone and mocked provider responses. It exercised real extension recording, navigation, privacy boundaries, download and agent unpacking with zero live provider calls. Human microphone/device behaviour, physical-browser microphone/clipboard permissions and selected-account authentication remain untested real-world acceptance checks. These are separate from the passing offline and browser-fixture checks.


## Local inference recovery

The original WebLLM and Whisper implementation has been reconnected as a separate local runtime mode. The convenience download selects local mode and uses WebLLM's official version-matched upstream model library. First recording downloads that library and Qwen/Whisper weights; --model-lib remains an optional private override. Local adapter, privacy and setup tests use mocks. Real GPU inference and transcription quality remain unverified; see `docs/local-models.md` for provenance, licenses and setup.

## Figma importer recovery

The original token-to-Variables plugin is available in `figma-plugin/` with an operator-configurable library origin. DTCG conversion has an offline test. Live Figma and server integration remain unverified.

## Native macOS recovery

The later native recorder and earlier SmartCapture prototype are available under `native/macos/`. They use operator-configured endpoints and separate app identifiers; automatic updates and crash uploads are disabled. CI typechecks the recorder source and builds the older prototype. Physical Mac capture, sign-in, uploads and distribution signing remain unverified.

## Hosted backend recovery

The original backend modules are retained under `legacy/server/` with operator-specific origins and paths replaced and default startup disabled. The capture proxy refuses redirects. This is development and migration source; wider server security and live provider, billing and Figma integration are unverified.
