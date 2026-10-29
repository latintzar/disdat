# Provider configuration

The local CLI prepares an unpacked extension for the selected mode. It uses Python's standard library and POSIX private-file permissions on macOS/Linux.

## Local models

The extension download selects local Qwen/Whisper. From source, run `python3 tools/disdat.py setup --mode local`, then `python3 tools/disdat.py doctor`. The official version-matched runtime and models download when you first start recording. Chrome with WebGPU and model storage is required. [Local model setup](local-models.md) records the exact model/runtime versions, hardware checks and optional `--model-lib` override.

## Own keys

| Selection | Required private variables | Default briefing model |
|---|---|---|
| `--provider groq` | `DEEPGRAM_API_KEY`, `GROQ_API_KEY` | `openai/gpt-oss-20b` |
| `--provider anthropic` | `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |

`--model MODEL_ID` selects another model supported by that provider's existing endpoint. The provider endpoints reuse the original product adapters. [Model support](model-support.md) records the documented default choices and verification date; actual access depends on your provider account.

```sh
python3 tools/disdat.py setup --provider groq --env-file /private/disdat.env
python3 tools/disdat.py doctor
```

The env file must be owned by the current user, a regular file and mode 0600. Use `NAME=value` lines; surrounding single or double quotes are accepted. File values override the corresponding process environment. The parser reads values directly. It executes neither shell commands nor variable expansion.

For a person configuring their own local terminal, `--prompt` asks for missing values with hidden input. Agents should use an existing private input path rather than requesting credentials in a conversation.

Setup writes:

- `$XDG_CONFIG_HOME/disdat/config.json`, normally `~/.config/disdat/config.json`, mode 0600.
- `$XDG_STATE_HOME/disdat/extension`, normally `~/.local/state/disdat/extension`, mode 0700.
- `local-config.js` inside that private extension, mode 0600, for its background worker and extension-owned offscreen document.

Chrome reads the credentials from this private runtime. Keep that directory local. Source packages contain the extension template; each user generates their own runtime. `--config` and `--runtime-dir` select other private paths outside the checkout. Setup replaces only a directory carrying its own runtime marker.

After changing providers or keys, rerun setup and reload the unpacked extension in Chrome. Doctor checks private-file permissions and that the installed configuration matches the saved configuration. Its output contains mode, provider and boolean checks; it makes zero network requests.

## Hosted account

```sh
python3 tools/disdat.py setup --mode hosted
```

Reload the prepared extension and use its existing sign-in. This mode selects Dis Dat's existing hosted account, provider proxy, telemetry and artifact delivery. It retains that service's availability and account requirements.

`SUPA_ANON` in [background.js](../extension/background.js) is a retained public Supabase `anon` client identifier for optional hosted mode. Service-side authorization and data policies control its actual access. Local and own-key modes ignore saved hosted authentication and gates hosted telemetry/uploads.

## Capture files

Local and own-key capture bundles use `disdat.capture/v1`. Unpack into a fresh directory:

```sh
python3 tools/disdat.py unpack /path/to/capture.json --out /private/project/capture
```

The directory is mode 0700 and artifact files are mode 0600. The command accepts the known core, DOM, screenshot, asset and source artifact names and preserves their JSON content. Your agent starts with `core.json` and opens the other files when the task needs them.
