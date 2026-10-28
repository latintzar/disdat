"""Leo Feedback server — full pipeline.

The macOS app is a thin recorder: it uploads raw audio + raw screen frames (with
timestamps) + the cursor track. This server does everything smart:
  1. Deepgram (nova-3, multilingual) transcribes the narration with word timings.
  2. Detect natural pointing moments (deictic words like "this/here" + dwell).
  3. For each, pick the nearest frame and burn a numbered red marker at the cursor.
  4. Claude (Haiku) reads the marked images + intent and writes feedback.md.
  5. Host the bundle; return one URL for the coding agent.

Keys (DEEPGRAM_API_KEY, ANTHROPIC_API_KEY) live here, never in the app.

Run:
  set -a; . /path/to/configure set +a
  BASE_DIR=/path/to/configure PUBLIC_BASE=http://100.109.84.111:8799/s \
    /tmp/lfvenv/bin/uvicorn feedback_server:app --host 100.109.84.111 --port 8799
"""
from __future__ import annotations

# This retained hosted service requires explicit operator configuration.
import os as _disdat_boot_os
if _disdat_boot_os.environ.get("DISDAT_ENABLE_LEGACY_SERVER") != "1":
    raise RuntimeError("Configure the retained server and set DISDAT_ENABLE_LEGACY_SERVER=1 before running it.")


import asyncio
import base64
import json
import os
import secrets
import sqlite3
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import requests
from fastapi import Depends, FastAPI, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, ImageDraw, ImageFont

from auth_billing import (
    User,
    authorize_session_read,
    current_user,
    current_user_optional,
    mint_signed_token,
    register_session,
    router as auth_router,
    session_file_response,
)

BASE_DIR = Path(os.getenv("BASE_DIR", "./sessions")).expanduser()
PUBLIC_BASE = os.getenv("PUBLIC_BASE", "http://127.0.0.1:8799/s").rstrip("/")
PROVIDER = os.getenv("PROVIDER", "anthropic").lower()   # "anthropic" | "openrouter"
MODEL = os.getenv("MODEL", "claude-haiku-4-5-20251001")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY", "")
DEEPGRAM_KEY = os.getenv("DEEPGRAM_API_KEY", "")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Spend rates (override via env). Defaults: Deepgram nova-3 + Claude Haiku 4.5.
DEEPGRAM_RATE_MIN = float(os.getenv("DEEPGRAM_RATE_PER_MIN", "0.0043"))
LLM_IN_PER_M = float(os.getenv("LLM_IN_PER_M", "1.0"))     # $/M input tokens
LLM_OUT_PER_M = float(os.getenv("LLM_OUT_PER_M", "5.0"))   # $/M output tokens
DB_PATH = Path(os.getenv("SPEND_DB", str(Path(os.getenv("BASE_DIR", "./sessions")).expanduser().parent / "disdat-spend.db")))

BASE_DIR.mkdir(parents=True, exist_ok=True)
app = FastAPI(title="Dis Dat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("DISDAT_ALLOWED_ORIGINS", "").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "stripe-signature"],
)
app.include_router(auth_router)
from ext_api import router as ext_router  # browser-extension metered transcribe/crunch
app.include_router(ext_router)
from keydrop import router as keydrop_router  # Peter's secure one-time key drop (never paste secrets in chat)
app.include_router(keydrop_router)
from recdrop import router as recdrop_router  # Peter's recording drop → nova-3 diarized transcript
app.include_router(recdrop_router)

# ── Error alerting (Gmail "Send mail as" operator@example.invalid) ───────────────────
# When something breaks, email Peter (only) so bugs surface instantly during the
# dev-tester rollout. Uses the same Gmail connection as the transactional mail.
import mailer

ALERT_EMAIL = os.getenv("ALERT_EMAIL", "operator@example.invalid")
_alert_seen: dict[str, float] = {}


def send_alert(subject: str, body: str) -> None:
    """Email Peter when something breaks. De-dupes identical subjects within 5
    minutes so a flapping error can't flood the inbox."""
    now = time.time()
    if now - _alert_seen.get(subject, 0) < 300:
        return
    _alert_seen[subject] = now
    html = (f"<p style='font-family:-apple-system,sans-serif'><b>{subject}</b></p>"
            f"<pre style='font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;"
            f"background:#f6f5f3;padding:12px;border-radius:8px'>{body}</pre>")
    mailer.send_async(ALERT_EMAIL, f"[Dis Dat] {subject}", html)


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    import traceback
    tb = traceback.format_exc()
    print("UNHANDLED:", tb)
    send_alert(f"500 on {request.method} {request.url.path}", f"{exc}\n\n{tb}")
    return JSONResponse({"detail": "internal error"}, status_code=500)


