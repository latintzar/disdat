# Dis Dat source beta

28 October 2026. Initial source beta of the Dis Dat browser client, agent skills, token MCP and website. Peter Neyra's original code uses MIT; third-party material retains its own notices.

## Included

- Current point-and-talk browser extension, with its original sensors and direct provider adapters.
- Own-key CLI setup, masked diagnostics, explicit provider/mode selection and private runtime files.
- Local capture download and agent unpacking.
- Existing capture/skillify skill and script; new setup skill.
- Existing token MCP server and website source.
- Original capture/architecture specifications, source provenance, MIT licence and font notices.

## Deferred source

The original hosted server/auth/billing/capture delivery, Figma plugin, former macOS app and earlier browser prototype remain in the private original repository for separate extraction. Hosted mode uses the existing service. [Export scope](docs/export-scope.md) and PROVENANCE.json record the omitted historical compiled-orb experiment and unused reference demos/media.

## Validation

Local verification:

- Seven CLI tests: private installation/permissions, each provider, masked diagnostics, hosted replacement, malformed bundles, local unpack and public-package credential exclusion/notices.
- Sixteen Node runtime tests: selected providers despite stale hosted auth, telemetry/upload gates, request/response fields, tab/window/frame session boundaries, screenshot rejection, local download receipts, recursive redaction, microphone readiness/failure and cancelled-session isolation.
- Two offline MCP tests: Figma variable values retain their declared numeric/Boolean/color/string JSON types; invalid numeric values are rejected.
- Actual unpacked Chromium extension: own-key onboarding at 1600/390; microphone failure recovery, held start/cancel/quick restart, stale acknowledgment isolation and a real recorder-chunk barrier; same-tab navigation; foreign-tab/screenshot boundaries; closed briefing UI and malicious-page Blob/selection probes; nested storage redaction; two mocked provider requests; extension-owned download and CLI unpack. Page-side and worker checks observed zero owner/upload requests.
- Setup-skill validation; standalone website installation and Vite build; actual root-to-install checks at 1600/390. Agent installation is the primary path, and the legacy macOS binary is excluded. The clean website uses a supported patched Vite toolchain and its locked dependencies report zero npm audit findings on 28 October 2026.

CI is configured for the nine Python tests (seven CLI and two offline MCP), sixteen Node tests and website `npm ci`/build on Python 3.12 and Node 22. A separate Chromium job runs the fake-microphone/privacy/download proof with Playwright 1.58.0 and mocked providers. Official actions use pinned commit SHAs and read-only repository permissions.

## Acceptance limits

The Chromium recording proof used a fake microphone and mocked provider responses. It exercised real extension recording, navigation, privacy boundaries, download and agent unpacking with zero live provider calls. Human microphone/device behaviour, physical-browser microphone/clipboard permissions and selected-account authentication remain untested real-world acceptance checks. These are separate from the passing offline and browser-fixture checks.
