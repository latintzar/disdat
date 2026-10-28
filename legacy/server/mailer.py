"""Send mail "as" operator@example.invalid via the Gmail API using a stored OAuth refresh
token — the same Google "Send mail as" connection founder-hermes / Sancho use.

Zero external deps (urllib only). Env:
  GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
  FROM_EMAIL  (default operator@example.invalid — must be a VERIFIED "Send mail as" alias
               on the account that owns the refresh token)
  FROM_NAME   (default "Peter · Dis Dat")
"""
from __future__ import annotations

import base64
import json
import os
import threading
import urllib.parse
import urllib.request

CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
REFRESH_TOKEN = os.getenv("GOOGLE_OAUTH_REFRESH_TOKEN", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "operator@example.invalid")
FROM_NAME = os.getenv("FROM_NAME", "Peter from Dis Dat")

BRAND_INK = "#16110D"
BRAND_CREAM = "#FBF7EE"
BRAND_ORANGE = "#FF5C2A"


def _access_token() -> str:
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token", data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=15) as r:
        j = json.loads(r.read().decode())
    return j["access_token"]


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _rfc2047(value: str) -> str:
    if all(ord(c) < 128 for c in value):
        return value
    return "=?UTF-8?B?" + base64.b64encode(value.encode("utf-8")).decode() + "?="


RESEND_KEY = os.getenv("RESEND_API_KEY", "")