@app.get("/s/{sid}/{subpath:path}")
def serve_session_file(sid: str, subpath: str, request: Request) -> Response:
    """Auth-gated replacement for the prior StaticFiles mount. Every read goes through
    `authorize_session_read` (JWT or signed URL token + ownership check + audit log)."""
    return session_file_response(sid, subpath, request)


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH))
    con.execute("""CREATE TABLE IF NOT EXISTS spend (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, session_id TEXT,
        provider TEXT, model TEXT, audio_sec REAL, deepgram_usd REAL,
        in_tokens INTEGER, out_tokens INTEGER, llm_usd REAL, total_usd REAL, markers INTEGER)""")
    return con


def _record_spend(session_id: str, audio_sec: float, in_tok: int, out_tok: int, markers: int) -> dict:
    deepgram_usd = (audio_sec / 60.0) * DEEPGRAM_RATE_MIN
    llm_usd = (in_tok / 1e6) * LLM_IN_PER_M + (out_tok / 1e6) * LLM_OUT_PER_M
    total = round(deepgram_usd + llm_usd, 5)
    try:
        con = _db()
        con.execute(
            "INSERT INTO spend (ts, session_id, provider, model, audio_sec, deepgram_usd, in_tokens, out_tokens, llm_usd, total_usd, markers) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), session_id, PROVIDER, MODEL,
             round(audio_sec, 1), round(deepgram_usd, 5), in_tok, out_tok, round(llm_usd, 5), total, markers),
        )
        con.commit(); con.close()
    except Exception as e:
        print("spend record failed:", e)
    return {"deepgram_usd": round(deepgram_usd, 5), "llm_usd": round(llm_usd, 5), "total_usd": total}


_db().close()   # ensure table exists at startup

DEICTICS = {
    "this", "that", "here", "there", "these", "those", "it",
    "look", "see", "move", "change", "fix", "make", "remove", "delete", "add",
    "bigger", "smaller", "larger", "left", "right", "up", "down",
    "align", "color", "colour", "font", "spacing", "padding", "button", "text",
}

SYSTEM = """You turn a founder's spoken, point-and-talk walkthrough of a UI into a \
precise change list for a coding agent (Cursor / Claude Code).

You get numbered screenshots, each with a RED MARKER at exactly where the person \
pointed, plus what they said at that moment, plus the full narration. The marker + \
image are the source of truth — interpret the words IN TANDEM with what the marker \
sits on. Do not treat the transcript as standalone notes.

Rules:
- One section per marked screenshot, in order: `## N — <short title>`.
- Embed the image `![N](frames/N.png)`, then a tight bullet list of the concrete \
change(s), grounded in what the marker points at + what was said. Name the element.
- The transcription may be rough/garbled — infer intent from the image + context; \
never invent changes that aren't implied by the marker or speech.
- If genuinely ambiguous, add `> Clarify:` with the exact question.
- If a marker has no actionable intent, say so briefly rather than padding.
- Output ONLY the markdown for feedback.md. No preamble."""


def _ffmpeg_wav(src: Path) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
        out = Path(t.name)
    try:
        r = subprocess.run(["ffmpeg", "-y", "-i", str(src), "-ar", "16000", "-ac", "1", str(out)],
                           capture_output=True, timeout=120)
        return out.read_bytes() if r.returncode == 0 else src.read_bytes()
    finally:
        out.unlink(missing_ok=True)


def _deepgram(wav: bytes, language: str = "multi") -> tuple[str, list[dict], float]:
    if not DEEPGRAM_KEY:
        return "", [], 0.0
    # nova-3 accepts ISO codes like "en", "es", "fr", "de", "pt", "it", "nl",
    # "ja", "ko", "zh", "hi" — or "multi" for auto-detect. A single language is
    # measurably more accurate than "multi" so we let the Mac app pick.
    lang = (language or "multi").strip() or "multi"
    params = {"model": "nova-3", "language": lang, "punctuate": "true", "smart_format": "true"}
    resp = requests.post(
        "https://api.deepgram.com/v1/listen",
        params=params,
        headers={"Authorization": f"Token {DEEPGRAM_KEY}", "Content-Type": "audio/wav"},
        data=wav, timeout=180,
    )
    resp.raise_for_status()
    data = resp.json()
    alt = data["results"]["channels"][0]["alternatives"][0]
    words = [{"w": (x.get("punctuated_word") or x["word"]), "t": x["start"]} for x in alt.get("words", [])]
    duration = float(data.get("metadata", {}).get("duration", 0.0))
    return alt.get("transcript", ""), words, duration


