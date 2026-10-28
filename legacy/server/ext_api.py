"""Dis Dat — extension API: metered transcribe + crunch for the browser extension.

Additive on top of auth_billing (reuses its Supabase-JWT auth + the SQLite users DB). The browser
extension signs in with Supabase Google, sends the access token, and calls these instead of baking keys.

Billing model (decided 2026-06): meter AUDIO MINUTES (the cost driver, ~0.75c/min).
  • Free trial: TRIAL_MIN one-time minutes (no card).
  • Pro ($7/mo): PRO_CAP_MIN minutes / month, reset on a rolling 30-day window.
Forwards are verbatim: /x/transcribe returns Deepgram's JSON, /x/crunch returns Groq's — so the
extension's existing response parsing is unchanged.
"""
from __future__ import annotations
import os
import secrets as _secrets
import time

import pathlib

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response

import auth_billing as ab

SKILL_REPO = os.getenv("DISDAT_SKILL_REPO", "DisDat-dev/disdat")  # the public GitHub repo `npx skills add` pulls from
_SKILL_PATH = os.getenv("DISDAT_SKILL_PATH", "/path/to/configure")

DEEPGRAM_KEY = os.getenv("DEEPGRAM_API_KEY") or os.getenv("DEEPGRAM_KEY", "")
GROQ_KEY = os.getenv("GROQ_API_KEY", "")
TRIAL_MIN = float(os.getenv("TRIAL_MIN", "30"))
PRO_CAP_MIN = float(os.getenv("PRO_CAP_MIN", "500"))


def _is_pro(status: str, stripe_customer_id) -> bool:
    """A REAL paying subscriber — not a fresh signup. auth_billing stamps every new user
    subscription_status='trialing' (its old 14-day library window) with NO stripe_customer_id;
    a Stripe checkout sets the customer id (and 'active'/'trialing'). So 'trialing' alone is NOT Pro —
    Pro = active, or trialing WITH a Stripe customer. Otherwise the user is on the 30-min audio trial."""
    return status == "active" or (status == "trialing" and bool(stripe_customer_id))


def _pro_active(status: str, scid, pro_until) -> bool:
    """Paying subscriber OR inside referral-granted Pro time."""
    return _is_pro(status, scid) or bool(pro_until and pro_until > int(time.time()))


_REF_ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O/1/I/L confusables


def _ref_code(con, uid: str) -> str:
    row = con.execute("SELECT referral_code FROM users WHERE id=?", (uid,)).fetchone()
    if row and row[0]:
        return row[0]
    while True:
        code = "DD-" + "".join(_secrets.choice(_REF_ALPHA) for _ in range(6))
        if not con.execute("SELECT 1 FROM users WHERE referral_code=?", (code,)).fetchone():
            break
    con.execute("UPDATE users SET referral_code=? WHERE id=?", (code, uid))
    con.commit()
    return code


def _ensure_cols() -> None:
    """Add the minute-meter columns to the existing users table (idempotent)."""
    con = ab._db()
    for ddl in (
        "ALTER TABLE users ADD COLUMN trial_min_used REAL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN period_min_used REAL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN period_start INTEGER",
        "ALTER TABLE users ADD COLUMN referral_code TEXT",
        "ALTER TABLE users ADD COLUMN referred_by TEXT",
        "ALTER TABLE users ADD COLUMN referral_count INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN pro_until INTEGER",
        "ALTER TABLE users ADD COLUMN dd_api_key TEXT",       # the MCP/Figma library key — the hosted lock
        "ALTER TABLE users ADD COLUMN tokens_json TEXT",      # the user's saved DTCG token library
        "ALTER TABLE users ADD COLUMN figma_token TEXT",      # OAuth access token for the linked Figma account
        "ALTER TABLE users ADD COLUMN figma_refresh TEXT",    # OAuth refresh token
        "ALTER TABLE users ADD COLUMN figma_expires INTEGER", # access-token expiry (unix)
        "ALTER TABLE users ADD COLUMN figma_user TEXT",       # {handle,email,img} of the linked Figma account
    ):
        try:
            con.execute(ddl); con.commit()
        except Exception:
            pass  # column already exists
    con.close()


_ensure_cols()


def _entitled(u: "ab.User") -> tuple[bool, str, float]:
    """(allowed, plan, minutes_left). Pro = monthly cap (rolling 30d reset); else = 30-min audio trial."""
    con = ab._db()
    row = con.execute(
        "SELECT subscription_status, stripe_customer_id, COALESCE(trial_min_used,0), COALESCE(period_min_used,0), period_start, pro_until FROM users WHERE id=?",
        (u.id,),
    ).fetchone()
    status, scid, tmin, pmin, pstart, pro_until = row or ("none", None, 0.0, 0.0, None, None)
    now = int(time.time())
    if _pro_active(status, scid, pro_until):
        if not pstart or now - pstart > 30 * 86400:  # roll the monthly cap
            con.execute("UPDATE users SET period_min_used=0, period_start=? WHERE id=?", (now, u.id))
            con.commit(); pmin = 0.0
        con.close()
        return (pmin < PRO_CAP_MIN, "pro", max(0.0, PRO_CAP_MIN - pmin))
    con.close()
    return (tmin < TRIAL_MIN, "trial", max(0.0, TRIAL_MIN - tmin))


def _meter(u: "ab.User", minutes: float) -> None:
    con = ab._db()
    row = con.execute("SELECT subscription_status, stripe_customer_id, pro_until FROM users WHERE id=?", (u.id,)).fetchone() or ("none", None, None)
    col = "period_min_used" if _pro_active(row[0], row[1], row[2]) else "trial_min_used"
    con.execute(f"UPDATE users SET {col}=COALESCE({col},0)+? WHERE id=?", (minutes, u.id))
    con.commit(); con.close()


router = APIRouter()


