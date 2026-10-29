# Extension download

The public ZIP contains the original Chrome extension with local Qwen and Whisper selected. Unzip it and load disdat-extension through chrome://extensions → Developer mode → Load unpacked. First recording downloads the upstream model library and weights. [Local model setup](local-models.md) covers WebGPU, storage, versions and the optional custom library. [The setup skill](../skills/disdat-setup/SKILL.md) configures source installs or optional own-key cloud mode.

Reproduce the download with Python 3.10+, from a checkout or source archive:

```sh
python3 tools/package-extension.py --output /tmp/disdat-extension.zip
```

The output contains 46 files under disdat-extension/. SHA-256:

```text
bd24440de1de8ea35830e5354cfb30eafcb19f3301ee32acf1a3bac0b1e727fb
```

tools/extension-files.json pins every runtime and template file to reviewed hashes, with source commit 81710491ff1cfbbd7282f63ab33756230df61e1a and separate original-inference provenance. The download contains the JavaScript runtimes, licensed ONNX runtime WASM, MIT notice, dependency/font notices and a local-mode configuration. Model-specific MLC WebAssembly and weights remain upstream dependencies.

The packager checks every input hash and final ZIP hash, sorts paths and fixes metadata. It rejects links, changed inputs and existing output paths. Only reviewed paths enter the download; private runtime files and custom model libraries stay outside its allowlist.

For an extension update, review the code, templates and notices together, refresh the file manifest and archive hash, then run the package tests. tools/disdat.py package exports the wider source, skills, website and tests.

The exact ZIP above also passed real extension-origin Qwen and Whisper inference on Mac Chrome for Testing 156. The hardware and capture-test boundaries are recorded in [release status](../RELEASE-STATUS.md).