def _cursor_at(t: float, points: list[dict]) -> tuple[float, float] | None:
    if not points:
        return None
    p = min(points, key=lambda p: abs(p["t"] - t))
    return p["x"], p["y"]


def _caption(words: list[dict], t: float, win: float = 4.0) -> str:
    return " ".join(w["w"] for w in words if abs(w["t"] - t) <= win).strip()


def _dwell_times(points: list[dict]) -> list[float]:
    if len(points) < 10:
        return []
    out, i = [], 0
    while i < len(points):
        j = i
        while j < len(points) and abs(points[j]["x"] - points[i]["x"]) < 12 and abs(points[j]["y"] - points[i]["y"]) < 12:
            j += 1
        if points[min(j, len(points) - 1)]["t"] - points[i]["t"] >= 0.6:
            out.append(points[(i + j) // 2]["t"])
            i = j
        else:
            i += 1
    return out


def _checkpoints(words: list[dict], points: list[dict]) -> list[dict]:
    hits = [w["t"] for w in words if w["w"].lower().strip(".,!?;:") in DEICTICS]
    if not hits:
        hits = _dwell_times(points)
    hits.sort()
    merged: list[float] = []
    for t in hits:
        if not merged or t - merged[-1] > 1.5:
            merged.append(t)
    cps = []
    for t in merged:
        pos = _cursor_at(t, points)
        if pos:
            cps.append({"t": t, "x": pos[0], "y": pos[1], "caption": _caption(words, t)})
    return cps


def _annotate(src: Path, dst: Path, x: float, y: float, dispW: float, dispH: float, idx: int) -> None:
    img = Image.open(src).convert("RGB")
    W, H = img.size
    scale = W / dispW if dispW else 1.0
    cx, cy = x * scale, H - (y * scale)        # AppKit bottom-left → PIL top-left
    r = 34 * scale
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 40, 40), width=max(3, int(6 * scale)))
    br = 22 * scale
    bx, by = cx + r * 0.72, cy - r * 0.72
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 40, 40))
    try:
        font = ImageFont.load_default(size=int(30 * scale))
    except Exception:
        font = ImageFont.load_default()
    d.text((bx, by), str(idx), fill=(255, 255, 255), anchor="mm", font=font)
    if img.width > 1100:                     # downscale for faster/cheaper Claude vision
        img = img.resize((1100, int(img.height * 1100 / img.width)), Image.LANCZOS)
    img.save(dst)


def _img_b64(session_dir: Path, n: int) -> str | None:
    png = session_dir / "frames" / f"{n}.png"
    return base64.standard_b64encode(png.read_bytes()).decode() if png.exists() else None


def _generate(session_dir: Path, items: list[dict], transcript: str) -> tuple[str, int, int]:
    return _openrouter(session_dir, items, transcript) if PROVIDER == "openrouter" \
        else _anthropic(session_dir, items, transcript)


def _anthropic(session_dir: Path, items: list[dict], transcript: str) -> tuple[str, int, int]:
    if not ANTHROPIC_KEY:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")
    content: list[dict] = [{"type": "text", "text": f"Full narration:\n{transcript or '(none)'}\n\nMarkers:"}]
    for it in items:
        content.append({"type": "text", "text": f"Marker {it['n']} — said: \"{it['caption']}\""})
        b64 = _img_b64(session_dir, it["n"])
        if b64:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}})
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": MODEL, "max_tokens": 4000, "system": SYSTEM,
              "messages": [{"role": "user", "content": content}]},
        timeout=120,
    )
    if resp.status_code != 200:
        raise HTTPException(502, f"Claude error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    usage = data.get("usage", {})
    return text, int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))