PRIVACY_HTML = """<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Dis Dat — Privacy Policy</title>
<style>body{max-width:720px;margin:48px auto;padding:0 20px;font:16px/1.65 -apple-system,Segoe UI,system-ui,sans-serif;color:#1c1206;background:#FBF7EE}
h1{font-size:28px;margin:.2em 0}h2{font-size:18px;margin:1.8em 0 .4em}code{background:#efe7d6;padding:1px 5px;border-radius:5px;font-size:14px}
small{color:#6b5d44}a{color:#ff5c2a}</style></head><body>
<h1>Dis Dat — Privacy Policy</h1><small>Last updated 2026-06-30</small>
<p>Dis Dat (“the extension”) lets you capture what a web page actually renders plus your spoken reaction,
and hand a precise, re-hosted bundle to your coding agent. This policy explains exactly what it touches.</p>
<h2>When it runs</h2>
<p>The extension is <b>inert until you start a capture</b>. It reads page content only while you are actively
recording a session that you started by clicking record (or the keyboard shortcut). It does not run in the
background, does not track your browsing, and reads nothing from pages where you never hit record.</p>
<h2>What a capture contains</h2>
<p>During a recording you choose, it captures: the elements/styles/DOM/layout you point or look at, the page’s
network calls and console during the session, periodic screenshots of the visible tab, the page’s own
first-party scripts and assets, and <b>your spoken narration (audio)</b>.</p>
<h2>What is deliberately excluded</h2>
<p>Before anything leaves your browser, Dis Dat <b>skips cookies entirely</b> and <b>redacts secrets</b> in page
storage — anything matching tokens / auth / session / API keys / JWTs / high-entropy values is masked, so they
never reach a hosted link.</p>
<h2>How it is processed</h2>
<p>Your audio is transcribed (Deepgram) and your reaction + the captured facts are summarized into “code-speak”
(Groq), routed through our API at <code>your-server.example</code>. The capture bundle is uploaded to <b>temporary public
file hosts</b> (e.g. litterbox, 0x0, tmpfiles) and given an unguessable link <b>so you can paste it to your agent</b>.
Those links <b>auto-expire</b> (typically hours to a few weeks depending on host). Treat a capture link as you would
any shared link. We do not store your page captures on our own servers.</p>
<h2>Account &amp; billing</h2>
<p>To use the metered service you sign in with Google (via Supabase). We store your <b>email</b> and your
<b>usage in audio-minutes</b> to enforce the free trial and the Pro plan. Payments are handled by <b>Stripe</b>; we
never see or store your card details. We do not sell your data or use it for advertising.</p>
<h2>Diagnostics</h2>
<p>The extension may send anonymous error/diagnostic logs (no page content) so we can fix bugs.</p>
<h2>Your choices</h2>
<p>You can sign out at any time, and uninstalling the extension removes its local data. For deletion of your
account email/usage record, contact <a href=\"mailto:operator@example.invalid\">operator@example.invalid</a>.</p>
</body></html>"""


@router.get("/privacy", response_class=HTMLResponse)
def privacy() -> str:
    return PRIVACY_HTML


# ── Capture proxy: front free-host artifact uploads through your-site.example ────────
# The extension mints a capture id INSTANTLY and pastes your-site.example/c/<id>/<artifact> URLs, so the
# paste is instant. It then uploads each artifact to a free host (litterbox/0x0/tmpfiles) in the
# background and POSTs the mapping here. We store only the mapping (KB) — never the bytes. GET
# streams from the free host (their storage, our bandwidth). An agent that fetches before an
# artifact lands gets 202 "uploading, retry". SSRF-safe: only these hosts are ever proxied.
_CAP_HOSTS = ("litterbox.catbox.moe", "files.catbox.moe", "catbox.moe", "0x0.st", "tmpfiles.org")
_CAP_MAX_BYTES = 32 * 1024 * 1024


def _cap_host_ok(url: str) -> bool:
    from urllib.parse import urlparse
    h = (urlparse(url).hostname or "").lower()
    return any(h == d or h.endswith("." + d) for d in _CAP_HOSTS)


def _cap_db() -> None:
    con = ab._db()
    con.execute("""CREATE TABLE IF NOT EXISTS captures (
        cid TEXT, artifact TEXT, url TEXT, gzipped INTEGER DEFAULT 0,
        status TEXT DEFAULT 'ready', created INTEGER, PRIMARY KEY (cid, artifact))""")
    con.commit(); con.close()


_cap_db()


@router.post("/x/cap/{cid}")
async def cap_put(cid: str, request: Request) -> dict:
    import re as _re
    if not _re.fullmatch(r"[A-Za-z0-9_-]{6,64}", cid):
        raise HTTPException(400, "bad capture id")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "bad json")
    items = (body.get("artifacts") or [])[:12]
    con = ab._db(); now = int(time.time())
    con.execute("DELETE FROM captures WHERE created < ?", (now - 3 * 86400,))
    n = 0
    for it in items:
        name = str(it.get("name", ""))[:40].strip()
        url = str(it.get("url", ""))[:800].strip()
        status = str(it.get("status", "ready"))[:16]
        if not name:
            continue
        if url and not _cap_host_ok(url):
            continue  # SSRF guard — only allowlisted file hosts
        if url and status == "ready":
            con.execute("INSERT OR REPLACE INTO captures (cid, artifact, url, gzipped, status, created) VALUES (?,?,?,?,?,?)",
                        (cid, name, url, 1 if it.get("gzipped") else 0, "ready", now))
        else:
            con.execute("INSERT OR REPLACE INTO captures (cid, artifact, url, gzipped, status, created) VALUES (?,?,?,?,?,?)",
                        (cid, name, "", 1 if it.get("gzipped") else 0, status or "uploading", now))
        n += 1
    con.commit(); con.close()
    return {"ok": True, "stored": n}


