# Dis Dat extension download

This is the original Manifest V3 Chrome extension in unconfigured setup mode. Unzip and load this directory in chrome://extensions with Developer mode → Load unpacked. The extension opens provider setup instructions.

Give your agent https://github.com/latintzar/disdat/blob/main/skills/disdat-setup/SKILL.md. Clone the public source and run `python3 tools/disdat.py setup --provider groq --prompt`, then `python3 tools/disdat.py doctor`. Provider keys use hidden local input and the CLI writes a private extension runtime outside the source tree. Replace this unconfigured extension in Chrome with the private directory printed by setup.

Local mode uses the recovered Whisper and WebLLM stack with an operator-supplied compatible model WASM. See https://github.com/latintzar/disdat/blob/main/docs/local-models.md for the binary and first-download boundary. Deepgram transcribes audio in own-key mode. Groq or Anthropic writes the briefing. Own-key captures download locally. Existing hosted mode is an explicit separate setup choice. See https://github.com/latintzar/disdat/blob/main/docs/configuration.md.

Source https://github.com/latintzar/disdat, reviewed source and historical inference provenance recorded in tools/extension-files.json. Original capture source remains MIT; notices and font licences travel with this download. The public local-config.js sets setup mode and contains no account/provider values.
