# Local voice and briefing models

Disdat runs Whisper in the extension's offscreen document and Qwen through WebLLM on the device's WebGPU. The implementation is recovered from the original v0.6.1 snapshot 7a587a7fd4e72772d98d4d7a6b8413a469809244. Bundled runtime code uses WebLLM 0.2.84, Transformers.js 4.2.0 and ONNX Runtime Web 1.26.0-dev.20260416-b7804b056c, with their own notices.

## Start

The extension download already selects local mode. Unzip it, load disdat-extension through chrome://extensions → Developer mode → Load unpacked, allow microphone access and start recording.

From source, prepare a private runtime with Python 3.10+:

```sh
python3 tools/disdat.py setup --mode local
python3 tools/disdat.py doctor
```

Load the extension directory printed by setup. Local mode requires Chrome/Chromium with WebGPU, shader-f16 support, sufficient GPU memory and storage. The selected upstream Qwen configuration estimates 1,629.75 MB VRAM; the browser and page need additional memory. First recording downloads the model-specific WebAssembly library and Qwen/Whisper weights from their upstream hosts. Subsequent use reuses the browser's model cache. Download and startup time depend on the device and connection.

Whisper uses onnx-community/whisper-base_timestamped with English transcription and word timestamps, WASM and q8 weights. Qwen uses Qwen2.5-1.5B-Instruct-q4f16_1-MLC with a 4,096-token context. Words are aligned to the recorded page context. Audio and briefing inference run on the device. Capture artifacts save locally. A local model failure retains captured page facts and reports the error.

## Upstream runtime

Verified 29 October 2026 against the npm 0.2.84 package's exact [WebLLM source configuration](https://github.com/mlc-ai/web-llm/blob/9e572d6ed95e248f29634996cd32cc8f3023d89d/src/config.ts). The selected prebuilt record is preserved, including its Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm library under upstream v0_2_84/base. The Qwen2 library filename is the upstream record for this Qwen2.5 model.

[WebLLM's loading guide](https://webllm.mlc.ai/docs/user/basic_usage.html) describes asynchronous CreateMLCEngine initialization and model downloads; its [advanced guide](https://webllm.mlc.ai/docs/user/advanced_usage.html) covers Chrome extensions and browser caching. The upstream runtime is fetched as a dependency at first use. This download contains the JavaScript loader and licensed ONNX runtime, while the model-specific MLC binary and weights stay upstream. Their terms remain separate from this project's MIT code. The binary repository's reviewed metadata did not declare a licence; this project makes no redistribution grant for that upstream file.

For a compatible library you build or control, an optional private override replaces only the model library URL:

```sh
python3 tools/disdat.py setup --mode local --model-lib /private/path/to/model.wasm
```

Setup checks the WebAssembly header and size, then copies it into the private extension's vendor/user-model.wasm. The public source and download exclude that private file. doctor checks the selected configuration and private file presence, with zero model or provider requests.

The base [Qwen model](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) and [Whisper model](https://huggingface.co/openai/whisper-base) identify Apache-2.0 in their model metadata. Converted model artifacts retain their upstream provenance and terms.

## Verification

Offline tests verify the unchanged upstream model record, explicit custom override, WebGPU guard, private setup and word timestamp handoff. The browser capture proof uses a fake microphone and mocked cloud providers. Real local GPU inference and physical-microphone transcription remain separate hardware acceptance checks.