@router.get("/c/{cid}")
def cap_manifest(cid: str) -> JSONResponse:
    con = ab._db()
    rows = con.execute("SELECT artifact, status FROM captures WHERE cid=?", (cid,)).fetchall()
    con.close()
    if not rows:
        return JSONResponse({"id": cid, "status": "unknown", "message": "no such capture (or still starting) — retry shortly", "retry_after": 3}, status_code=202)
    return JSONResponse({"id": cid, "artifacts": {r[0]: {"status": r[1], "url": f"{_API_BASE}/c/{cid}/{r[0]}"} for r in rows}})


@router.get("/c/{cid}/{artifact}")
def cap_get(cid: str, artifact: str) -> Response:
    con = ab._db()
    row = con.execute("SELECT url, gzipped, status FROM captures WHERE cid=? AND artifact=?", (cid, artifact)).fetchone()
    con.close()
    if not row or not row[0] or row[2] != "ready":
        st = (row[2] if row else "uploading") or "uploading"
        return JSONResponse({"status": st, "message": "artifact still uploading — retry in a few seconds", "retry_after": 3},
                            status_code=202, headers={"Retry-After": "3"})
    url, gz = row[0], row[1]
    if not _cap_host_ok(url):
        raise HTTPException(400, "host not allowed")
    try:
        r = requests.get(url, timeout=30, allow_redirects=False, headers={"User-Agent": "DisDat/1.0"})
    except Exception:
        raise HTTPException(502, "source unreachable")
    if r.status_code != 200:
        raise HTTPException(502, f"source returned {r.status_code}")
    if len(r.content) > _CAP_MAX_BYTES:
        raise HTTPException(413, "artifact too large to proxy")
    headers = {"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"}
    # Transparent passthrough: serve the raw bytes exactly as the free host stores them, so the
    # existing `curl -s URL | gunzip` contract holds and no client double-decodes.
    mt = "application/gzip" if gz else "application/json"
    return Response(r.content, status_code=200, media_type=mt, headers=headers)


# ── Hosted token library — the MCP/Figma lock ────────────────────────────────
# Peter's model: the MCP + Figma plugin only light up if you've signed up to the hosted service.
# A signed-in user mints a DisDat library key (POST /x/keys) and their agent/plugin reads their live
# library with it (GET /x/tokens, Bearer key). The lab/extension saves the library (PUT /x/tokens,
# Supabase auth). So the agent sees THEIR tokens natively — that's the wedge.
def _mint_key(uid: str) -> str:
    con = ab._db()
    row = con.execute("SELECT dd_api_key FROM users WHERE id=?", (uid,)).fetchone()
    if row and row[0]:
        con.close(); return row[0]
    key = "dd_live_" + _secrets.token_hex(20)
    con.execute("UPDATE users SET dd_api_key=? WHERE id=?", (key, uid)); con.commit(); con.close()
    return key


def _user_by_key(request: Request):
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "missing library key")
    key = auth[7:].strip()
    if not key.startswith("dd_"):
        raise HTTPException(401, "not a library key")
    con = ab._db()
    row = con.execute("SELECT id FROM users WHERE dd_api_key=?", (key,)).fetchone()
    con.close()
    if not row:
        raise HTTPException(401, "invalid library key")
    return row[0]


@router.post("/x/keys")
def x_keys(rotate: bool = False, u: "ab.User" = Depends(ab.current_user)) -> dict:
    if rotate:
        con = ab._db(); con.execute("UPDATE users SET dd_api_key=NULL WHERE id=?", (u.id,)); con.commit(); con.close()
    return {"key": _mint_key(u.id)}


@router.get("/x/tokens")
def x_tokens_get(request: Request) -> Response:
    import json as _json
    uid = _user_by_key(request)
    con = ab._db()
    row = con.execute("SELECT tokens_json FROM users WHERE id=?", (uid,)).fetchone()
    con.close()
    body = (row[0] if row and row[0] else "{}")
    return Response(body, media_type="application/json")


# ── Remote MCP over HTTP + OAuth 2.1 ─────────────────────────────────────────
# The native "add custom MCP → Authenticate" flow: user pastes https://example.invalid/mcp into
# Claude/Codex; the client discovers the OAuth metadata below, opens /oauth/authorize in a browser
# (branded consent page → Continue with Google → your-site.example/account approves with the Supabase
# session → back here), exchanges the code (PKCE) for a bearer token (= the user's dd_live key),
# and then calls /mcp with it. Tools read that user's hosted library.
import base64 as _b64
import hashlib as _hashlib
import json as _json

_API_BASE = os.getenv("DISDAT_API_BASE", "https://example.invalid")
_SITE_BASE = os.getenv("DISDAT_SITE_BASE", "https://example.invalid")


def _oauth_db() -> None:
    con = ab._db()
    con.execute("""CREATE TABLE IF NOT EXISTS mcp_auth (
        sid TEXT PRIMARY KEY, client_id TEXT, redirect_uri TEXT, state TEXT,
        code_challenge TEXT, code TEXT, user_id TEXT, approved INTEGER DEFAULT 0, created INTEGER)""")
    con.commit(); con.close()


_oauth_db()

_MCP_SCOPES = [
    ("read:library", "Read your saved token library (the tokens, ranges and specimens you saved)"),
    ("export", "Export your tokens as DTCG / CSS / Figma payloads"),
]


@router.get("/.well-known/oauth-authorization-server")
def oauth_as_meta() -> dict:
    return {
        "issuer": _API_BASE,
        "authorization_endpoint": f"{_API_BASE}/oauth/authorize",
        "token_endpoint": f"{_API_BASE}/oauth/token",
        "registration_endpoint": f"{_API_BASE}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [s for s, _ in _MCP_SCOPES],
    }


