"""Dis Dat — auth, billing (Stripe Checkout + Portal + webhooks), library access control.

Boundary rules:
  • Supabase JWT (HS256, signed with SUPABASE_JWT_SECRET) is the ONLY thing that proves a user.
  • Every per-user endpoint goes through `current_user`, which verifies the JWT and lazily
    creates a row in `users` on first sight.
  • `/s/<sid>/...` static reads are gated by `authorize_session_read`: either bearer JWT for
    the owner, or a short-lived HMAC-signed URL minted by `/library/sign`.
  • There is no admin bypass. Peter's user_id is the same as any other user_id; he can only
    read his own sessions through this code path.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

import jwt as pyjwt
import stripe
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import JSONResponse, FileResponse, Response


# ── env / config ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://example.invalid")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")          # HS256 secret
LIBRARY_SIGNING_SECRET = os.getenv("LIBRARY_SIGNING_SECRET", "")    # HMAC for signed URLs
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO", "")                # Price id, recurring monthly
PUBLIC_SITE = os.getenv("PUBLIC_SITE", "https://example.invalid")
PUBLIC_API = os.getenv("PUBLIC_API", "https://example.invalid")
TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "14"))
SESSIONS_DIR = Path(os.getenv("BASE_DIR", "./sessions")).expanduser()
DB_PATH = Path(os.getenv("SPEND_DB", str(SESSIONS_DIR.parent / "disdat-spend.db")))

stripe.api_key = STRIPE_SECRET_KEY or None


# ── db schema (extends the spend table that already lives in DB_PATH) ────────
def _db() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH))
    con.execute("""CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,                   -- Supabase auth.users.id (uuid)
        email TEXT,
        stripe_customer_id TEXT,
        subscription_status TEXT DEFAULT 'none',
        trial_ends_at INTEGER,                 -- unix seconds
        created_at INTEGER
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS sessions_meta (
        id TEXT PRIMARY KEY,                   -- session_id (matches BASE_DIR/<id>/)
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        audio_sec REAL DEFAULT 0,
        has_report INTEGER DEFAULT 0,
        title TEXT,
        FOREIGN KEY(owner_id) REFERENCES users(id)
    )""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions_meta(owner_id, created_at DESC)")
    con.execute("""CREATE TABLE IF NOT EXISTS stripe_events (
        id TEXT PRIMARY KEY, type TEXT, received_at INTEGER
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS library_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        user_id TEXT,
        session_id TEXT,
        action TEXT,                           -- 'sign' | 'read' | 'list' | 'reject'
        ip TEXT,
        detail TEXT
    )""")
    return con


def _audit(user_id: Optional[str], session_id: Optional[str], action: str, ip: Optional[str], detail: str = "") -> None:
    try:
        con = _db()
        con.execute("INSERT INTO library_access (ts, user_id, session_id, action, ip, detail) VALUES (?,?,?,?,?,?)",
                    (int(time.time()), user_id, session_id, action, ip, detail))
        con.commit(); con.close()
    except Exception as e:
        print("audit failed:", e)


# ── auth ─────────────────────────────────────────────────────────────────────
class User:
    __slots__ = ("id", "email", "subscription_status", "trial_ends_at", "stripe_customer_id")

    def __init__(self, id: str, email: str, sub_status: str, trial_ends_at: Optional[int], scid: Optional[str]):
        self.id = id
        self.email = email
        self.subscription_status = sub_status
        self.trial_ends_at = trial_ends_at
        self.stripe_customer_id = scid

    def in_paying_window(self) -> bool:
        if self.subscription_status in ("active", "trialing"):
            return True
        if self.trial_ends_at and self.trial_ends_at > int(time.time()):
            return True
        return False


# Supabase can sign user access tokens two ways: the legacy HS256 shared secret
# (SUPABASE_JWT_SECRET) or — once "JWT signing keys" are enabled on the project —
# an asymmetric key (ES256/RS256) published at the project's JWKS endpoint. We
# accept both: pick the path off the token's `alg` header so existing HS256
# sessions and new asymmetric ones both verify.
_JWKS_URL = SUPABASE_URL.rstrip("/") + "/auth/v1/.well-known/jwks.json"
_jwks_client: Optional["pyjwt.PyJWKClient"] = None


def _get_jwks_client() -> "pyjwt.PyJWKClient":
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = pyjwt.PyJWKClient(_JWKS_URL)
    return _jwks_client


