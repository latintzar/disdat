"""Peter's secure key drop — paste secrets through a one-time HTTPS form instead of chat.

Flow: the agent mints a random token and touches drops/<token>.pending on this box, hands Peter
https://example.invalid/drop/<token>. The form POSTs the payload; it lands 0600 in drops/<token>.json
(pending marker consumed → the link is single-use). The agent reads the file over SSH straight into the
destination env — values are never echoed into chat — then deletes it. Unregistered tokens get nothing.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import time

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import HTMLResponse

router = APIRouter()
DIR = pathlib.Path(os.getenv("DISDAT_KEYDROP_DIR", str(pathlib.Path.home() / ".local/state/disdat/keydrop")))
DIR.mkdir(parents=True, exist_ok=True)
TOK = re.compile(r"^[a-f0-9]{32,64}$")

_PAGE = """<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content="noindex,nofollow">
<title>Secure drop</title>
<style>body{{max-width:560px;margin:56px auto;padding:0 20px;font:16px/1.6 -apple-system,system-ui,sans-serif;color:#16110D;background:#FBF7EE}}
h1{{font-size:24px;margin:0 0 6px}}p{{color:#6b5d44;font-size:14px;margin:0 0 18px}}
textarea{{width:100%;box-sizing:border-box;height:180px;background:#fff;border:1px solid rgba(28,18,6,.18);border-radius:12px;padding:14px;font:13px/1.5 ui-monospace,monospace;resize:vertical}}
input{{width:100%;box-sizing:border-box;background:#fff;border:1px solid rgba(28,18,6,.18);border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:10px}}
button{{margin-top:12px;background:#FF5C2A;color:#fff;border:none;border-radius:12px;padding:13px 28px;font-size:15px;font-weight:700;cursor:pointer}}button:hover{{background:#16110D}}
.ok{{background:#e8f5ec;border:1px solid #1f7a3d44;color:#1f7a3d;border-radius:12px;padding:16px;font-weight:600}}
.dead{{background:#fdeeee;border:1px solid #c0142b33;color:#c0142b;border-radius:12px;padding:16px;font-weight:600}}
small{{color:#a08a6a;display:block;margin-top:14px;font-size:12px}}</style></head><body>
<h1>🔐 Secure drop</h1>
{body}
<small>One-time link · HTTPS · lands root-only on our own box, never in chat history · deleted after use.</small>
</body></html>"""

_FORM = """<p>Paste the key(s) — one per line, ideally <code>NAME=value</code>. Submitting burns this link.</p>
<form method="post">
<input name="label" placeholder="what is this? (e.g. 'disdat stripe live key')" autocomplete="off">
<textarea name="payload" placeholder="STRIPE_SECRET_KEY=sk_live_…" autocomplete="off" autofocus></textarea>
<button type="submit">Send securely</button>
</form>"""


def _pending(token: str) -> pathlib.Path:
    return DIR / f"{token}.pending"


def _stored(token: str) -> pathlib.Path:
    return DIR / f"{token}.json"


@router.get("/drop/{token}", response_class=HTMLResponse)
def drop_form(token: str) -> str:
    if not TOK.fullmatch(token):
        raise HTTPException(404)
    if _stored(token).exists():
        return _PAGE.format(body='<div class="ok">Already received ✓ — this link is used up. You can close this.</div>')
    if not _pending(token).exists():
        return _PAGE.format(body='<div class="dead">This link doesn’t exist or has expired.</div>')
    return _PAGE.format(body=_FORM)


@router.post("/drop/{token}", response_class=HTMLResponse)
def drop_submit(token: str, payload: str = Form(""), label: str = Form("")) -> str:
    if not TOK.fullmatch(token):
        raise HTTPException(404)
    if _stored(token).exists() or not _pending(token).exists():
        return _PAGE.format(body='<div class="dead">This link was already used or doesn’t exist.</div>')
    if not payload.strip():
        return _PAGE.format(body=_FORM)
    p = _stored(token)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"ts": int(time.time()), "label": label.strip()[:120], "payload": payload}, f)
    _pending(token).unlink(missing_ok=True)
    return _PAGE.format(body='<div class="ok">Received ✓ — you can close this tab. The agent will pick it up and delete it.</div>')