@router.get("/.well-known/oauth-protected-resource")
@router.get("/.well-known/oauth-protected-resource/mcp")
def oauth_pr_meta() -> dict:
    return {
        "resource": f"{_API_BASE}/mcp",
        "authorization_servers": [_API_BASE],
        "bearer_methods_supported": ["header"],
    }


@router.post("/oauth/register")
async def oauth_register(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        body = {}
    cid = "ddc_" + _secrets.token_hex(12)
    return JSONResponse({
        "client_id": cid,
        "client_id_issued_at": int(time.time()),
        "redirect_uris": body.get("redirect_uris", []),
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "client_name": str(body.get("client_name", ""))[:80],
    }, status_code=201)


@router.get("/oauth/authorize", response_class=HTMLResponse)
def oauth_authorize(client_id: str = "", redirect_uri: str = "", state: str = "",
                    code_challenge: str = "", code_challenge_method: str = "S256",
                    response_type: str = "code", scope: str = "") -> HTMLResponse:
    if response_type != "code" or not redirect_uri or not code_challenge:
        raise HTTPException(400, "bad authorize request")
    sid = _secrets.token_urlsafe(24)
    con = ab._db()
    con.execute("INSERT INTO mcp_auth (sid, client_id, redirect_uri, state, code_challenge, created) VALUES (?,?,?,?,?,?)",
                (sid, client_id[:120], redirect_uri[:500], state[:300], code_challenge[:200], int(time.time())))
    con.commit(); con.close()
    perms = "".join(
        f'<li><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2eaf6f" stroke-width="2.4" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg> {desc}</li>'
        for _s, desc in _MCP_SCOPES)
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Dis Dat</title><link rel="icon" href="{_SITE_BASE}/favicon-32.png"><style>
body{{margin:0;font:14px/1.5 -apple-system,Inter,system-ui,sans-serif;background:#FBF7EE;color:#16110D;display:grid;place-items:center;min-height:100vh}}
.card{{width:min(420px,92vw);background:#fff;border:1px solid rgba(28,18,6,.11);border-radius:16px;padding:28px;box-shadow:0 24px 70px rgba(28,18,6,.12)}}
h1{{font:700 19px Georgia,serif;margin:0 0 6px;display:flex;align-items:center;gap:10px}}
h1 img{{width:26px;height:26px;border-radius:6px;image-rendering:pixelated}}
p{{color:#6b5d44;margin:0 0 16px}}
ul{{list-style:none;padding:0;margin:0 0 20px;display:flex;flex-direction:column;gap:9px;font-size:13.5px}}
li{{display:flex;gap:9px;align-items:flex-start}}
a.go{{display:block;text-align:center;background:#FF5C2A;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:12px}}
.deny{{display:block;text-align:center;color:#a08a6a;font-size:12.5px;margin-top:12px;text-decoration:none}}
.meta{{font:10.5px ui-monospace,monospace;color:#a08a6a;margin-top:18px;border-top:1px solid rgba(28,18,6,.09);padding-top:12px}}
</style></head><body><div class="card">
<h1><img src="{_SITE_BASE}/icon-1024.png" alt="">Connect your Dis Dat library</h1>
<p>An agent is asking to connect. It will be able to:</p>
<ul>{perms}</ul>
<a class="go" href="{_SITE_BASE}/account?mcp_auth={sid}">Continue with your Dis Dat account</a>
<a class="deny" href="{redirect_uri}?error=access_denied&state={state}">Deny</a>
<div class="meta">client {client_id[:28] or "unknown"} · you sign in on your-site.example — this page never sees your password</div>
</div></body></html>""")


@router.post("/x/mcp-approve")
async def x_mcp_approve(request: Request, u: "ab.User" = Depends(ab.current_user)) -> dict:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "bad json")
    sid = str(body.get("sid", ""))[:120]
    con = ab._db()
    row = con.execute("SELECT sid FROM mcp_auth WHERE sid=? AND approved=0 AND created > ?", (sid, int(time.time()) - 900)).fetchone()
    if not row:
        con.close(); raise HTTPException(404, "unknown or expired authorization request")
    code = _secrets.token_urlsafe(24)
    con.execute("UPDATE mcp_auth SET approved=1, user_id=?, code=? WHERE sid=?", (u.id, code, sid))
    con.commit(); con.close()
    _mint_key(u.id)  # ensure the library key exists — it becomes the access token
    return {"continue": f"{_API_BASE}/oauth/continue?sid={sid}"}


@router.get("/oauth/continue")
def oauth_continue(sid: str = "") -> Response:
    con = ab._db()
    row = con.execute("SELECT redirect_uri, state, code, approved FROM mcp_auth WHERE sid=?", (sid,)).fetchone()
    con.close()
    if not row or not row[3]:
        raise HTTPException(400, "not approved")
    redirect_uri, state, code = row[0], row[1], row[2]
    sep = "&" if "?" in redirect_uri else "?"
    return Response(status_code=302, headers={"Location": f"{redirect_uri}{sep}code={code}&state={state}"})


@router.post("/oauth/token")
async def oauth_token(request: Request) -> dict:
    form = await request.form()
    if form.get("grant_type") != "authorization_code":
        raise HTTPException(400, "unsupported grant_type")
    code = str(form.get("code", ""))[:200]
    verifier = str(form.get("code_verifier", ""))[:300]
    con = ab._db()
    row = con.execute("SELECT sid, code_challenge, user_id FROM mcp_auth WHERE code=? AND approved=1", (code,)).fetchone()
    if not row:
        con.close(); raise HTTPException(400, "invalid code")
    sid, challenge, uid = row
    digest = _b64.urlsafe_b64encode(_hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    if digest != challenge:
        con.close(); raise HTTPException(400, "pkce verification failed")
    con.execute("DELETE FROM mcp_auth WHERE sid=?", (sid,))  # single-use
    key_row = con.execute("SELECT dd_api_key FROM users WHERE id=?", (uid,)).fetchone()
    con.commit(); con.close()
    if not key_row or not key_row[0]:
        raise HTTPException(500, "no library key")
    return {"access_token": key_row[0], "token_type": "Bearer", "scope": " ".join(s for s, _ in _MCP_SCOPES)}


# ── the MCP endpoint itself (streamable HTTP, stateless) ─────────────────────
def _lib_for(uid: str) -> dict:
    con = ab._db()
    row = con.execute("SELECT tokens_json FROM users WHERE id=?", (uid,)).fetchone()
    con.close()
    try:
        return _json.loads(row[0]) if row and row[0] else {}
    except Exception:
        return {}


def _flatten_lib(node: dict, prefix: str = "") -> dict:
    out = {}
    for k, v in node.items():
        name = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict) and "$value" in v:
            out[name] = {"value": v["$value"], "type": v.get("$type", "string")}
        elif isinstance(v, dict):
            out.update(_flatten_lib(v, name))
    return out


_MCP_TOOLS = [
    {"name": "list_tokens", "description": "List every token in your Dis Dat library (name = value (type)).", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "get_token", "description": "Get one token by dotted name, e.g. motion.spring.damping.", "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}},
    {"name": "export_css", "description": "Your library as :root CSS custom properties.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "export_dtcg", "description": "Your library as canonical W3C-DTCG JSON (paste into the Dis Dat Figma plugin or Tokens Studio).", "inputSchema": {"type": "object", "properties": {}}},
]


def _mcp_call(uid: str, name: str, args: dict) -> str:
    lib = _lib_for(uid)
    flat = _flatten_lib(lib)
    if name == "list_tokens":
        return "\n".join(f"{k} = {v['value']}  ({v['type']})" for k, v in flat.items()) or "(your library is empty — save specimens from your-site.example/library.html)"
    if name == "get_token":
        n = str(args.get("name", ""))
        if n in flat:
            return f"{n} = {flat[n]['value']}  ({flat[n]['type']})"
        near = [k for k in flat if n.lower() in k.lower()][:8]
        return f"No token named {n!r}." + (f" Close: {', '.join(near)}" if near else "")
    if name == "export_css":
        return ":root {\n" + "\n".join(f"  --{k.replace('.', '-')}: {v['value']};" for k, v in flat.items()) + "\n}"
    if name == "export_dtcg":
        return _json.dumps(lib, indent=2)
    return f"unknown tool {name}"


@router.post("/mcp")
async def mcp_endpoint(request: Request) -> Response:
    # auth: Bearer dd_live key (what /oauth/token hands out)
    auth = request.headers.get("authorization", "")
    uid = None
    if auth.lower().startswith("bearer ") and auth[7:].strip().startswith("dd_"):
        con = ab._db()
        row = con.execute("SELECT id FROM users WHERE dd_api_key=?", (auth[7:].strip(),)).fetchone()
        con.close()
        uid = row[0] if row else None
    if uid is None:
        return Response(status_code=401, media_type="application/json",
                        content='{"error":"unauthorized"}',
                        headers={"WWW-Authenticate": f'Bearer resource_metadata="{_API_BASE}/.well-known/oauth-protected-resource"'})
    try:
        msg = await request.json()
    except Exception:
        raise HTTPException(400, "bad json-rpc")
    mid = msg.get("id")
    method = msg.get("method", "")
    if method == "initialize":
        return JSONResponse({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "disdat-library", "version": "1.0.0"}}})
    if method.startswith("notifications/"):
        return Response(status_code=202)
    if method == "tools/list":
        return JSONResponse({"jsonrpc": "2.0", "id": mid, "result": {"tools": _MCP_TOOLS}})
    if method == "tools/call":
        params = msg.get("params", {}) or {}
        text = _mcp_call(uid, params.get("name", ""), params.get("arguments", {}) or {})
        return JSONResponse({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}]}})
    if method == "ping":
        return JSONResponse({"jsonrpc": "2.0", "id": mid, "result": {}})
    return JSONResponse({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}})


# ── Genuine Figma account connection (OAuth 2 + PKCE-optional) ───────────────
# The real thing Peter asked for: "Connect Figma" runs Figma's OAuth so the user's ACTUAL Figma
# account is linked. current_user:read + file_content:read work on ANY plan (genuine connection +
# identity). file_variables:write is Enterprise-only (Figma's rule) — so the REST variable push
# below only fires for Enterprise orgs; every other plan writes variables through the DisDat plugin
# running in their real Figma file. Needs a Figma app (FIGMA_CLIENT_ID/SECRET) registered by Peter.
_FIGMA_CLIENT_ID = os.getenv("FIGMA_CLIENT_ID", "")
_FIGMA_CLIENT_SECRET = os.getenv("FIGMA_CLIENT_SECRET", "")
_FIGMA_REDIRECT = os.getenv("FIGMA_REDIRECT", "https://example.invalid/figma/callback")
_FIGMA_SCOPES = os.getenv("FIGMA_SCOPES", "current_user:read,file_content:read,file_variables:read,file_variables:write")


def _figma_db() -> None:
    con = ab._db()
    con.execute("CREATE TABLE IF NOT EXISTS figma_oauth (state TEXT PRIMARY KEY, user_id TEXT, created INTEGER)")
    con.commit(); con.close()


_figma_db()


@router.post("/x/figma/start")
def figma_start(u: "ab.User" = Depends(ab.current_user)) -> dict:
    if not _FIGMA_CLIENT_ID:
        raise HTTPException(503, "figma app not configured")
    import urllib.parse as _up
    state = _secrets.token_urlsafe(24)
    con = ab._db()
    con.execute("DELETE FROM figma_oauth WHERE created < ?", (int(time.time()) - 900,))
    con.execute("INSERT INTO figma_oauth (state, user_id, created) VALUES (?,?,?)", (state, u.id, int(time.time())))
    con.commit(); con.close()
    q = _up.urlencode({
        "client_id": _FIGMA_CLIENT_ID, "redirect_uri": _FIGMA_REDIRECT,
        "scope": _FIGMA_SCOPES, "state": state, "response_type": "code",
    })
    return {"url": f"https://www.figma.com/oauth?{q}"}


@router.get("/figma/callback")
def figma_callback(code: str = "", state: str = "", error: str = "") -> Response:
    if error:
        return Response(status_code=302, headers={"Location": f"{_SITE_BASE}/account?figma=denied"})
    con = ab._db()
    row = con.execute("SELECT user_id FROM figma_oauth WHERE state=? AND created > ?", (state, int(time.time()) - 900)).fetchone()
    if not row:
        con.close(); return Response(status_code=302, headers={"Location": f"{_SITE_BASE}/account?figma=badstate"})
    uid = row[0]
    con.execute("DELETE FROM figma_oauth WHERE state=?", (state,)); con.commit()
    try:
        basic = _b64.b64encode(f"{_FIGMA_CLIENT_ID}:{_FIGMA_CLIENT_SECRET}".encode()).decode()
        tok = requests.post("https://api.figma.com/v1/oauth/token",
                            headers={"Authorization": "Basic " + basic},
                            data={"redirect_uri": _FIGMA_REDIRECT, "code": code, "grant_type": "authorization_code"},
                            timeout=30).json()
        access = tok.get("access_token")
        if not access:
            con.close(); return Response(status_code=302, headers={"Location": f"{_SITE_BASE}/account?figma=exchangefail"})
        me = requests.get("https://api.figma.com/v1/me", headers={"Authorization": "Bearer " + access}, timeout=20).json()
        who = _json.dumps({"handle": me.get("handle"), "email": me.get("email"), "img": me.get("img_url")})
        con.execute("UPDATE users SET figma_token=?, figma_refresh=?, figma_expires=?, figma_user=? WHERE id=?",
                    (access, tok.get("refresh_token"), int(time.time()) + int(tok.get("expires_in", 0)), who, uid))
        con.commit()
    except Exception:
        con.close(); return Response(status_code=302, headers={"Location": f"{_SITE_BASE}/account?figma=error"})
    con.close()
    return Response(status_code=302, headers={"Location": f"{_SITE_BASE}/account?figma=connected"})


@router.get("/x/figma/status")
def figma_status(u: "ab.User" = Depends(ab.current_user)) -> dict:
    con = ab._db()
    row = con.execute("SELECT figma_user, figma_token FROM users WHERE id=?", (u.id,)).fetchone()
    con.close()
    if not row or not row[1]:
        return {"connected": False, "configured": bool(_FIGMA_CLIENT_ID)}
    try:
        who = _json.loads(row[0] or "{}")
    except Exception:
        who = {}
    return {"connected": True, "configured": True, "handle": who.get("handle"), "email": who.get("email")}


@router.post("/x/figma/disconnect")
def figma_disconnect(u: "ab.User" = Depends(ab.current_user)) -> dict:
    con = ab._db()
    con.execute("UPDATE users SET figma_token=NULL, figma_refresh=NULL, figma_user=NULL WHERE id=?", (u.id,))
    con.commit(); con.close()
    return {"ok": True}


@router.post("/x/figma/push")
async def figma_push(request: Request, u: "ab.User" = Depends(ab.current_user)) -> dict:
    """Write the user's library as Figma Variables via REST — Enterprise only. Non-Enterprise gets a
    clear {ok:false, path:'plugin'} so the UI routes them to the plugin (the any-plan write path)."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    file_key = str(body.get("file_key", "")).strip()
    con = ab._db()
    row = con.execute("SELECT figma_token, tokens_json FROM users WHERE id=?", (u.id,)).fetchone()
    con.close()
    if not row or not row[0]:
        raise HTTPException(400, "connect your Figma account first")
    if not file_key:
        return {"ok": False, "path": "need_file_key", "message": "Paste the Figma file key (figma.com/file/<key>/…)."}
    token, tokens_json = row[0], row[1] or "{}"
    try:
        lib = _json.loads(tokens_json)
    except Exception:
        lib = {}
    flat = _flatten_lib(lib)
    if not flat:
        return {"ok": False, "path": "empty", "message": "Your library is empty — save specimens first."}
    payload = _figma_variables_payload(flat)
    try:
        r = requests.post(f"https://api.figma.com/v1/files/{file_key}/variables",
                          headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                          json=payload, timeout=30)
    except Exception:
        raise HTTPException(502, "figma unreachable")
    if r.status_code == 200:
        return {"ok": True, "count": len(flat)}
    # 403 / scope errors = not Enterprise → the plugin is the write path
    return {"ok": False, "path": "plugin", "status": r.status_code,
            "message": "Figma only allows the API to create Variables on Enterprise plans. Use the DisDat plugin — it writes them on any plan."}


def _figma_variables_payload(flat: dict) -> dict:
    coll, mode = "coll:disdat", "mode:default"
    varc, valc = [], []
    for i, (name, v) in enumerate(flat.items()):
        vid = f"var:{i}"
        val = v["value"]
        rt = "STRING"
        fval = str(val)
        if v["type"] == "color" and isinstance(val, str) and val.startswith("#"):
            rt = "COLOR"; h = val.lstrip("#")
            fval = {"r": int(h[0:2], 16) / 255, "g": int(h[2:4], 16) / 255, "b": int(h[4:6], 16) / 255, "a": 1}
        elif v["type"] == "number":
            rt = "FLOAT"; fval = float(val)
        varc.append({"action": "CREATE", "id": vid, "name": name.replace(".", "/"), "variableCollectionId": coll, "resolvedType": rt})
        valc.append({"variableId": vid, "modeId": mode, "value": fval})
    return {
        "variableCollections": [{"action": "CREATE", "id": coll, "name": "DisDat tokens", "initialModeId": mode}],
        "variableModes": [{"action": "CREATE", "id": mode, "name": "Default", "variableCollectionId": coll}],
        "variables": varc, "variableModeValues": valc,
    }


@router.put("/x/tokens")
async def x_tokens_put(request: Request, u: "ab.User" = Depends(ab.current_user)) -> dict:
    import json as _json
    raw = await request.body()
    if len(raw) > 512_000:
        raise HTTPException(413, "library too large")
    try:
        _json.loads(raw or b"{}")  # validate
    except Exception:
        raise HTTPException(400, "library must be JSON")
    con = ab._db()
    con.execute("UPDATE users SET tokens_json=? WHERE id=?", (raw.decode("utf-8", "replace"), u.id))
    con.commit(); con.close()
    return {"ok": True, "bytes": len(raw)}


# Design feedback from the Tokens Lab (your-site.example/tokens-lab.html) — Peter points & drops a note
# per specimen while playing with it. No auth (it's design feedback, not user data); appended to a
# JSONL on the box so it can be read back. Tiny + rate-guarded by payload cap.
_LABFB_PATH = pathlib.Path(os.getenv("LAB_FEEDBACK_PATH", "/path/to/configure"))


@router.post("/x/labfeedback")
async def x_labfeedback(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "bad json")
    note = str(body.get("note", ""))[:2000].strip()
    if not note:
        raise HTTPException(400, "empty note")
    rec = {
        "ts": time.time(),
        "specimen": str(body.get("specimen", ""))[:80],
        "title": str(body.get("title", ""))[:120],
        "page": str(body.get("page", ""))[:40],
        "note": note,
    }
    try:
        _LABFB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _LABFB_PATH.open("a") as f:
            f.write(__import__("json").dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        raise HTTPException(500, "write failed")
    return {"ok": True}


# Tokens Lab chat: turn a plain-language instruction into tool CALLS that mutate the live specimens
# (applyPreset / setToken / export). Groq only (Peter: "Groq always"). Unauthenticated — it's a
# design toy on a noindex page; capped payloads. The page sends the specimen schema + instruction;
# we return {message, calls[]} and the page applies + renders the calls as tool cards.
_LAB_MODEL = os.getenv("GROQ_LAB_MODEL", "llama-3.3-70b-versatile")
_LABCHAT_SYS = (
    "You are DisDat Lab's editor. The user is looking at a page of live design SPECIMENS — playable "
    "examples of a design system. Each specimen has a `ref` (e.g. @disdat/springs), named PRESETS, "
    "and named TOKENS (ranges have min..max; option tokens list their options). Translate the user's "
    "plain-language instruction into tool CALLS that mutate the specimens, plus a one-line message.\n\n"
    "Tools:\n"
    '- {"tool":"applyPreset","ref":"<ref>","preset":"<preset name>"}\n'
    '- {"tool":"setToken","ref":"<ref>","token":"<token name>","value":<number|string>}\n'
    '- {"tool":"export","format":"figma"|"json"|"css"}\n\n'
    "Rules: only use refs/presets/tokens that appear in the provided specimen list. Keep range values "
    "inside min..max; option values must be one of the listed options. Prefer a preset when the intent "
    "matches one. If nothing matches, return an empty calls array and say why in message. "
    'Output STRICT JSON ONLY: {"message": string, "calls": [ ... ]}.'
)


@router.post("/x/labchat")
async def x_labchat(request: Request) -> dict:
    import json as _json
    if not GROQ_KEY:
        raise HTTPException(500, "groq not configured")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "bad json")
    instruction = str(body.get("instruction", ""))[:800].strip()
    if not instruction:
        raise HTTPException(400, "empty instruction")
    specimens = body.get("specimens", [])
    ctx = _json.dumps(specimens, ensure_ascii=False)[:8000]
    payload = {
        "model": _LAB_MODEL,
        "messages": [
            {"role": "system", "content": _LABCHAT_SYS},
            {"role": "user", "content": f"SPECIMENS (current state):\n{ctx}\n\nINSTRUCTION: {instruction}"},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 800,
    }
    try:
        gr = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": "Bearer " + GROQ_KEY, "Content-Type": "application/json"},
            json=payload, timeout=60,
        )
    except Exception:
        raise HTTPException(502, "groq unreachable")
    if gr.status_code != 200:
        raise HTTPException(502, f"groq {gr.status_code}")
    try:
        content = gr.json()["choices"][0]["message"]["content"]
        parsed = _json.loads(content)
    except Exception:
        raise HTTPException(502, "groq bad output")
    return {"message": str(parsed.get("message", ""))[:400], "calls": parsed.get("calls", [])[:24]}


def _skill_md() -> str:
    try:
        return pathlib.Path(_SKILL_PATH).read_text()
    except Exception:
        return "# Dis Dat skill\n\nSee https://example.invalid — paste a Dis Dat capture and act on its artifact URLs."


@router.get("/skill.md", response_class=PlainTextResponse)
def skill_md() -> str:
    """Raw skill markdown — what `npx skills add` falls back to and what a manual install fetches."""
    return _skill_md()


@router.get("/media/{name}")
def media(name: str) -> FileResponse:
    """Marketing media (the animation exports) — served from our own box, links never expire."""
    import re as _re
    if not _re.fullmatch(r"[a-z0-9-]+\.(mp4|gif|png)", name):
        raise HTTPException(404, "not found")
    return FileResponse(f"/path/to/configure")


@router.get("/ext.zip")
def ext_zip() -> FileResponse:
    """The public extension build — for smoke tests / direct sideload before (and beside) the Web Store."""
    return FileResponse("/path/to/configure", media_type="application/zip", filename="disdat-extension.zip")


@router.get("/skill", response_class=HTMLResponse)
def skill_page() -> str:
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'><title>Dis Dat — agent skill</title>"
        "<style>body{max-width:680px;margin:48px auto;padding:0 20px;font:16px/1.65 -apple-system,Segoe UI,system-ui,sans-serif;color:#1c1206;background:#FBF7EE}"
        "h1{font-size:26px;margin:.2em 0}h2{font-size:17px;margin:1.6em 0 .3em}"
        "pre{background:#16110D;color:#FBF7EE;padding:12px 14px;border-radius:10px;overflow:auto;font-size:14px}"
        "code{font-family:ui-monospace,monospace}small{color:#6b5d44}a{color:#ff5c2a}</style></head><body>"
        "<h1>Dis Dat — agent skill</h1>"
        "<p>Teach your coding agent to consume <a href='https://example.invalid'>Dis Dat</a> captures reliably. "
        "Works with Claude Code, Cursor, Copilot, Cline and 18+ agents. <b>Optional</b> — a Dis Dat capture is "
        "self-describing and your agent can act on it without this — the skill just makes it consistent.</p>"
        f"<h2>Install (any agent)</h2><pre>npx skills add {SKILL_REPO}</pre>"
        "<h2>Or install manually</h2>"
        "<p>Tell your agent: <em>“Fetch https://example.invalid/skill.md and save it as my Dis Dat skill "
        "(Claude Code: <code>.claude/skills/disdat/SKILL.md</code>; Cursor: <code>.cursor/rules/disdat.mdc</code>; "
        "Codex: append to <code>AGENTS.md</code>).”</em></p>"
        "<h2>Then</h2><p>Record with Dis Dat, paste the capture at your agent, and say "
        "<b>“use the Dis Dat skill.”</b> <small>Raw skill: <a href='/skill.md'>/skill.md</a></small></p>"
        "</body></html>"
    )


@router.get("/x/me")
def x_me(u: "ab.User" = Depends(ab.current_user)) -> dict:
    ok, plan, left = _entitled(u)
    con = ab._db()
    code = _ref_code(con, u.id)
    row = con.execute("SELECT COALESCE(referral_count,0), referred_by, pro_until FROM users WHERE id=?", (u.id,)).fetchone() or (0, None, None)
    con.close()
    return {
        "email": u.email, "plan": plan, "subscription_status": u.subscription_status,
        "entitled": ok, "minutes_left": round(left, 1),
        "cap": PRO_CAP_MIN if plan == "pro" else TRIAL_MIN,
        "referral_code": code, "referral_count": row[0], "redeemed": bool(row[1]),
        "pro_until": row[2],
    }


@router.post("/x/redeem")
async def x_redeem(request: Request, u: "ab.User" = Depends(ab.current_user)) -> dict:
    """Redeem a referral code — the new user AND the referrer both get 30 days of Pro."""
    body = await request.json()
    code = str(body.get("code", "")).strip().upper()
    if not code.startswith("DD-"):
        code = "DD-" + code
    con = ab._db()
    me = con.execute("SELECT referred_by, referral_code FROM users WHERE id=?", (u.id,)).fetchone()
    if me and me[0]:
        con.close(); raise HTTPException(400, "You already used a referral code.")
    if me and me[1] and me[1] == code:
        con.close(); raise HTTPException(400, "That's your own code — nice try :)")
    ref = con.execute("SELECT id, COALESCE(pro_until,0) FROM users WHERE referral_code=?", (code,)).fetchone()
    if not ref:
        con.close(); raise HTTPException(404, "Code not found — check it and try again.")
    now = int(time.time()); month = 30 * 86400
    mine = con.execute("SELECT COALESCE(pro_until,0) FROM users WHERE id=?", (u.id,)).fetchone()
    con.execute("UPDATE users SET referred_by=?, pro_until=? WHERE id=?", (code, max(now, (mine or [0])[0]) + month, u.id))
    con.execute("UPDATE users SET referral_count=COALESCE(referral_count,0)+1, pro_until=? WHERE id=?", (max(now, ref[1]) + month, ref[0]))
    con.commit(); con.close()
    ok, plan, left = _entitled(u)
    return {"ok": True, "plan": plan, "minutes_left": round(left, 1), "message": "You've both got a month of Pro 🎉"}


@router.post("/x/transcribe")
async def x_transcribe(request: Request, u: "ab.User" = Depends(ab.current_user)) -> Response:
    ok, plan, _ = _entitled(u)
    if not ok:
        raise HTTPException(402, "trial used up — upgrade to Pro" if plan == "trial" else "monthly minute cap reached")
    if not DEEPGRAM_KEY:
        raise HTTPException(500, "DEEPGRAM key not configured")
    body = await request.body()
    ct = request.headers.get("content-type", "audio/webm")
    dg = requests.post(
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&language=multi",
        headers={"Authorization": "Token " + DEEPGRAM_KEY, "Content-Type": ct}, data=body, timeout=180,
    )
    try:
        out = dg.json(); secs = float((out.get("metadata") or {}).get("duration") or 0)
        if secs > 0:
            _meter(u, secs / 60.0)  # meter the real audio seconds Deepgram billed us for
    except Exception:
        pass
    return Response(dg.content, status_code=dg.status_code, media_type="application/json")


@router.post("/x/crunch")
async def x_crunch(request: Request, u: "ab.User" = Depends(ab.current_user)) -> Response:
    ok, plan, _ = _entitled(u)
    if not ok:
        raise HTTPException(402, "limit reached — upgrade to Pro")
    payload = await request.body()
    if not GROQ_KEY:
        raise HTTPException(500, "GROQ key not configured")
    gr = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": "Bearer " + GROQ_KEY, "Content-Type": "application/json"}, data=payload, timeout=180,
    )
    return Response(gr.content, status_code=gr.status_code, media_type="application/json", headers={"x-dd-crunch": "groq"})
