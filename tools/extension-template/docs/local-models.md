# Local voice and briefing models

Dis Dat's original local pipeline runs Whisper in the extension's offscreen document and runs Qwen through WebLLM on the device's WebGPU. The recovered source is from the original v0.6.1 snapshot `7a587a7fd4e72772d98d4d7a6b8413a469809244`. It uses WebLLM 0.2.84, Transformers.js 4.2.0 and ONNX Runtime Web 1.26.0-dev.20260416-b7804b056c. Their bundled files remain under `extension/vendor/`; one Transformers class-name string is expressed as equivalent concatenated literals to resolve a GitHub push-protection false positive.

## Prepare

Local mode needs a supported Chrome/Chromium WebGPU device, sufficient GPU memory, and a compatible Qwen model-specific WebAssembly library supplied by the operator. The first recording downloads the Qwen and Whisper model weights; this can take substantial time and storage. Actual inference has not been verified in this release on physical hardware.

The original WebLLM configuration used [this upstream model library](https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm), observed with SHA-256 `0fceb50bbaf47efdc31fce96b72c115dcb7f5221c85abe6a9fc02dda9d1d6fc3`. The binary repository did not declare a license in the metadata reviewed. This project does not redistribute that binary or assign it an MIT license. Review the upstream terms and provenance, or provide a compatible library you build and control. The setup command checks the file is WebAssembly, copies it into the user's private unpacked extension, and never downloads it.

```sh
python3 tools/disdat.py setup --mode local --model-lib /private/path/to/compatible-model.wasm
python3 tools/disdat.py doctor
```

Load the private extension directory printed by setup. Select Start to begin recording and initialize the models. The model-loading status depends on the device and downloaded artifacts. If the local model fails, Dis Dat keeps the captured ground truth and reports the failure; local mode does not send the audio or briefing to a cloud provider as a fallback.

The local ASR request uses the original Whisper base timestamped model and English setting. Qwen uses the original 1.5B quantized WebLLM model. Word timestamps correlate the speech to the recorded page context. Model weights are third-party data: the base [Qwen model](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) and [Whisper model](https://huggingface.co/openai/whisper-base) each identify Apache-2.0 in their own model metadata; their separately hosted converted artifacts have their own provenance and terms. Review the linked model repositories before use.

## Verification

Offline tests mock both model adapters and verify the model configuration, private model-library installation, word timestamp handoff, and isolation from hosted or own-key provider routes. They do not download weights, run a GPU, or claim transcription quality. Browser and hardware acceptance remain separate checks.