def _openrouter(session_dir: Path, items: list[dict], transcript: str) -> tuple[str, int, int]:
    if not OPENROUTER_KEY:
        raise HTTPException(500, "OPENROUTER_API_KEY not configured")
    content: list[dict] = [{"type": "text", "text": f"Full narration:\n{transcript or '(none)'}\n\nMarkers:"}]
    for it in items:
        content.append({"type": "text", "text": f"Marker {it['n']} — said: \"{it['caption']}\""})
        b64 = _img_b64(session_dir, it["n"])
        if b64:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
    resp = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
        json={"model": MODEL, "max_tokens": 4000,
              "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}]},
        timeout=120,
    )
    if resp.status_code != 200:
        raise HTTPException(502, f"OpenRouter error {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    text = data["choices"][0]["message"]["content"].strip()
    usage = data.get("usage", {})
    return text, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))


@app.get("/health")
def health() -> dict:
    return {"ok": True, "provider": PROVIDER, "model": MODEL,
            "anthropic": bool(ANTHROPIC_KEY), "openrouter": bool(OPENROUTER_KEY), "deepgram": bool(DEEPGRAM_KEY)}


@app.post("/waitlist")
async def waitlist(request: Request):
    """Mobile early-access capture. Appends to waitlist.tsv next to the sessions
    dir and emails the signup a confirmation that they're on the list."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    email = str(body.get("email", "")).strip()[:200]
    source = str(body.get("source", ""))[:40]
    if not email or "@" not in email:
        return JSONResponse({"ok": False}, status_code=400)
    try:
        with open(BASE_DIR.parent / "waitlist.tsv", "a", encoding="utf-8") as f:
            f.write(f"{int(time.time())}\t{source}\t{email}\n")
    except Exception as e:
        print("waitlist write failed:", e)
        send_alert("Waitlist write failed", f"{email}\n{e!r}")
    mailer.send_waitlist(email)
    print(f"[waitlist] {source} {email}")
    return JSONResponse({"ok": True})


# ── In-app auto-updater (Sparkle-lite) ───────────────────────────────────────
# Manifest lives at APP_DIR/appcast.json; signed/notarized zips in APP_DIR/dl.
# The Mac app polls /app/latest, compares CFBundleShortVersionString, then silently
# downloads + sha256-verifies the zip from /app/dl/<file> and stages it.
APP_DIR = BASE_DIR.parent / "app"
APP_DL_DIR = APP_DIR / "dl"


@app.get("/app/latest")
def app_latest() -> JSONResponse:
    """Return the update manifest the Mac app polls. Shape:
    {version, build, url, sha256, notes, minSystem, pubDate}. If no manifest
    has been published yet, return an empty 204-ish payload the app treats as
    'no update'."""
    manifest = APP_DIR / "appcast.json"
    if not manifest.exists():
        return JSONResponse({"version": None})
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except Exception as e:
        print("appcast read failed:", e)
        return JSONResponse({"version": None})
    return JSONResponse(data)


@app.get("/app/dl/{name}")
def app_download(name: str) -> Response:
    """Serve a published update artifact. Filename is whitelisted to plain
    basenames (no traversal) ending in .zip."""
    safe = os.path.basename(name)
    if safe != name or not safe.endswith(".zip") or "/" in safe or ".." in safe:
        raise HTTPException(status_code=400, detail="bad name")
    path = APP_DL_DIR / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(path, media_type="application/zip", filename=safe)


WAIT_MD = ("# Dis Dat — still processing ⏳\n\n"
           "This recording is still uploading / being analyzed. **Re-fetch this exact URL in about 15 seconds** "
           "and the full feedback (with image links) will be here. Don't make changes yet — wait for the real content.\n")


@app.get("/r/{sid}")
async def ready(sid: str, request: Request):
    """The handoff URL the agent fetches. The link the user pastes carries a signed token
    (?t=...) so the agent reads it without an account. Without a valid token we return a
    short note pointing the user to sign in.

    Long-poll: if the recording is still being processed we hold the request open
    (up to ~25s) polling for feedback.md, so the agent's single curl returns the
    finished result instead of giving up. Past the window we return WAIT_MD so the
    agent re-fetches the same URL (the message tells it to).

    Token verification happens inside session_file_response, which also rewrites image
    links to absolute signed URLs (so the agent can pull frames too)."""
    sid = "".join(c for c in sid if c.isalnum() or c in "_-")[:32]
    fb = BASE_DIR / sid / "feedback.md"
    # Hold the connection open until the result is ready — so the agent's single
    # curl/fetch returns the finished feedback instead of having to re-poll. The
    # background pipeline ALWAYS writes feedback.md (success or fallback), so this
    # resolves quickly; the long ceiling is just a safety net for a slow model call.
    deadline = time.time() + 110.0
    while not fb.exists() and time.time() < deadline:
        await asyncio.sleep(0.6)
    if not fb.exists():
        return Response(WAIT_MD, media_type="text/markdown", status_code=200)
    try:
        return session_file_response(sid, "feedback.md", request)
    except HTTPException as e:
        if e.status_code in (401, 403):
            return Response(
                "# This Dis Dat link is private\n\nPaste the link from your app to your coding agent — "
                "it carries the signed access token. If you copied the link without it, open the Dis Dat "
                "library and copy it again.\n",
                media_type="text/markdown",
                status_code=200,
            )
        raise


@app.get("/transcript/{sid}")
async def transcript_ready(sid: str, request: Request, authorization: Optional[str] = Header(default=None)):
    """Onboarding playback: long-poll for the transcript + word timings (written
    to manifest.json by the background pipeline). Auth via the owner's Bearer JWT."""
    sid = "".join(c for c in sid if c.isalnum() or c in "_-")[:32]
    if not authorize_session_read(sid, request, authorization):
        return JSONResponse({"ready": False, "error": "unauthorized"}, status_code=403)
    mf = BASE_DIR / sid / "manifest.json"
    deadline = time.time() + 60.0
    while not mf.exists() and time.time() < deadline:
        await asyncio.sleep(0.6)
    if not mf.exists():
        return JSONResponse({"ready": False})
    try:
        data = json.loads(mf.read_text())
    except Exception:
        return JSONResponse({"ready": False})
    return JSONResponse({"ready": True, "transcript": data.get("transcript", ""), "words": data.get("words", [])})


