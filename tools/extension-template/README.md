# Dis Dat extension download

This is the original Manifest V3 Chrome extension in unconfigured setup mode. Unzip and load this directory in chrome://extensions with Developer mode → Load unpacked. The extension opens provider setup instructions.

Give your agent https://github.com/latintzar/disdat/blob/main/skills/disdat-setup/SKILL.md. Clone the public source and run `python3 tools/disdat.py setup --provider groq --prompt`, then `python3 tools/disdat.py doctor`. Provider keys use hidden local input and the CLI writes a private extension runtime outside the source tree. Replace this unconfigured extension in Chrome with the private directory printed by setup.

Deepgram transcribes audio. Groq or Anthropic writes the briefing. Own-key captures download locally. Existing hosted mode is an explicit separate setup choice. See https://github.com/latintzar/disdat/blob/main/docs/configuration.md.

Source https://github.com/latintzar/disdat, clean release ae9f30d003819ebbe1b8394d40b37d076073056a. Original capture source remains MIT; notices and font licences travel with this download. The public local-config.js sets setup mode and contains no account/provider values.