def _verify_supabase_jwt(token: str) -> dict[str, Any]:
    try:
        alg = pyjwt.get_unverified_header(token).get("alg", "")
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(401, f"invalid token: {e}")
    try:
        if alg == "HS256":
            if not SUPABASE_JWT_SECRET:
                raise HTTPException(500, "SUPABASE_JWT_SECRET not configured")
            return pyjwt.decode(
                token, SUPABASE_JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False}
            )
        # Asymmetric signing key — verify against the project's published JWKS.
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token).key
        return pyjwt.decode(
            token, signing_key, algorithms=["ES256", "RS256"], options={"verify_aud": False}
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "token expired")
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(401, f"invalid token: {e}")
    except HTTPException:
        raise
    except Exception as e:
        # JWKS fetch failures, unexpected key errors, etc.
        raise HTTPException(401, f"token verification failed: {e}")


def _upsert_user(user_id: str, email: str) -> User:
    """Mirror the auth.users row into our local `users` table on first sight.
    Creates a 14-day trial window from the first-seen timestamp."""
    now = int(time.time())
    con = _db()
    row = con.execute(
        "SELECT id, email, subscription_status, trial_ends_at, stripe_customer_id FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if row:
        # Keep email fresh
        if row[1] != email:
            con.execute("UPDATE users SET email = ? WHERE id = ?", (email, user_id))
            con.commit()
        u = User(row[0], email or row[1] or "", row[2] or "none", row[3], row[4])
    else:
        trial_end = now + TRIAL_DAYS * 86400
        # status starts 'none' — ONLY the Stripe webhook may set 'trialing'/'active'. (Signup used to stamp
        # 'trialing', which combined with the customer-id created at checkout-INTENT made ext_api._is_pro
        # treat anyone who merely OPENED the upgrade page as a paid Pro. trial_ends_at still drives the
        # library's in_paying_window, so that behavior is unchanged.)
        con.execute(
            "INSERT INTO users (id, email, subscription_status, trial_ends_at, created_at) VALUES (?,?,?,?,?)",
            (user_id, email, "none", trial_end, now),
        )
        con.commit()
        u = User(user_id, email, "none", trial_end, None)
        # New signup → send the branded welcome (fire-and-forget; never blocks)
        # and ping Peter so every signup surfaces in his inbox in real time.
        try:
            import mailer
            mailer.send_welcome(email)
            admin = os.getenv("ALERT_EMAIL", "operator@example.invalid")
            mailer.send_async(
                admin,
                f"[Dis Dat] New signup: {email}",
                f"<p style='font-family:-apple-system,sans-serif'>New Dis Dat account</p>"
                f"<p style='font-family:ui-monospace,monospace'><b>{email}</b><br/>"
                f"id {user_id}<br/>{time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(now))}</p>")
        except Exception as e:
            print("signup email failed:", e)
    con.close()
    return u


def current_user(authorization: Optional[str] = Header(default=None)) -> User:
    """FastAPI dependency. Verifies the bearer JWT and lazily creates the local user row."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing Authorization: Bearer <token>")
    token = authorization.split(" ", 1)[1].strip()
    claims = _verify_supabase_jwt(token)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "token missing sub")
    email = claims.get("email") or (claims.get("user_metadata") or {}).get("email") or ""
    return _upsert_user(sub, email)


def current_user_optional(authorization: Optional[str] = Header(default=None)) -> Optional[User]:
    if not authorization:
        return None
    try:
        return current_user(authorization)
    except HTTPException:
        return None


# ── signed URLs for library reads ────────────────────────────────────────────
def mint_signed_token(session_id: str, user_id: str, ttl: int = 300) -> str:
    if not LIBRARY_SIGNING_SECRET:
        raise HTTPException(500, "LIBRARY_SIGNING_SECRET not configured")
    expires = int(time.time()) + ttl
    payload = f"{session_id}|{user_id}|{expires}"
    sig = hmac.new(LIBRARY_SIGNING_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{payload}|{sig}".encode()).decode().rstrip("=")


def verify_signed_token(token: str, session_id: str) -> Optional[str]:
    """Returns user_id if signature + expiry + session_id all valid; else None."""
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode((token + pad).encode()).decode()
        sid, uid, exp_s, sig = raw.split("|")
        if sid != session_id:
            return None
        if int(exp_s) < int(time.time()):
            return None
        expected = hmac.new(LIBRARY_SIGNING_SECRET.encode(), f"{sid}|{uid}|{exp_s}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None
        return uid
    except Exception:
        return None


def authorize_session_read(session_id: str, request: Request, authorization: Optional[str]) -> Optional[str]:
    """Returns the authorized user_id, or None if denied. Logs every attempt."""
    con = _db()
    row = con.execute("SELECT owner_id FROM sessions_meta WHERE id = ?", (session_id,)).fetchone()
    con.close()
    if not row:
        _audit(None, session_id, "reject", request.client.host if request.client else None, "no such session")
        return None
    owner_id = row[0]

    # 1) Signed URL via ?t=
    t = request.query_params.get("t")
    if t:
        uid = verify_signed_token(t, session_id)
        if uid and uid == owner_id:
            _audit(uid, session_id, "read", request.client.host if request.client else None, "signed")
            return uid
        _audit(None, session_id, "reject", request.client.host if request.client else None, "bad signed token")
        return None

    # 2) Bearer JWT
    if authorization and authorization.lower().startswith("bearer "):
        try:
            claims = _verify_supabase_jwt(authorization.split(" ", 1)[1].strip())
            uid = claims.get("sub")
            if uid and uid == owner_id:
                _audit(uid, session_id, "read", request.client.host if request.client else None, "jwt")
                return uid
        except HTTPException:
            pass
    _audit(None, session_id, "reject", request.client.host if request.client else None, "no/wrong creds")
    return None


def register_session(session_id: str, owner_id: str, audio_sec: float) -> None:
    con = _db()
    con.execute(
        "INSERT OR REPLACE INTO sessions_meta (id, owner_id, created_at, audio_sec, has_report) VALUES (?,?,?,?,1)",
        (session_id, owner_id, int(time.time()), audio_sec),
    )
    con.commit(); con.close()


# ── stripe ───────────────────────────────────────────────────────────────────
def _ensure_stripe_customer(u: User) -> str:
    if u.stripe_customer_id:
        return u.stripe_customer_id
    if not STRIPE_SECRET_KEY:
        raise HTTPException(500, "STRIPE_SECRET_KEY not configured")
    c = stripe.Customer.create(email=u.email, metadata={"supabase_user_id": u.id})
    con = _db()
    con.execute("UPDATE users SET stripe_customer_id = ? WHERE id = ?", (c.id, u.id))
    con.commit(); con.close()
    u.stripe_customer_id = c.id
    return c.id


# ── router ───────────────────────────────────────────────────────────────────
router = APIRouter()


@router.get("/me")
def me(u: User = Depends(current_user)) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "subscription_status": u.subscription_status,
        "trial_ends_at": (
            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(u.trial_ends_at))
            if u.trial_ends_at else None
        ),
        "stripe_customer_id": u.stripe_customer_id,
        "in_paying_window": u.in_paying_window(),
    }


@router.post("/billing/checkout")
def billing_checkout(u: User = Depends(current_user)) -> JSONResponse:
    if not STRIPE_PRICE_PRO:
        raise HTTPException(500, "STRIPE_PRICE_PRO not configured")
    customer_id = _ensure_stripe_customer(u)
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": STRIPE_PRICE_PRO, "quantity": 1}],
        # no Stripe trial: the free tier IS the 30 metered minutes ("30 free min, then $7/mo") — a hidden
        # 14-day card-on-file trial on top would hand 500 min/mo away and contradict every price we show.
        subscription_data={"metadata": {"supabase_user_id": u.id}},
        success_url=f"{PUBLIC_SITE}/account?upgraded=1",
        cancel_url=f"{PUBLIC_SITE}/pricing",
        allow_promotion_codes=True,
    )
    return JSONResponse({"url": session.url})


@router.post("/billing/portal")
def billing_portal(u: User = Depends(current_user)) -> JSONResponse:
    if not u.stripe_customer_id:
        raise HTTPException(400, "no Stripe customer for this user yet")
    portal = stripe.billing_portal.Session.create(
        customer=u.stripe_customer_id,
        return_url=f"{PUBLIC_SITE}/account",
    )
    return JSONResponse({"url": portal.url})


@router.post("/billing/webhook")
async def billing_webhook(request: Request) -> JSONResponse:
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(500, "STRIPE_WEBHOOK_SECRET not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        raise HTTPException(400, f"bad webhook: {e}")

    # Idempotency
    con = _db()
    if con.execute("SELECT 1 FROM stripe_events WHERE id = ?", (event["id"],)).fetchone():
        con.close()
        return JSONResponse({"ok": True, "dedup": True})
    con.execute("INSERT INTO stripe_events (id, type, received_at) VALUES (?,?,?)",
                (event["id"], event["type"], int(time.time())))
    con.commit()

    typ = event["type"]
    obj = event["data"]["object"]

    def _set_status(customer_id: str, status: str) -> None:
        row = con.execute(
            "SELECT email, subscription_status FROM users WHERE stripe_customer_id = ?",
            (customer_id,),
        ).fetchone()
        con.execute("UPDATE users SET subscription_status = ? WHERE stripe_customer_id = ?", (status, customer_id))
        con.commit()
        # Welcome-to-Pro on the FIRST transition into active (not on renewals).
        if row and status == "active" and (row[1] or "") != "active":
            try:
                import mailer
                mailer.send_pro(row[0])
            except Exception as e:
                print("pro email failed:", e)

    if typ == "checkout.session.completed":
        cust = obj.get("customer")
        if cust:
            # subscription will trigger customer.subscription.created/updated; mark trialing for fast UI
            _set_status(cust, "trialing")
    elif typ in ("customer.subscription.created", "customer.subscription.updated"):
        cust = obj.get("customer")
        status = obj.get("status", "active")
        if cust:
            _set_status(cust, status)
    elif typ == "customer.subscription.deleted":
        cust = obj.get("customer")
        if cust:
            _set_status(cust, "canceled")
    elif typ == "invoice.payment_failed":
        cust = obj.get("customer")
        if cust:
            _set_status(cust, "past_due")
    con.close()
    return JSONResponse({"ok": True})


@router.get("/library")
def library_list(u: User = Depends(current_user)) -> dict:
    con = _db()
    rows = con.execute(
        "SELECT id, created_at, audio_sec, has_report, title FROM sessions_meta WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200",
        (u.id,),
    ).fetchall()
    con.close()
    _audit(u.id, None, "list", None, f"{len(rows)} sessions")
    out = []
    for r in rows:
        sid, ts, audio_sec, has_report, title = r
        # Mint thumbnail signed URL for the first marked frame.
        thumb = None
        first_frame = SESSIONS_DIR / sid / "frames" / "1.png"
        if first_frame.exists():
            tok = mint_signed_token(sid, u.id, ttl=300)
            thumb = f"{PUBLIC_API}/s/{sid}/frames/1.png?t={tok}"
        out.append({
            "id": sid,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
            "audio_sec": audio_sec,
            "has_report": bool(has_report),
            "title": title,
            "thumbnail_url": thumb,
        })
    return {"sessions": out}


@router.post("/library/sign")
async def library_sign(request: Request, u: User = Depends(current_user)) -> JSONResponse:
    body = await request.json()
    sid = str(body.get("session_id") or "")
    path = str(body.get("path") or "feedback.md").lstrip("/")
    sid = "".join(c for c in sid if c.isalnum() or c in "_-")[:32]
    if not sid:
        raise HTTPException(400, "session_id required")
    con = _db()
    row = con.execute("SELECT owner_id FROM sessions_meta WHERE id = ?", (sid,)).fetchone()
    con.close()
    if not row or row[0] != u.id:
        _audit(u.id, sid, "reject", None, "sign: not owner")
        raise HTTPException(403, "not your session")
    tok = mint_signed_token(sid, u.id, ttl=300)
    _audit(u.id, sid, "sign", None, path)
    return JSONResponse({"url": f"{PUBLIC_API}/s/{sid}/{path}?t={tok}", "expires_in": 300})


@router.delete("/library/{session_id}")
def library_delete(session_id: str, u: User = Depends(current_user)) -> dict:
    sid = "".join(c for c in session_id if c.isalnum() or c in "_-")[:32]
    con = _db()
    row = con.execute("SELECT owner_id FROM sessions_meta WHERE id = ?", (sid,)).fetchone()
    if not row or row[0] != u.id:
        con.close()
        raise HTTPException(403, "not your session")
    con.execute("DELETE FROM sessions_meta WHERE id = ?", (sid,))
    con.commit(); con.close()
    # remove on-disk too
    sdir = SESSIONS_DIR / sid
    if sdir.exists():
        for p in sorted(sdir.rglob("*"), reverse=True):
            try:
                p.unlink() if p.is_file() else p.rmdir()
            except Exception:
                pass
        try:
            sdir.rmdir()
        except Exception:
            pass
    _audit(u.id, sid, "delete", None, "")
    return {"ok": True}


# ── auth-gated session read (replaces StaticFiles) ───────────────────────────
def session_file_response(sid: str, subpath: str, request: Request) -> Response:
    sid = "".join(c for c in sid if c.isalnum() or c in "_-")[:32]
    if not sid:
        raise HTTPException(404)
    sub = subpath.lstrip("/")
    # forbid escape
    if ".." in sub or sub.startswith("/"):
        raise HTTPException(400)
    auth_header = request.headers.get("authorization")
    uid = authorize_session_read(sid, request, auth_header)
    if not uid:
        raise HTTPException(401, "auth required for library read")
    full = (SESSIONS_DIR / sid / sub).resolve()
    base = (SESSIONS_DIR / sid).resolve()
    if not str(full).startswith(str(base)):
        raise HTTPException(400)
    if not full.exists():
        raise HTTPException(404)
    # Rewrite markdown image links to absolute signed URLs so the agent can fetch them.
    if full.suffix == ".md":
        md = full.read_text(encoding="utf-8")
        tok = mint_signed_token(sid, uid, ttl=300)
        md = md.replace("](frames/", f"]({PUBLIC_API}/s/{sid}/frames/").replace(
            ".png)", f".png?t={tok})"
        )
        return Response(md, media_type="text/markdown")
    return FileResponse(str(full))
