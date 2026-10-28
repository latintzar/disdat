# Disdat is a browser extension for coding agents.

Point and talk while it records the DOM, styles, framework state, motion and runtime events you are looking at.

Use your own Deepgram key for transcription and choose Groq or Anthropic for the written briefing. Your capture saves as a local JSON file that the agent can unpack and read.

![Dis Dat website demonstration](docs/assets/point-and-talk-1000.png)

[Website demonstration.](docs/assets/README.md)

## Install with your agent

[Download the extension](https://github.com/latintzar/disdat/releases/latest/download/disdat-extension.zip) · [Website](https://disdat.dev)

Requirements: Python 3.10+ on macOS or Linux, and desktop Chrome or Chromium. Give your agent this checkout and the [setup skill](skills/disdat-setup/SKILL.md).

With your provider keys already in a private environment:

```sh
python3 tools/disdat.py setup --provider groq
python3 tools/disdat.py doctor
```

Use `--provider anthropic` to select Anthropic. Keys can also come from `--env-file /private/disdat.env` or hidden local input with `--prompt`. [Configuration](docs/configuration.md) lists the variables and storage locations.

Load the extension directory printed by setup through `chrome://extensions` → Developer mode → Load unpacked. Allow microphone access at the first recording. These browser permissions remain under your control.

## Record and use a capture

1. Open a page, click Dis Dat or press **Alt+Shift+D**, and start recording. Capture follows navigation in that tab; screenshots pause while another tab is active.
2. When **Stop** appears, talk while you point, hover, scroll and move between pages. Stop when you finish.
3. The browser downloads `disdat-capture-*.json`. Paste the copied briefing into your coding agent.
4. The agent unpacks the file and starts with `core.json`:

```sh
python3 tools/disdat.py unpack /path/to/Downloads/disdat-capture-EXAMPLE.json
```

The [capture skill](skills/disdat/SKILL.md) explains the artifact format and how to work from captured facts. The core includes the transcript and engaged elements; the other artifacts hold captured DOM, screenshots, assets and sources. Capture files can contain private page content, so keep them with the project they belong to.

## Runtime modes

| Mode | Transcription and briefing | Artifact delivery |
|---|---|---|
| Own keys | Direct Deepgram plus your selected Groq or Anthropic account | Local browser download |
| Hosted | Existing Dis Dat sign-in and hosted provider proxy | Existing hosted artifact workflow |

Choose the existing hosted path explicitly with `python3 tools/disdat.py setup --mode hosted`. Provider usage follows the selected account's terms and billing. [Architecture](docs/architecture.md) explains the data flow; [extraction decisions](docs/decisions.md) explain the tradeoffs.

## Other tools

- [Token MCP](mcp/README.md): let an agent query a local token library, export CSS/DTCG or use the existing optional Figma path.
- [Website source](website/README.md): the Dis Dat home page, download page and product demonstrations.
- [Extension packaging](docs/extension-download.md): reproduce the exact unconfigured download from reviewed source files.
- [Release status](RELEASE-STATUS.md): included source, validation and remaining work.
- [Provenance](PROVENANCE.json): exact original source commit and copied files.
- [Export scope](docs/export-scope.md): retained source and historical experiments preserved privately.

Original code is [MIT licensed](LICENSE). Fonts and dependencies retain their [own licences and notices](THIRD-PARTY-NOTICES.md).
