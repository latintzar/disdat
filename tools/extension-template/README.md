# Disdat extension

Unzip this download. In desktop Chrome or Chromium, open chrome://extensions, enable Developer mode and choose Load unpacked. Select this disdat-extension folder.

Click Dis Dat on a page and start recording. Allow microphone access. The first recording downloads Qwen and Whisper from upstream; local inference needs WebGPU and storage for the models. Talk while you point, scroll or navigate in that tab, then Stop. Give your coding agent the briefing and downloaded capture file.

Local setup and upstream versions: https://github.com/latintzar/disdat/blob/main/docs/local-models.md

For optional cloud mode, give your agent https://github.com/latintzar/disdat/blob/main/skills/disdat-setup/SKILL.md. It configures your own Deepgram and Groq or Anthropic accounts through private local input. Hosted mode remains an explicit separate choice.

Source: https://github.com/latintzar/disdat. tools/extension-files.json records reviewed source hashes and provenance. Original code is MIT; third-party runtimes and fonts retain their notices. Model-specific MLC WebAssembly and weights are upstream dependencies, fetched at first use rather than bundled here.
