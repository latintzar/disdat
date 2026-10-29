# Third-party notices

The MIT licence covers Peter Neyra's original code. Existing dependency, font and asset rights retain their owners.

| Included material | Notice |
|---|---|
| `extension/fonts/inter.woff2` | Copyright 2016 The Inter Project Authors; SIL Open Font License 1.1. See `licenses/Inter-OFL.txt`. |
| `extension/fonts/fraunces.woff2` | Embedded metadata: Copyright 2020 The Fraunces Project Authors; SIL Open Font License 1.1. The upstream licence also retains its 2018 copyright line. See `licenses/Fraunces-OFL.txt`. |
| Website Inter, Fraunces, JetBrains Mono and IBM Plex Mono fonts | SIL Open Font License 1.1. Original licence texts travel with the WOFF2 files in `website/public/assets/fonts/`; source records are in `docs/site-provenance/fonts.json`. |
| Agent/provider logos and other third-party marks | Their respective owners. Preserved for existing product identification. The original-code MIT licence preserves those owners' rights. |
| Website dependencies | Declared in `website/package.json` and its lockfile; the installed packages supply their own licences. |
| Capture skill's headless script | Uses Playwright; its dependency retains its own licence. |

Font names/copyright and licence URLs were checked from the included WOFF2 metadata. Licence text sources:

- Inter: https://github.com/rsms/inter/blob/master/LICENSE.txt
- Fraunces: https://github.com/undercasetype/Fraunces/blob/master/OFL.txt
- JetBrains Mono: https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt
- IBM Plex Mono: https://github.com/IBM/plex/blob/master/LICENSE.txt

Original source and retained files are listed in PROVENANCE.json. This notice does not assign a software licence to third-party trademarks, captured website content or user-provided media.

The historical compiled ElevenLabs orb engine/texture and unused stock/Apple reference media are excluded from this source export. [Export scope](docs/export-scope.md) records the exact omitted material preserved in the private original.


## Local inference dependencies

The recovered `extension/vendor/` files derive from Dis Dat v0.6.1 (monorepo commit `7a587a7fd4e72772d98d4d7a6b8413a469809244`). The original commit identifies WebLLM 0.2.84; the bundles identify Transformers.js 4.2.0 and ONNX Runtime Web 1.26.0-dev.20260416-b7804b056c. WebLLM and Transformers.js are Apache-2.0; ONNX Runtime Web is MIT. The WebLLM bundle contains a loglevel MIT notice and other embedded notices; retain them. See `licenses/Apache-2.0.txt`, `licenses/ONNXRuntime-MIT.txt`, and `licenses/loglevel-MIT.txt`.

The model-specific WebAssembly library and model weights are supplied independently and are not distributed here. Their upstream terms and provenance are separate; see `docs/local-models.md`.

The ONNX Runtime Web asyncify module and WebAssembly binary are from the same 1.26.0-dev.20260416-b7804b056c official npm package as the recovered JSEP pair. Its tarball integrity and exact file hashes are recorded in extension/vendor/onnxruntime-assets.json (vendor/onnxruntime-assets.json in the extension download). They retain ONNX Runtime's MIT notice. This pair closes the actual Whisper WASM backend dependency.