def _process_session(sid: str, sdir: Path, m: dict, owner_id: str) -> None:
    """Heavy pipeline (deepgram → markers → Claude), run in a BACKGROUND thread so
    /upload can return the handoff link instantly. ALWAYS writes feedback.md last —
    success OR a graceful fallback — so the /r long-poll can never hang forever."""
    raw = sdir / "raw"
    try:
        language = str(m.get("language") or "multi") or "multi"
        transcript: str = ""
        words: list = []
        audio_sec = 0.0
        t_dg = 0.0
        # Audio was saved under its uploaded filename; find it.
        apath = raw / "audio.caf"
        if not apath.exists():
            cands = sorted(raw.glob("*.caf")) or sorted(raw.glob("audio*"))
            if cands:
                apath = cands[0]
        if apath.exists():
            try:
                _t = time.perf_counter()
                transcript, words, audio_sec = _deepgram(_ffmpeg_wav(apath), language=language)
                t_dg = time.perf_counter() - _t
            except Exception as e:
                print("deepgram failed:", e)
                send_alert("Deepgram failed", f"session={sid}\nlang={language}\n{e!r}")

        points = m.get("points", [])
        dispW, dispH = m.get("displayW", 1440), m.get("displayH", 900)
        frame_index = {fr["idx"]: fr["t"] for fr in m.get("frames", [])}

        def nearest_frame(t: float):
            if not frame_index:
                return None
            idx = min(frame_index, key=lambda i: abs(frame_index[i] - t))
            p = raw / f"f{idx}.jpg"
            return p if p.exists() else None

        items: list[dict] = []
        for n, cp in enumerate(_checkpoints(words, points), start=1):
            fr = nearest_frame(cp["t"])
            if not fr:
                continue
            _annotate(fr, sdir / "frames" / f"{n}.png", cp["x"], cp["y"], dispW, dispH, n)
            items.append({"n": n, "caption": cp["caption"], "image": f"frames/{n}.png"})

        in_tok = out_tok = 0
        _t = time.perf_counter()
        if items:
            try:
                feedback, in_tok, out_tok = _generate(sdir, items, transcript)
            except Exception as e:
                print("generate failed:", e)
                send_alert("Claude generate failed", f"session={sid}\nmarkers={len(items)}\n{e!r}")
                bullets = "\n".join(f"{it['n']}. {it['caption']}" for it in items)
                feedback = ("# feedback.md\n\nCouldn't auto-write the summary, but here's what I "
                            f"captured — apply each in order:\n\n{bullets}\n\n> Transcript: {transcript or '(none)'}")
        else:
            feedback = "# feedback.md\n\nNo pointing moments detected. Re-record pointing at your UI and saying what to change."
        t_claude = time.perf_counter() - _t
        spend = _record_spend(sid, audio_sec, in_tok, out_tok, len(items))
        print(f"[timing] sid={sid} markers={len(items)} deepgram={t_dg:.1f}s claude={t_claude:.1f}s spend=${spend['total_usd']}")
        # manifest first (transcript for onboarding), then feedback.md LAST as the
        # readiness signal the /r long-poll waits on.
        (sdir / "manifest.json").write_text(json.dumps(
            {"transcript": transcript, "words": words, "items": items, "owner_id": owner_id}, indent=2))
        (sdir / "feedback.md").write_text(feedback, encoding="utf-8")
        register_session(sid, owner_id, audio_sec)   # update real audio_sec
        try:
            (sdir / "raw").rename(sdir / "_raw_done")
        except Exception:
            pass
    except Exception:
        import traceback
        tb = traceback.format_exc()
        print("PROCESS FAILED:", tb)
        send_alert(f"Processing crashed {sid}", tb)
        # Never leave the agent's long-poll hanging — always leave something fetchable.
        try:
            (sdir / "feedback.md").write_text(
                "# feedback.md\n\nSomething went wrong processing this recording — please "
                "re-record. (We've been notified and are on it.)\n", encoding="utf-8")
        except Exception:
            pass


