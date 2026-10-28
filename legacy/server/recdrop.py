"""Peter's recording drop — upload any audio/video through HTTPS, get a diarized transcript back.

Same engine as the Hermes call-recorder pipeline and the peter-transcribe CLI:
ffmpeg → 16 kHz **mono / single-channel** → Deepgram nova-3 with
diarize + utterances + smart_format + paragraphs, language=multi (nova-3 native
multilingual — never pin es, it butchers code-switching). Speakers are separated by
diarization on the single mixed channel, not by audio channels.

Flow: agent mints a token into /path/to/configure hands Peter
https://example.invalid/rec/<token>. The link is reusable. Uploads land in
/path/to/configure<job>/ with meta.json, the source file, transcript.md
and raw Deepgram JSON — readable over SSH by the agent.
"""
from __future__ import annotations

import datetime
import json
import os
import pathlib
import re
import secrets
import subprocess
import tempfile
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import requests
from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

router = APIRouter()

ROOT = pathlib.Path(os.getenv("DISDAT_RECDROP_DIR", str(pathlib.Path.home() / ".local/state/disdat/recdrop")))
RECDIR = ROOT / "recordings"
TOKFILE = ROOT / "rec_tokens.txt"
RECDIR.mkdir(parents=True, exist_ok=True)

TOK = re.compile(r"^[a-f0-9]{16,64}$")
JID = re.compile(r"^[a-f0-9]{12,32}$")
DG_URL = "https://api.deepgram.com/v1/listen"
MAX_BYTES = 500 * 1024 * 1024          # Caddy caps the request body at 512 MB
WAV_TO_FLAC_ABOVE = 200 * 1024 * 1024  # keep WAV (Hermes parity) until it gets silly

_POOL = ThreadPoolExecutor(max_workers=2)
_LOCK = threading.Lock()


# ── token / job plumbing ──────────────────────────────────────────────

def _tokens() -> set[str]:
    if not TOKFILE.exists():
        return set()
    return {l.strip() for l in TOKFILE.read_text().splitlines() if l.strip() and not l.startswith("#")}


def _auth(token: str) -> None:
    if not TOK.fullmatch(token) or token not in _tokens():
        raise HTTPException(404)


def _jobdir(jid: str) -> pathlib.Path:
    return RECDIR / jid


def _meta(jid: str) -> dict:
    p = _jobdir(jid) / "meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


def _write_meta(job: str, **kw) -> dict:
    with _LOCK:
        p = _jobdir(job) / "meta.json"
        m = json.loads(p.read_text()) if p.exists() else {}
        m.update(kw)
        p.write_text(json.dumps(m))
        return m


