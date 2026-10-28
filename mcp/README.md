# Design-token MCP

Let a coding agent read a design-token library, export CSS or DTCG JSON, and use the existing optional Figma adapter. The server runs with Python 3 and its standard library.

## Install

Export a token library from the included `website/public/tokens-lab.html`, then point your agent's MCP configuration at that local file:

```json
{
  "mcpServers": {
    "disdat-tokens": {
      "command": "python3",
      "args": ["/absolute/path/to/disdat/mcp/server.py"],
      "env": {
        "DISDAT_TOKENS_FILE": "/absolute/path/to/tokens.json"
      }
    }
  }
}
```

Ask the agent to list your tokens or build from a named token group. The default sample provides a small library for trying the tools.

## Tools

| Tool | Result |
|---|---|
| `list_tokens` | Token names, values and types |
| `get_token` | One token, with close-name suggestions |
| `export_css` | CSS custom properties |
| `export_dtcg` | Design Tokens Community Group JSON |
| `export_figma` | Token export and Figma import guidance |
| `push_to_figma` | Existing Figma Variables write adapter |

## Library sources

Select one library source for the MCP process. The existing server checks a private `DISDAT_API_KEY` for the optional hosted Dis Dat library first, then `DISDAT_TOKENS_FILE`, then an explicit `DISDAT_TOKENS_URL`. It falls back to the bundled sample when a source is unavailable. A local-file process can use the configuration above with its selected library variables.

## Figma

The export tools work from the loaded library locally. To request a Figma Variables write, provide `FIGMA_TOKEN` through the process's private environment and call `push_to_figma` with the intended file key. Access depends on that Figma account and file permissions. Keep token values in the private environment used by your agent's MCP launcher.

The browser extension and local capture setup are documented in the repository [README](../README.md). This MCP server operates on token libraries; capture JSON is unpacked with `tools/disdat.py`.
