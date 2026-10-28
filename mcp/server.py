#!/usr/bin/env python3
"""Dis Dat — Tokens MCP server.

Exposes a captured DisDat token library to any MCP client (Claude Code, Cursor, …) so an agent can
read your saved design tokens and hand them off to the Figma ecosystem — without you rebuilding
anything by hand.

Zero dependencies: a self-contained JSON-RPC-over-stdio MCP server (line-delimited). Point it at a
token library you exported from the Tokens Lab (disdat.dev/tokens-lab.html → ↗ Export → download
`tokens.json`) via the DISDAT_TOKENS_FILE env var, or a hosted library via DISDAT_TOKENS_URL.

Tools:
  • list_tokens            — every token name, value and type in the library
  • get_token(name)        — one token's value/type (+ close-name suggestions)
  • export_css             — the library as :root CSS custom properties
  • export_figma           — W3C Design-Tokens JSON + how to import it into Figma (Tokens Studio /
                             the Figma Variables REST API)
  • push_to_figma(file_key)— write the tokens as Figma Variables via the REST API, IF a FIGMA_TOKEN
                             env var is set (otherwise returns the ready-to-run instructions)

Add to Claude Code / Cursor (mcpServers):
  {
    "disdat-tokens": {
      "command": "python3",
      "args": ["/path/to/disdat/mcp/server.py"],
      "env": { "DISDAT_TOKENS_FILE": "/path/to/tokens.json" }
    }
  }
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.request

PROTOCOL_VERSION = "2024-11-05"

# ── token source ──────────────────────────────────────────────────────────────
# A small Sancho y Panza sample so the server is useful out of the box; overridden by a real export.
_SAMPLE = {
    "motion": {"spring": {"damping": {"$value": 0.85, "$type": "number"},
                          "stiffness": {"$value": 500, "$type": "number"},
                          "stagger": {"$value": "120ms", "$type": "duration"}}},
    "ease": {"physical": {"$value": "cubic-bezier(.31,.325,0,.92)", "$type": "cubicBezier"}},
    "surface": {"paper": {"$value": "#FAF7F3", "$type": "color"},
                "cloud": {"$value": "#F2ECE5", "$type": "color"},
                "elevated": {"$value": "#FFFFFF", "$type": "color"}},
    "radius": {"card": {"$value": "12px", "$type": "dimension"},
               "bubble": {"$value": "7.5px", "$type": "dimension"}},
    "text": {"highlight": {"color": {"$value": "#F4A300", "$type": "color"}}},
    "button": {"primary": {"bg": {"$value": "#C01B2C", "$type": "color"}}},
}


DISDAT_API = os.getenv("DISDAT_API", "https://api.disdat.dev")


def _load_library() -> dict:
    # 1. Optional hosted library selected by a private DISDAT_API_KEY.
    key = os.getenv("DISDAT_API_KEY", "")
    if key:
        try:
            req = urllib.request.Request(f"{DISDAT_API}/x/tokens", headers={"Authorization": "Bearer " + key})
            with urllib.request.urlopen(req, timeout=15) as r:
                lib = json.loads(r.read().decode())
                if lib:
                    return lib
        except Exception:
            pass
    # 2. A file you exported, or an explicit URL.
    path = os.getenv("DISDAT_TOKENS_FILE", "")
    url = os.getenv("DISDAT_TOKENS_URL", "")
    try:
        if path:
            with open(path) as f:
                return json.load(f)
        if url:
            with urllib.request.urlopen(url, timeout=15) as r:
                return json.loads(r.read().decode())
    except Exception:
        pass
    # 3. A small sample so the server is never dead.
    return _SAMPLE


def _flatten(node: dict, prefix: str = "") -> dict:
    """Nested W3C tokens → {dotted.name: {value, type}}."""
    out = {}
    for k, v in node.items():
        name = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict) and "$value" in v:
            out[name] = {"value": v["$value"], "type": v.get("$type", "string")}
        elif isinstance(v, dict):
            out.update(_flatten(v, name))
    return out


def _as_css(flat: dict) -> str:
    lines = [f"  --{k.replace('.', '-')}: {v['value']};" for k, v in flat.items()]
    return ":root {\n" + "\n".join(lines) + "\n}"


# ── tools ─────────────────────────────────────────────────────────────────────
def _tool_list_tokens(_args):
    flat = _flatten(_load_library())
    return "\n".join(f"{k} = {v['value']}  ({v['type']})" for k, v in flat.items()) or "(library is empty)"


def _tool_get_token(args):
    name = str(args.get("name", ""))
    flat = _flatten(_load_library())
    if name in flat:
        v = flat[name]
        return f"{name} = {v['value']}  ({v['type']})"
    near = [k for k in flat if name.lower() in k.lower()][:8]
    return f"No token named {name!r}." + (f" Did you mean: {', '.join(near)}?" if near else "")


def _tool_export_css(_args):
    return _as_css(_flatten(_load_library()))


def _tool_export_dtcg(_args):
    """Canonical W3C Design Tokens (DTCG) JSON — the substrate every Figma path consumes."""
    return json.dumps(_load_library(), indent=2)


def _tool_export_figma(_args):
    js = json.dumps(_load_library(), indent=2)
    how = (
        "\n\nImport the DTCG JSON above with a compatible Figma token importer. "
        "The optional push_to_figma tool requests a Variables REST write for the supplied file_key "
        "using FIGMA_TOKEN from the private environment. Confirm the selected account's current "
        "write permissions before requesting a push."
    )
    return js + how


def _tool_push_to_figma(args):
    file_key = str(args.get("file_key", "")).strip()
    token = os.getenv("FIGMA_TOKEN", "")
    if not token:
        return ("Set FIGMA_TOKEN in the MCP process's private environment and provide a file_key "
                "to request a Variables write. Account and file permissions determine access. "
                "Use export_figma or export_dtcg for a local token export.")
    if not file_key:
        return "Provide a file_key (from the Figma file URL: figma.com/file/<file_key>/…)."
    flat = _flatten(_load_library())
    # Preserve each JSON type expected by the Variables API.
    def _figma_value(v):
        val = v["value"]
        if v["type"] == "number":
            if isinstance(val, bool) or not isinstance(val, (int, float)) or not math.isfinite(val):
                raise ValueError("Number tokens require finite JSON numbers.")
            return val
        if v["type"] == "boolean":
            if not isinstance(val, bool):
                raise ValueError("Boolean tokens require JSON booleans.")
            return val
        if v["type"] == "color":
            if not isinstance(val, str) or not val.startswith("#") or len(val) != 7:
                raise ValueError("Color tokens require six-digit hex colors.")
            h = val.lstrip("#")
            r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
            return {"r": round(r, 4), "g": round(g, 4), "b": round(b, 4), "a": 1}
        return str(val)
    coll_id, mode_id = "coll:disdat", "mode:default"
    var_changes, val_changes = [], []
    for i, (name, v) in enumerate(flat.items()):
        vid = f"var:{i}"
        rt = {"color": "COLOR", "number": "FLOAT", "boolean": "BOOLEAN"}.get(v["type"], "STRING")
        var_changes.append({"action": "CREATE", "id": vid, "name": name, "variableCollectionId": coll_id, "resolvedType": rt})
        try:
            value = _figma_value(v)
        except (ValueError, TypeError):
            return "Figma push requires valid color, finite number and boolean token values. Check the token library."
        val_changes.append({"variableId": vid, "modeId": mode_id, "value": value})
    payload = {
        "variableCollections": [{"action": "CREATE", "id": coll_id, "name": "DisDat tokens", "initialModeId": mode_id}],
        "variableModes": [{"action": "CREATE", "id": mode_id, "name": "Default", "variableCollectionId": coll_id}],
        "variables": var_changes,
        "variableModeValues": val_changes,
    }
    req = urllib.request.Request(
        f"https://api.figma.com/v1/files/{file_key}/variables",
        data=json.dumps(payload).encode(),
        headers={"X-Figma-Token": token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
        return f"Pushed {len(flat)} tokens to Figma file {file_key}. Response: {body[:400]}"
    except Exception as e:
        return f"Figma push failed: {e}"


TOOLS = [
    {"name": "list_tokens", "description": "List every token in the DisDat library (name = value (type)).",
     "inputSchema": {"type": "object", "properties": {}}, "_fn": _tool_list_tokens},
    {"name": "get_token", "description": "Get one token's value and type by dotted name (e.g. motion.spring.damping).",
     "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}, "_fn": _tool_get_token},
    {"name": "export_css", "description": "Return the whole library as :root CSS custom properties.",
     "inputSchema": {"type": "object", "properties": {}}, "_fn": _tool_export_css},
    {"name": "export_dtcg", "description": "Return the library as canonical W3C Design Tokens (DTCG) JSON — the substrate for every Figma/tooling path.",
     "inputSchema": {"type": "object", "properties": {}}, "_fn": _tool_export_dtcg},
    {"name": "export_figma", "description": "Return DTCG JSON and guidance for the optional Figma write adapter.",
     "inputSchema": {"type": "object", "properties": {}}, "_fn": _tool_export_figma},
    {"name": "push_to_figma", "description": "Write the tokens as Figma Variables via the REST API (needs FIGMA_TOKEN env).",
     "inputSchema": {"type": "object", "properties": {"file_key": {"type": "string"}}, "required": ["file_key"]}, "_fn": _tool_push_to_figma},
]


# ── JSON-RPC over stdio ───────────────────────────────────────────────────────
def _send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _handle(msg):
    mid = msg.get("id")
    method = msg.get("method", "")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "disdat-tokens", "version": "0.1.0"}}}
    if method in ("notifications/initialized", "initialized"):
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "tools": [{k: t[k] for k in ("name", "description", "inputSchema")} for t in TOOLS]}}
    if method == "tools/call":
        params = msg.get("params", {}) or {}
        name = params.get("name")
        args = params.get("arguments", {}) or {}
        tool = next((t for t in TOOLS if t["name"] == name), None)
        if not tool:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown tool {name}"}}
        try:
            text = tool["_fn"](args)
        except Exception as e:
            text = f"error: {e}"
        return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": str(text)}]}}
    if mid is not None:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}
    return None


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        resp = _handle(msg)
        if resp is not None:
            _send(resp)


if __name__ == "__main__":
    main()