@app.post("/upload")
async def upload(
    meta: str = Form(...),
    audio: UploadFile | None = None,
    frames: list[UploadFile] = [],
    user: User = Depends(current_user),
) -> JSONResponse:
    if not user.in_paying_window():
        raise HTTPException(402, "Trial ended or subscription canceled — upgrade at /account to keep recording.")
    try:
        m = json.loads(meta)
    except json.JSONDecodeError:
        raise HTTPException(400, "meta is not valid JSON")

    sid = "".join(c for c in (m.get("session_id") or "") if c.isalnum() or c in "_-")[:32] or secrets.token_urlsafe(9)
    sdir = BASE_DIR / sid
    raw = sdir / "raw"
    (sdir / "frames").mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)

    # Save the raw uploads (fast I/O) — must read them inside the request.
    for f in frames:
        name = os.path.basename(f.filename or "")
        if name:
            (raw / name).write_bytes(await f.read())
    if audio is not None:
        apath = raw / (os.path.basename(audio.filename or "audio.caf") or "audio.caf")
        apath.write_bytes(await audio.read())

    # Register NOW so the signed link authorizes immediately, then mint it and
    # return it RIGHT AWAY — the heavy pipeline runs in the background.
    register_session(sid, user.id, 0.0)
    handoff_token = mint_signed_token(sid, user.id, ttl=86400)
    base = os.getenv("PUBLIC_API", PUBLIC_BASE.rsplit("/s", 1)[0]) or PUBLIC_BASE.rsplit("/s", 1)[0]
    handoff_url = f"{base}/r/{sid}?t={handoff_token}"

    threading.Thread(target=_process_session, args=(sid, sdir, m, user.id), daemon=True).start()

    return JSONResponse({"id": sid, "url": handoff_url, "feedback_url": handoff_url, "processing": True})


@app.get("/spend")
def spend_summary() -> dict:
    try:
        con = _db()
        cur = con.execute("SELECT COUNT(*), COALESCE(SUM(total_usd),0), COALESCE(SUM(audio_sec),0) FROM spend")
        n, total, audio = cur.fetchone()
        rows = con.execute(
            "SELECT ts, session_id, audio_sec, deepgram_usd, in_tokens, out_tokens, llm_usd, total_usd, markers FROM spend ORDER BY id DESC LIMIT 25"
        ).fetchall()
        con.close()
        cols = ["ts", "session_id", "audio_sec", "deepgram_usd", "in_tokens", "out_tokens", "llm_usd", "total_usd", "markers"]
        return {
            "sessions": n,
            "total_usd": round(total, 4),
            "total_audio_min": round(audio / 60.0, 1),
            "avg_usd_per_session": round(total / n, 5) if n else 0,
            "recent": [dict(zip(cols, r)) for r in rows],
        }
    except Exception as e:
        raise HTTPException(500, f"spend query failed: {e}")