def _jobs_for(token: str, limit: int = 25) -> list[dict]:
    out = []
    for d in sorted(RECDIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not d.is_dir():
            continue
        m = _meta(d.name)
        if m.get("token") == token:
            out.append(m)
        if len(out) >= limit:
            break
    return out


def _hms(s) -> str:
    return str(datetime.timedelta(seconds=int(s or 0)))


# ── the pipeline (mirrors peter-transcribe / call-recorder) ───────────

def _to_mono(src: pathlib.Path) -> pathlib.Path:
    """Any audio/video → 16 kHz SINGLE-CHANNEL audio. FLAC (lossless) for big files."""
    big = src.stat().st_size > WAV_TO_FLAC_ABOVE
    out = pathlib.Path(tempfile.mkstemp(suffix=".flac" if big else ".wav")[1])
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", "16000", "-vn", str(out)],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        raise RuntimeError("ffmpeg could not read that file:\n" + r.stderr[-600:])
    return out


def _deepgram(audio: pathlib.Path, keyterms: list[str] | None, lang: str) -> dict:
    key = (os.getenv("DEEPGRAM_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("DEEPGRAM_API_KEY missing on the server")
    params = [("model", "nova-3"), ("language", lang), ("punctuate", "true"),
              ("utterances", "true"), ("smart_format", "true"),
              ("paragraphs", "true"), ("diarize", "true")]
    params += [("keyterm", k) for k in (keyterms or [])]
    ctype = "audio/flac" if audio.suffix == ".flac" else "audio/wav"
    with audio.open("rb") as fh:
        r = requests.post(DG_URL, params=params, data=fh, timeout=1800,
                          headers={"Authorization": "Token " + key, "Content-Type": ctype})
    if r.status_code != 200:
        if keyterms:  # keyterm prompting is best-effort — retry plain
            return _deepgram(audio, None, lang)
        raise RuntimeError("Deepgram %s: %s" % (r.status_code, r.text[:400]))
    return r.json()


def _render(data: dict) -> str:
    utts = data.get("results", {}).get("utterances", [])
    if not utts:
        return data["results"]["channels"][0]["alternatives"][0].get("transcript", "(empty)")
    turns, spk, start, buf = [], None, None, []
    for u in utts:
        s = u.get("speaker", 0)
        if s != spk:
            if buf:
                turns.append((start, spk, " ".join(buf)))
            spk, start, buf = s, u["start"], [u["transcript"]]
        else:
            buf.append(u["transcript"])
    if buf:
        turns.append((start, spk, " ".join(buf)))
    return "\n\n".join("**[%s] Speaker %s:** %s" % (_hms(st), sp, tx) for st, sp, tx in turns)


def _run_job(jid: str) -> None:
    d, mono = _jobdir(jid), None
    try:
        m = _meta(jid)
        src = d / m["filename"]
        _write_meta(jid, status="converting")
        mono = _to_mono(src)
        _write_meta(jid, status="transcribing", audio_seconds=None)
        data = _deepgram(mono, m.get("keyterms") or None, m.get("lang", "multi"))
        md = _render(data)
        dur = data.get("metadata", {}).get("duration", 0)
        header = "# Transcript — %s  (%s, nova-3 diarized, single channel)\n\n" % (m["filename"], _hms(dur))
        (d / "transcript.md").write_text(header + md + "\n")
        (d / "raw.json").write_text(json.dumps(data))
        spk = sorted({u.get("speaker", 0) for u in data.get("results", {}).get("utterances", [])})
        _write_meta(jid, status="done", duration=dur, speakers=len(spk) or 1,
                    words=len(data.get("results", {}).get("channels", [{}])[0]
                              .get("alternatives", [{}])[0].get("words", [])),
                    finished=int(time.time()))
    except Exception as e:
        traceback.print_exc()
        _write_meta(jid, status="error", error=str(e)[:600], finished=int(time.time()))
    finally:
        if mono:
            try:
                mono.unlink(missing_ok=True)
            except Exception:
                pass


# ── pages ─────────────────────────────────────────────────────────────

_CSS = """
*{box-sizing:border-box}
body{max-width:680px;margin:0 auto;padding:40px 20px 80px;font:16px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#16110D;background:#FBF7EE}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:#8a7859;font-size:13.5px;margin:0 0 26px}
.card{background:#fff;border:1px solid rgba(28,18,6,.12);border-radius:16px;padding:20px}
label{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a7859;margin:0 0 7px}
input[type=text],select{width:100%;background:#FBF7EE;border:1px solid rgba(28,18,6,.16);border-radius:10px;padding:11px 12px;font-size:14.5px;color:#16110D;font-family:inherit}
.drop{border:1.5px dashed rgba(28,18,6,.24);border-radius:14px;padding:30px 18px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.drop:hover,.drop.over{border-color:#FF5C2A;background:#fff6f2}
.drop b{display:block;font-size:15px;margin-bottom:3px}
.drop span{font-size:13px;color:#8a7859}
.file{display:flex;gap:10px;align-items:center;font-size:14px;margin-top:12px;padding:11px 13px;background:#FBF7EE;border-radius:10px;border:1px solid rgba(28,18,6,.1)}
.file b{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file i{font-style:normal;color:#8a7859;font-size:12.5px}
.row{margin-top:18px}
button{width:100%;margin-top:20px;background:#FF5C2A;color:#fff;border:0;border-radius:12px;padding:15px;font-size:15.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:background .15s}
button:hover:not(:disabled){background:#16110D}
button:disabled{opacity:.45;cursor:default}
.bar{height:6px;background:rgba(28,18,6,.1);border-radius:99px;overflow:hidden;margin-top:16px;display:none}
.bar>div{height:100%;width:0;background:#FF5C2A;transition:width .2s}
.note{font-size:12.5px;color:#a08a6a;margin-top:16px;line-height:1.5}
h2{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a7859;margin:34px 0 10px}
a.job{display:flex;gap:12px;align-items:center;text-decoration:none;color:inherit;background:#fff;border:1px solid rgba(28,18,6,.12);border-radius:12px;padding:13px 15px;margin-bottom:8px}
a.job:hover{border-color:#FF5C2A}
a.job b{flex:1;font-weight:600;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{font-size:11px;font-weight:700;font-style:normal;letter-spacing:.04em;text-transform:uppercase;padding:4px 9px;border-radius:99px;white-space:nowrap}
.pill.done{background:#e8f5ec;color:#1f7a3d}.pill.error{background:#fdeeee;color:#c0142b}
.pill.work{background:#fff1e9;color:#c2470f}
pre{white-space:pre-wrap;word-wrap:break-word;font:14.5px/1.75 -apple-system,system-ui,sans-serif;margin:0}
pre b{color:#c2470f}
.tools{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}
.tools a,.tools button{width:auto;margin:0;padding:9px 15px;font-size:13.5px;border-radius:10px;background:#fff;color:#16110D;border:1px solid rgba(28,18,6,.16);text-decoration:none;font-weight:600;display:inline-block}
.tools a:hover,.tools button:hover{background:#16110D;color:#fff;border-color:#16110D}
.back{font-size:13.5px;color:#8a7859;text-decoration:none;display:inline-block;margin-bottom:18px}
.err{background:#fdeeee;border:1px solid #c0142b33;color:#c0142b;border-radius:12px;padding:15px;font-size:14px}
"""

_SHELL = """<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<meta name=robots content="noindex,nofollow"><title>{title}</title>
<style>{css}</style></head><body>{body}</body></html>"""


def _page(title: str, body: str) -> str:
    return _SHELL.format(title=title, css=_CSS, body=body)


def _job_row(m: dict) -> str:
    st = m.get("status", "queued")
    cls = "done" if st == "done" else ("error" if st == "error" else "work")
    meta = _hms(m.get("duration")) + " · %s speakers" % m.get("speakers", "?") if st == "done" else st
    return ('<a class="job" href="/rec/{t}/t/{j}"><b>{n}</b><i class="pill {c}">{m}</i></a>'
            .format(t=m["token"], j=m["jid"], n=m.get("filename", "?"), c=cls, m=meta))


@router.get("/rec/{token}", response_class=HTMLResponse)
def rec_form(token: str) -> str:
    _auth(token)
    jobs = _jobs_for(token)
    recent = ("<h2>Recent</h2>" + "".join(_job_row(m) for m in jobs)) if jobs else ""
    body = """
<h1>Transcribe a recording</h1>
<p class="sub">Deepgram nova-3 · speaker diarization · single channel · multilingual — English, French
and Spanish can switch mid-sentence and it keeps up</p>
<div class="card">
  <div class="drop" id="drop">
    <b>Choose a file or drop it here</b>
    <span>audio or video — mp3, m4a, wav, mp4, mov… up to 500&nbsp;MB</span>
  </div>
  <input type="file" id="f" accept="audio/*,video/*" hidden>
  <div class="file" id="picked" style="display:none"><b id="fname"></b><i id="fsize"></i></div>
  <div class="row">
    <label for="k">Names to spell right <span style="text-transform:none;font-weight:400">(optional)</span></label>
    <input type="text" id="k" placeholder="Aptar, Sancho y Panza, Rocoto, Sage 50…" autocomplete="off">
  </div>
  <button id="go" disabled>Transcribe</button>
  <div class="bar" id="bar"><div id="fill"></div></div>
  <p class="note" id="note">The audio is mixed down to one mono channel — speakers are separated
  by diarization, not by tracks. Takes roughly a tenth of the recording's length. Every transcript
  is kept as .md + raw .json and mirrored to <code>~/incoming/transcripts/</code> on leo-dev.</p>
</div>
{recent}
<script>
const TOKEN={tok};
const f=document.getElementById('f'),drop=document.getElementById('drop'),go=document.getElementById('go');
const picked=document.getElementById('picked'),bar=document.getElementById('bar'),fill=document.getElementById('fill'),note=document.getElementById('note');
const fmt=b=>b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';
drop.onclick=()=>f.click();
drop.ondragover=e=>{{e.preventDefault();drop.classList.add('over')}};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{{e.preventDefault();drop.classList.remove('over');if(e.dataTransfer.files[0]){{f.files=e.dataTransfer.files;show()}}}};
f.onchange=show;
function show(){{const x=f.files[0];if(!x)return;
  document.getElementById('fname').textContent=x.name;
  document.getElementById('fsize').textContent=fmt(x.size);
  picked.style.display='flex';go.disabled=false;}}
go.onclick=()=>{{
  const x=f.files[0];if(!x)return;
  if(x.size>500*1024*1024){{note.textContent='That file is over 500 MB — trim it or export audio only.';return}}
  go.disabled=true;go.textContent='Uploading…';bar.style.display='block';
  const fd=new FormData();fd.append('file',x);fd.append('keyterms',document.getElementById('k').value);
  const xhr=new XMLHttpRequest();
  xhr.upload.onprogress=e=>{{if(e.lengthComputable)fill.style.width=(e.loaded/e.total*100)+'%'}};
  xhr.onload=()=>{{
    let r={{}};try{{r=JSON.parse(xhr.responseText)}}catch(e){{}}
    if(!r.jid){{note.textContent=r.error||'Upload failed — try again.';go.disabled=false;go.textContent='Transcribe';return}}
    go.textContent='Transcribing…';note.textContent='Uploaded. You can close this — the transcript keeps building.';
    location.href='/rec/'+TOKEN+'/t/'+r.jid;
  }};
  xhr.onerror=()=>{{note.textContent='Upload failed — check the connection and retry.';go.disabled=false;go.textContent='Transcribe'}};
  xhr.open('POST','/rec/'+TOKEN+'/upload');xhr.send(fd);
}};
</script>""".format(recent=recent, tok=json.dumps(token))
    return _page("Transcribe a recording", body)


@router.post("/rec/{token}/upload")
async def rec_upload(token: str, file: UploadFile, keyterms: str = Form(""), lang: str = Form("multi")):
    _auth(token)
    if not file or not file.filename:
        return JSONResponse({"error": "no file"}, 400)
    jid = secrets.token_hex(8)
    d = _jobdir(jid)
    d.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^\w.\- ]", "_", os.path.basename(file.filename))[:120] or "recording"
    dest, size = d / name, 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                return JSONResponse({"error": "file over 500 MB"}, 413)
            out.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        return JSONResponse({"error": "empty file"}, 400)
    _write_meta(jid, jid=jid, token=token, filename=name, bytes=size, status="queued",
                keyterms=[k.strip() for k in keyterms.split(",") if k.strip()],
                lang=(lang if lang in ("multi", "en") else "multi"), created=int(time.time()))
    _POOL.submit(_run_job, jid)
    return {"jid": jid, "url": f"/rec/{token}/t/{jid}"}


@router.get("/rec/{token}/job/{jid}")
def rec_status(token: str, jid: str) -> JSONResponse:
    _auth(token)
    if not JID.fullmatch(jid):
        raise HTTPException(404)
    m = _meta(jid)
    if m.get("token") != token:
        raise HTTPException(404)
    return JSONResponse({k: m.get(k) for k in
                         ("jid", "status", "filename", "duration", "speakers", "words", "error")})


@router.get("/rec/{token}/t/{jid}", response_class=HTMLResponse)
def rec_transcript(token: str, jid: str) -> str:
    _auth(token)
    if not JID.fullmatch(jid):
        raise HTTPException(404)
    m = _meta(jid)
    if m.get("token") != token:
        raise HTTPException(404)
    back = '<a class="back" href="/rec/%s">← Transcribe another</a>' % token
    st = m.get("status")
    if st == "error":
        body = back + "<h1>%s</h1><p class=sub>Failed</p><div class=err>%s</div>" % (
            m.get("filename", ""), m.get("error", "unknown error"))
        return _page("Failed", body)
    if st != "done":
        label = {"queued": "Queued…", "converting": "Reading the audio…",
                 "transcribing": "Transcribing + separating speakers…"}.get(st, "Working…")
        body = (back + "<h1>%s</h1><p class=sub id=s>%s</p>"
                "<div class=card><div class=bar style=\"display:block\"><div style=\"width:35%%;"
                "animation:p 1.4s ease-in-out infinite alternate\"></div></div>"
                "<p class=note>Safe to close this tab — it keeps running. Roughly a tenth of the "
                "recording's length.</p></div>"
                "<style>@keyframes p{from{margin-left:0}to{margin-left:65%%}}</style>"
                "<script>setInterval(async()=>{const r=await fetch(location.pathname.replace('/t/','/job/'));"
                "const j=await r.json();if(j.status==='done'||j.status==='error')location.reload();"
                "document.getElementById('s').textContent={queued:'Queued…',converting:'Reading the audio…',"
                "transcribing:'Transcribing + separating speakers…'}[j.status]||'Working…';},3000)</script>"
                ) % (m.get("filename", ""), label)
        return _page("Transcribing…", body)

    md = (_jobdir(jid) / "transcript.md").read_text()
    lines = md.split("\n", 2)[2] if md.startswith("#") else md
    html = ""
    for para in lines.strip().split("\n\n"):
        para = (para.replace("&", "&amp;").replace("<", "&lt;")
                .replace("**", "\x00", 1).replace("**", "\x01", 1))
        html += "<p>" + para.replace("\x00", "<b>").replace("\x01", "</b>") + "</p>"
    body = (back + "<h1>%s</h1><p class=sub>%s · %s speakers · nova-3 diarized · single channel</p>"
            '<div class="tools"><button onclick="navigator.clipboard.writeText(document.getElementById(\'raw\').value);'
            'this.textContent=\'Copied ✓\'">Copy transcript</button>'
            '<a href="/rec/%s/dl/%s/md">Download .md</a><a href="/rec/%s/dl/%s/json">Raw JSON</a></div>'
            '<div class="card"><pre>%s</pre></div>'
            '<textarea id="raw" style="position:absolute;left:-9999px">%s</textarea>'
            ) % (m.get("filename", ""), _hms(m.get("duration")), m.get("speakers", "?"),
                 token, jid, token, jid, html,
                 md.replace("&", "&amp;").replace("<", "&lt;"))
    return _page(m.get("filename", "Transcript"), body)


@router.get("/rec/{token}/dl/{jid}/{kind}")
def rec_download(token: str, jid: str, kind: str):
    _auth(token)
    if not JID.fullmatch(jid) or kind not in ("md", "json"):
        raise HTTPException(404)
    m = _meta(jid)
    if m.get("token") != token or m.get("status") != "done":
        raise HTTPException(404)
    f = _jobdir(jid) / ("transcript.md" if kind == "md" else "raw.json")
    stem = os.path.splitext(m.get("filename", "transcript"))[0]
    return FileResponse(f, filename=f"{stem}.{kind}",
                        media_type="text/markdown" if kind == "md" else "application/json")