def _send_resend(to: str, subject: str, html: str) -> bool:
    """Primary transport: Resend on the VERIFIED your-site.example domain (DKIM-signed, no Gmail alias/quotas)."""
    if not RESEND_KEY:
        return False
    try:
        body = json.dumps({"from": f"{FROM_NAME} <{FROM_EMAIL}>", "to": [to], "subject": subject, "html": html}).encode()
        req = urllib.request.Request(
            "https://api.resend.com/emails", data=body,
            # a real UA: Cloudflare fronts api.resend.com and 403s (error 1010) the default Python-urllib agent
            headers={"Authorization": f"Bearer {RESEND_KEY}", "Content-Type": "application/json", "User-Agent": "disdat-mailer/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = 200 <= r.status < 300
        print(f"[mailer] resend sent to {to}: {subject!r} ok={ok}")
        return ok
    except Exception as e:
        print(f"[mailer] resend failed to {to}: {e!r}")
        return False


def send_email_as(to: str, subject: str, html: str) -> bool:
    """Send an HTML email as FROM_EMAIL. Resend (verified your-site.example) first; Gmail alias fallback. Never raises."""
    if _send_resend(to, subject, html):
        return True
    if not (CLIENT_ID and CLIENT_SECRET and REFRESH_TOKEN):
        print("[mailer] skipped — missing GOOGLE_OAUTH_* env")
        return False
    try:
        token = _access_token()
        frm = f"{_rfc2047(FROM_NAME)} <{FROM_EMAIL}>"
        raw = "\r\n".join([
            f"From: {frm}",
            f"To: {to}",
            f"Subject: {_rfc2047(subject)}",
            "MIME-Version: 1.0",
            'Content-Type: text/html; charset="UTF-8"',
            "Content-Transfer-Encoding: base64",
            "",
            base64.b64encode(html.encode("utf-8")).decode(),
        ])
        body = json.dumps({"raw": _b64url(raw.encode("utf-8"))}).encode()
        req = urllib.request.Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            data=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            ok = 200 <= r.status < 300
        print(f"[mailer] sent to {to}: {subject!r} ok={ok}")
        return ok
    except Exception as e:
        print(f"[mailer] send failed to {to}: {e!r}")
        return False


def send_async(to: str, subject: str, html: str) -> None:
    """Fire-and-forget — never block or break the request path."""
    threading.Thread(target=send_email_as, args=(to, subject, html), daemon=True).start()


# ── Templates ────────────────────────────────────────────────────────────────

def _shell(inner: str) -> str:
    return f"""<!doctype html><html><body style="margin:0;padding:0;background:#f1efe9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Talk and point. Your agent ships.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efe9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e9e6df;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;">
<tr><td align="center" style="padding:38px 36px 0 36px;">
  <img src="https://example.invalid/icon-1024.png" width="56" height="56" alt="Dis Dat" style="display:block;border-radius:13px;" />
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:700;color:{BRAND_INK};letter-spacing:-0.01em;margin-top:10px;">Dis Dat</div>
</td></tr>
{inner}
<tr><td style="padding:22px 36px 30px 36px;border-top:1px solid #f0eee9;">
  <p style="margin:0 0 6px 0;color:#9a958c;font-size:12px;line-height:1.5;">
    You're getting this because you created a Dis Dat account. Something broken or confusing?
    Just reply to this email — a human answers.
  </p>
  <p style="margin:0;color:#b8b3a9;font-size:11px;line-height:1.6;">
    © 2026 Leo Casa Ltd · Company No. 16259714<br/>
    Suite 402, 2 Old Brompton Road, London SW7 3DQ, United Kingdom<br/>
    <a href="https://example.invalid" style="color:#b8b3a9;">your-site.example</a> ·
    <a href="https://example.invalid/privacy" style="color:#b8b3a9;">Privacy</a>
  </p>
</td></tr>
</table>
</td></tr></table></body></html>"""


def welcome_html() -> str:
    keycap = (f"display:inline-block;background:#fff;border:1px solid rgba(22,17,13,0.18);"
              f"border-radius:6px;padding:2px 7px;font-size:12px;font-weight:600;color:{BRAND_INK};"
              f"font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 1px;")
    steps = [
        "On any page, click the <b>Dis Dat</b> icon in your Chrome toolbar and hit <b>Start</b>.",
        "Just talk while you point, hover and scroll — even across pages.",
        "Hit <b>Stop</b> — the capture copies itself. Paste it at Claude Code, Cursor, Codex or Lovable.",
    ]
    rows = "".join(
        f"""<tr><td style="padding:6px 0;" valign="top">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="width:26px;">
            <div style="width:20px;height:20px;border-radius:50%;background:{BRAND_ORANGE};color:#fff;
              font-size:12px;font-weight:700;text-align:center;line-height:20px;">{i+1}</div></td>
          <td style="padding-left:10px;color:{BRAND_INK};font-size:14px;line-height:1.5;">{s}</td>
          </tr></table></td></tr>"""
        for i, s in enumerate(steps))
    inner = f"""<tr><td align="center" style="padding:22px 36px 0 36px;">
  <h1 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:{BRAND_INK};font-weight:700;">Welcome to Dis Dat</h1>
  <p style="margin:0 0 6px 0;color:#5f5a52;font-size:15px;line-height:1.55;">
    Show your coding agent exactly what you mean: talk and point at any page, and it gets the real
    elements, styles and motion — not a screenshot.
  </p>
  <p style="margin:0 0 18px 0;color:#9a958c;font-size:13px;">You have <b style="color:{BRAND_INK};">30 free minutes</b> — no card.</p>
</td></tr>
<tr><td align="center" style="padding:0 24px 6px 24px;">
  <a href="https://example.invalid"><img src="https://example.invalid/media/disdat-hero-email.gif" width="432" alt="Dis Dat capturing a page" style="display:block;width:100%;max-width:432px;border-radius:12px;border:1px solid #e9e6df;" /></a>
</td></tr>
<tr><td style="padding:0 36px 8px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>
</td></tr>
<tr><td align="center" style="padding:10px 36px 24px 36px;">
  <a href="https://example.invalid/account" style="display:inline-block;background:{BRAND_ORANGE};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:999px;">Your account</a>
</td></tr>"""
    return _shell(inner)


def send_welcome(to: str) -> None:
    if not to or "@" not in to:
        return
    send_async(to, "Welcome to Dis Dat", welcome_html())


def pro_html() -> str:
    inner = f"""<tr><td align="center" style="padding:22px 36px 0 36px;">
  <h1 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:{BRAND_INK};font-weight:700;">You're on Dis Dat Pro</h1>
  <p style="margin:0;color:#5f5a52;font-size:15px;line-height:1.55;">
    Thank you — that genuinely means a lot. You've now got 500 minutes every month, priority support, and first access to everything new.
  </p>
</td></tr>
<tr><td style="padding:20px 36px 6px 36px;">
  <p style="margin:0;color:{BRAND_INK};font-size:14px;line-height:1.5;">Keep pressing the shortcut and talking — I'll keep making it better. If anything's ever off, just reply to this email.</p>
  <p style="margin:18px 0 0 0;color:{BRAND_INK};font-size:14px;">— Peter<br/><span style="color:#9a958c;">Founder, Dis Dat</span></p>
</td></tr>"""
    return _shell(inner)


def send_pro(to: str) -> None:
    if not to or "@" not in to:
        return
    send_async(to, "You're on Dis Dat Pro", pro_html())


def waitlist_html() -> str:
    inner = f"""<tr><td align="center" style="padding:22px 36px 0 36px;">
  <h1 style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:{BRAND_INK};font-weight:700;">You're on the early-access list</h1>
  <p style="margin:0;color:#5f5a52;font-size:15px;line-height:1.55;">
    Thanks for raising your hand for Dis Dat on mobile. You're in — I'll email you the moment the phone app is ready for its first batch of testers.
  </p>
</td></tr>
<tr><td style="padding:20px 36px 6px 36px;">
  <p style="margin:0;color:{BRAND_INK};font-size:14px;line-height:1.5;">In the meantime, the Mac app is live if you want to start talking-and-pointing today.</p>
  <p style="margin:16px 0 0 0;"><a href="https://example.invalid/download" style="display:inline-block;background:{BRAND_ORANGE};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 24px;border-radius:999px;">Download Dis Dat for Mac</a></p>
  <p style="margin:20px 0 0 0;color:{BRAND_INK};font-size:14px;">— Peter<br/><span style="color:#9a958c;">Founder, Dis Dat</span></p>
</td></tr>"""
    return _shell(inner)


def send_waitlist(to: str) -> None:
    if not to or "@" not in to:
        return
    send_async(to, "You're on the Dis Dat early-access list", waitlist_html())
