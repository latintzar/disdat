# Capture architecture

Dis Dat records a spoken reaction and page facts on one time-correlated timeline across navigation in the initiating tab.

1. `extension/inject-hooks.js` and `inject-main.js` run in the page's main world to observe framework state, listeners, network response shapes and runtime behaviour.
2. `content.js` gathers pointer/interaction evidence, styles, DOM, animations, assets, screenshots and the page context. It relates those facts to the spoken remarks.
3. `background.js` coordinates the session and the offscreen microphone document. Session state survives a Chrome service-worker restart through `chrome.storage.session`.
4. Local mode uses the recovered offscreen Whisper and WebLLM pipeline for transcription and the briefing. Own-key mode uses Deepgram and the selected Groq or Anthropic adapter. Both align spoken words to bounded page facts.
5. Local and own-key modes use `local-delivery.js` to build one JSON bundle. Background sends it to the extension-owned offscreen document, where `private-downloads.js` holds a Blob for Chrome's downloads API. The content script receives an opaque receipt and status for retry. `tools/disdat.py unpack` gives the coding agent separate artifact files.

## Capture boundaries

Microphone startup has explicit pending, recording and failure states. Stop and capture sensors become active after the recorder starts; pending setup can be cancelled. Each offscreen audio attempt has a session ID and generation, so a delayed cancelled stream is retired without replacing a restarted recording. Stop/cancel acknowledgments retain their initiating attempt's identity.

The recording, messages and session recovery belong to the initiating tab and window. The background verifies both identities and the top frame on session mutations and artifact work. Navigation in that tab resumes capture. Closing the tab or moving it to another window ends the recording. Screenshots require the initiating tab to be active in its window before and after capture; a tab activation during capture causes the image to be discarded.

The recorder uses a closed shadow root and disables page selection of its aggregate briefing UI. Copy uses the clipboard API, with an explicit retry on failure. Capture Blob URLs remain in the extension-owned offscreen/background contexts; the page receives the visible overlay host. Downloads use Chrome's downloads API, and a recoverable retry preserves the capture for fifteen minutes. An unavailable extension download stays a local error. Storage and structured network bodies use recursive credential-field redaction before truncation; capture files remain private project material.

## Configuration and account choice

Setup copies the source extension into a private runtime and writes its configuration there. `runtime.js` exposes a credential-free status to content scripts. Credentials remain in the background worker's runtime configuration. The earlier get/set-keys message endpoints were removed from this candidate.

Own-key mode chooses direct provider requests before inspecting a hosted session. Existing hosted auth in Chrome therefore cannot change the selected provider or redirect a capture to the hosted service. Provider errors stay with the selected provider. The candidate makes the hosted telemetry and upload paths conditional on explicit hosted mode.

Local mode loads the operator-supplied model-specific WebAssembly library from the private extension and downloads model weights on first use. Whisper and Qwen execute on the device. It does not route audio or briefing requests through hosted or own-key providers. [Local model setup](local-models.md) documents the binary and hardware boundary.

Own keys still means external model processing: audio goes to Deepgram; the briefing inputs go to the chosen Groq or Anthropic account. Captured assets and source files are delivered locally. The existing page/asset acquisition needed to observe the site remains part of capture.

Hosted mode preserves the original Google/Supabase account flow, Dis Dat provider proxy, owner telemetry and expiring hosted artifact delivery. The hosted server is an existing service dependency; its full source is a separate remaining extraction recorded in RELEASE-STATUS.md.

## Agent interfaces

- `skills/disdat-setup`: install, configure, diagnose and unpack a local capture.
- `skills/disdat`: interpret the facts and the user's intent; includes the existing headless skillify script.
- `mcp/server.py`: query a file/URL/hosted design-token library and export it through the existing MCP tools.

The technical specifications in `docs/original/` preserve the product's original architecture and experiments. They contain historical proposals as well as implementation notes. This document and RELEASE-STATUS.md describe the present candidate.

[Extraction decisions](decisions.md) records the source-beta choices and tradeoffs.
