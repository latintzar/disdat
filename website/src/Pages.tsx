import React, { useEffect, useState } from 'react'
import { clearFromApp, handleAuthCallback, isFromApp, mountAccount, rememberFromApp, signInWithGoogle, supabase } from './auth'

const INSTALL_URL = '/download'
const SOURCE_URL = 'https://github.com/latintzar/disdat'
const STRIPE_PRO = 'https://buy.stripe.com/4gMeV68JS8zS14x6Noe3e01'
const UPDATED = 'May 2026'

// ── Shared shell (header + footer) ──────────────────────────────────────────
function Shell({ children, wide = false, sourceInstall = false }: { children: React.ReactNode; wide?: boolean; sourceInstall?: boolean }) {
  return (
    <div className="min-h-screen bg-[#FBF7EE] text-[#16110D]" style={{ fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <header className="sticky top-0 z-30 bg-[#FBF7EE]/90 backdrop-blur border-b border-[#16110D]/5">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            {/* Just the cursor — no plate. The framed (cream-tile) mark is reserved for app-icon contexts. */}
            <img src="/favicon-32.png" alt="" width={26} height={26} className="pixelated" style={{ imageRendering: 'pixelated' }} />
            <span className="display font-semibold tracking-tight text-lg">Dis Dat</span>
          </a>
          <a href={INSTALL_URL} className="bg-[#16110D] text-[#FBF7EE] px-4 py-2 rounded-full text-sm font-medium hover:bg-[#FF5C2A] transition">Install</a>
        </div>
      </header>
      <main className={`mx-auto px-5 py-12 md:py-16 ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>{children}</main>
      <footer className="border-t border-[#16110D]/10 py-8 px-5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm text-[#16110D]/50">
          <span className="display">Dis Dat</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {sourceInstall ? <>
              <a href={SOURCE_URL} className="hover:text-[#16110D]">Source</a>
              <a href={`${SOURCE_URL}/blob/main/docs/configuration.md`} className="hover:text-[#16110D]">Data flow</a>
              <a href={`${SOURCE_URL}/blob/main/LICENSE`} className="hover:text-[#16110D]">MIT licence</a>
            </> : <>
            <a href="/privacy" className="hover:text-[#16110D]">Privacy</a>
            <a href="/terms" className="hover:text-[#16110D]">Terms</a>
            <a href="/cookies" className="hover:text-[#16110D]">Cookies</a>
            <a href="/data-controls" className="hover:text-[#16110D]">Data controls</a>
            </>}
            <a href="mailto:peter@disdat.dev" className="hover:text-[#16110D]">peter@disdat.dev</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Legal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <a href="/" className="mono text-xs text-[#FF5C2A] hover:underline">← Back to home</a>
      <h1 className="display text-4xl md:text-5xl font-medium tracking-tight mt-4 mb-2">{title}</h1>
      <p className="mono text-xs text-[#16110D]/40 mb-8 uppercase tracking-widest">Last updated {UPDATED}</p>
      <div className="space-y-5 text-[#16110D]/75 leading-relaxed text-[15px] [&_h2]:display [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-[#16110D] [&_h2]:mt-8 [&_h2]:mb-1 [&_a]:text-[#FF5C2A] [&_a]:underline [&_strong]:text-[#16110D]">
        {children}
      </div>
      <div className="mt-12 rounded-2xl bg-[#FF5C2A]/8 border border-[#FF5C2A]/20 p-5 text-sm text-[#16110D]/70">
        Dis Dat is an indie side project, built in the open. We're transparent about what we do, but we're not a big company with a compliance department — if something here matters to you, just email <a href="mailto:peter@disdat.dev" className="text-[#FF5C2A] underline">peter@disdat.dev</a> and a human will answer.
      </div>
    </Shell>
  )
}

// ── Get started (Wispr-Flow style sign-up gate for Download) ─────────────────
// Branded full-bleed welcome. Not signed in: prominent Continue with Google
// CTA. Signed in: auto-forwards to /download (the existing 3-step DMG page).
// ── Get started — light, branded, one job: sign you in then send to /download.
// Web has no "account" page; subscription is managed inside the Mac app
// (which opens Stripe Customer Portal directly).
export function GetStarted() {
  useEffect(() => {
    let cancelled = false
    // Remember app-origin immediately so it survives the OAuth round-trip.
    if (isFromApp()) rememberFromApp()
    ;(async () => {
      try {
        const { data: { session } } = await supabase().auth.getSession()
        if (cancelled) return
        if (session) {
          if (isFromApp()) {
            // Came from the Mac app — let /account?app=1 bridge tokens via disdat://
            window.location.replace('/account?app=1')
          } else {
            window.location.replace('/account')
          }
        }
      } catch (e) {
        console.warn('auth check failed', e)
      }
    })()
    return () => { cancelled = true }
  }, [])
  const fromApp = typeof window !== 'undefined' && isFromApp()
  return (
    <Shell>
      <a href="/" className="mono text-xs text-[#FF5C2A] hover:underline">← Back to home</a>
      <div className="text-center pt-10 pb-6">
        <h1 className="display text-4xl md:text-6xl font-medium tracking-tight">Get started</h1>
        <p className="text-[#16110D]/65 mt-4 text-base md:text-lg max-w-md mx-auto">
          {fromApp
            ? "Sign in to connect Dis Dat to your account."
            : "Sign in to get started — free to start, then upgrade to Pro when you need more."}
        </p>
      </div>
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => signInWithGoogle(window.location.origin + '/auth/callback' + (fromApp ? '?app=1' : '?next=account'))}
          className="w-full bg-[#16110D] text-[#FBF7EE] py-4 rounded-xl font-semibold text-base hover:bg-[#FF5C2A] transition flex items-center justify-center gap-3 shadow-lg shadow-[#16110D]/10"
        >
          <span className="rounded-full bg-white p-0.5 flex items-center justify-center" style={{ width: 22, height: 22 }}>
            <svg width="14" height="14" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" fill="#4285F4" /><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.32A9 9 0 0 0 9 18Z" fill="#34A853" /><path d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.04l3.03-2.32Z" fill="#FBBC05" /><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .94 4.96l3.03 2.32C4.68 5.16 6.66 3.58 9 3.58Z" fill="#EA4335" /></svg>
          </span>
          Continue with Google
        </button>
        <p className="mono text-[10px] uppercase tracking-widest text-[#16110D]/40 text-center mt-4">
          {fromApp ? 'You came from the app — we’ll send you back when you’re signed in' : 'No card needed · 30 free minutes · upgrade any time'}
        </p>
      </div>
      <p className="text-center text-xs text-[#16110D]/45 mt-10">
        By continuing, you agree to our <a href="/terms" className="underline hover:text-[#16110D]/80">Terms</a> and <a href="/privacy" className="underline hover:text-[#16110D]/80">Privacy Policy</a>.
      </p>
    </Shell>
  )
}

// ── Account — there's no web account page anymore. Account lives in the
// Mac app; web requests to /account are forwarded:
//   • ?app=1 + session → render a "Open Dis Dat" button that fires
//     disdat://auth#... (browsers block scheme navigation without a user
//     gesture, so we ALSO present a clickable button instead of only
//     setting window.location.href silently).
//   • ?app=1 + no session → /get-started?app=1
//   • signed-in (web)  → /download
//   • signed-out (web) → /get-started

// Genuine Figma account connection — real OAuth handshake with figma.com.
function FigmaCard({ setMsg }: { setMsg: (s: string) => void }) {
  const [st, setSt] = useState<{ connected: boolean; configured: boolean; handle?: string; email?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const { data: { session } } = await supabase().auth.getSession(); if (!session) return
    const r = await fetch('https://api.disdat.dev/x/figma/status', { headers: { Authorization: 'Bearer ' + session.access_token } })
    if (r.ok) setSt(await r.json())
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('figma')
    if (p === 'connected') { setMsg('Figma connected.'); history.replaceState(null, '', '/account') }
    else if (p) { setMsg('Figma connection failed (' + p + '). Try again.'); history.replaceState(null, '', '/account') }
    load()
  }, [])
  const connect = async () => {
    setBusy(true)
    const { data: { session } } = await supabase().auth.getSession(); if (!session) { setBusy(false); return }
    const r = await fetch('https://api.disdat.dev/x/figma/start', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token } })
    if (r.ok) { const j = await r.json(); window.location.href = j.url }
    else { setMsg('Figma isn’t set up yet — the app credentials are missing.'); setBusy(false) }
  }
  const disconnect = async () => {
    const { data: { session } } = await supabase().auth.getSession(); if (!session) return
    await fetch('https://api.disdat.dev/x/figma/disconnect', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token } })
    load()
  }
  const copyKey = async () => {
    const { data: { session } } = await supabase().auth.getSession(); if (!session) return
    const r = await fetch('https://api.disdat.dev/x/keys', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token } })
    if (r.ok) { const j = await r.json(); navigator.clipboard?.writeText(j.key); setMsg('Library key copied — paste it into the DisDat Figma plugin.') }
  }
  const figmaMark = (
    <svg width="15" height="22" viewBox="0 0 38 57" className="shrink-0"><path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z"/><path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z"/><path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z"/><path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z"/><path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z"/></svg>
  )
  return (
    <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 mb-6">
      <div className="flex items-center gap-2 mb-1">{figmaMark}<span className="font-semibold">Figma</span></div>
      {st?.connected ? (
        <>
          <p className="text-sm text-[#16110D]/70 mb-3">Connected as <b>{st.handle || st.email}</b>.</p>
          <p className="text-xs text-[#16110D]/50 mb-3">Figma only lets the API create Variables on Enterprise plans. On any other plan, run the <b>DisDat plugin</b> in your file — it writes your live library as Variables. It’s signed in with the same account.</p>
          <div className="flex items-center gap-4">
            <button onClick={copyKey} className="text-sm font-semibold text-[#FF5C2A] hover:underline">Copy my library key (for the plugin)</button>
            <button onClick={disconnect} className="text-sm text-[#16110D]/50 hover:text-[#16110D] underline underline-offset-2">Disconnect</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[#16110D]/60 mb-3">Link your Figma account to send your tokens across. Real OAuth — you authorize on figma.com.</p>
          <button onClick={connect} disabled={busy || (st && !st.configured) || false}
            className="inline-flex items-center gap-2 bg-[#16110D] text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#FF5C2A] transition disabled:opacity-40">
            {figmaMark}{busy ? 'Opening Figma…' : 'Connect Figma'}
          </button>
          {st && !st.configured && <p className="text-xs text-[#16110D]/40 mt-2">Setup in progress — check back shortly.</p>}
        </>
      )}
    </div>
  )
}

export function Account() {
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [me, setMe] = useState<null | { plan: string; minutes_left: number; cap: number; entitled: boolean; referral_code?: string; referral_count?: number; redeemed?: boolean }>(null)
  const [refIn, setRefIn] = useState('')
  const [refMsg, setRefMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'signedout' | 'bridge'>('loading')
  const [busy, setBusy] = useState('')
  const upgraded = typeof window !== 'undefined' && window.location.search.includes('upgraded=1')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase().auth.getSession()
        if (cancelled) return
        if (isFromApp()) {
          // legacy app bridge — keep working for old builds
          rememberFromApp()
          if (!session) { window.location.replace('/get-started?app=1'); return }
          const frag = new URLSearchParams({ access_token: session.access_token, refresh_token: session.refresh_token ?? '', expires_in: String(session.expires_in ?? 3600), email: session.user?.email ?? '' }).toString()
          const url = `disdat://auth#${frag}`
          clearFromApp(); setBridgeUrl(url); setEmail(session.user?.email ?? null); setState('bridge')
          window.setTimeout(() => { try { window.location.href = url } catch {} }, 80)
          return
        }
        // MCP OAuth hop: /oauth/authorize sent the user here with ?mcp_auth=<sid>. With a live
        // session we approve the grant server-side and bounce back to the API's continue URL,
        // which 302s to the agent's redirect_uri with the code. No session → sign in first.
        const mcpSid = new URLSearchParams(window.location.search).get('mcp_auth')
        if (mcpSid) {
          if (!session) { setState('signedout'); return }
          const ap = await fetch('https://api.disdat.dev/x/mcp-approve', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: mcpSid }) })
          if (ap.ok) { const j = await ap.json(); window.location.replace(j.continue); return }
        }
        if (!session) { setState('signedout'); return }
        setEmail(session.user?.email ?? null)
        const r = await fetch('https://api.disdat.dev/x/me', { headers: { Authorization: 'Bearer ' + session.access_token } })
        if (r.ok) setMe(await r.json())
        setState('ready')
      } catch (e) { console.warn('account load failed', e); setState('ready') }
    })()
    return () => { cancelled = true }
  }, [])

  async function redeem() {
    if (!refIn.trim()) return
    setRefMsg('…')
    try {
      const { data: { session } } = await supabase().auth.getSession()
      if (!session) return
      const r = await fetch('https://api.disdat.dev/x/redeem', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: refIn.trim() }) })
      const j = await r.json()
      if (r.ok) { setRefMsg(j.message || 'Done 🎉'); setMe(m => m ? { ...m, plan: j.plan, minutes_left: j.minutes_left, redeemed: true } : m) }
      else setRefMsg(j.detail || 'That didn’t work — check the code.')
    } catch (e) { setRefMsg('Network hiccup — try again.') }
  }

  async function billing(which: 'checkout' | 'portal') {
    setBusy(which)
    try {
      const { data: { session } } = await supabase().auth.getSession()
      if (!session) { window.location.href = '/get-started'; return }
      const r = await fetch('https://api.disdat.dev/billing/' + which, { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token } })
      const j = await r.json()
      if (j && j.url) window.location.href = j.url
      else setBusy('')
    } catch (e) { setBusy('') }
  }

  if (state === 'bridge') return (
    <Shell>
      <div className="py-16 text-center">
        <div className="display text-2xl font-medium mb-3">Signed in{email ? ` as ${email}` : ''}</div>
        {bridgeUrl && <a href={bridgeUrl} className="inline-flex bg-[#16110D] text-[#FBF7EE] px-7 py-4 rounded-full font-medium hover:bg-[#FF5C2A] transition">Open Dis Dat</a>}
      </div>
    </Shell>
  )
  if (state === 'signedout') return (
    <Shell>
      <div className="py-16 text-center">
        <h1 className="display text-4xl font-medium tracking-tight mb-4">Your account</h1>
        <p className="text-[#16110D]/60 mb-8">Sign in with the same Google account you use in the extension.</p>
        <a href="/get-started" className="inline-flex bg-[#16110D] text-[#FBF7EE] px-7 py-4 rounded-full font-medium hover:bg-[#FF5C2A] transition">Sign in</a>
      </div>
    </Shell>
  )
  const isPro = me?.plan === 'pro'
  const pct = me ? Math.max(2, Math.min(100, (me.minutes_left / (me.cap || 1)) * 100)) : 0
  return (
    <Shell>
      <a href="/" className="mono text-xs text-[#FF5C2A] hover:underline">← Back to home</a>
      <div className="pt-8 max-w-lg mx-auto">
        <h1 className="display text-4xl font-medium tracking-tight mb-1">Your account</h1>
        <p className="text-[#16110D]/55 text-sm mb-8">{email}</p>
        {upgraded && <div className="mb-6 rounded-xl border border-[#1f7a3d]/30 bg-[#1f7a3d]/5 text-[#1f7a3d] px-4 py-3 text-sm font-medium">✓ Welcome to Pro — 500 minutes a month.</div>}
        <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 mb-6">
          {state === 'loading' || !me ? <p className="text-[#16110D]/50 text-sm">Loading your plan…</p> : (<>
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-semibold text-lg">{isPro ? 'Pro' : 'Free trial'}</span>
              <span className="mono text-sm text-[#16110D]/60">{Math.round(me.minutes_left)} / {me.cap} min left</span>
            </div>
            <div className="h-2 rounded-full bg-[#16110D]/8 overflow-hidden mb-5"><div className="h-full bg-[#FF5C2A]" style={{ width: pct + '%' }} /></div>
            {isPro
              ? <button onClick={() => billing('portal')} disabled={!!busy} className="w-full bg-[#16110D] text-[#FBF7EE] py-3.5 rounded-xl font-semibold hover:bg-[#FF5C2A] transition disabled:opacity-60">{busy ? 'Opening Stripe…' : 'Manage billing & invoices'}</button>
              : <button onClick={() => billing('checkout')} disabled={!!busy} className="w-full bg-[#FF5C2A] text-white py-3.5 rounded-xl font-semibold hover:bg-[#16110D] transition disabled:opacity-60">{busy ? 'Opening Stripe…' : 'Upgrade to Pro — $7/mo · 500 min'}</button>}
            <p className="text-[11px] text-[#16110D]/45 mt-3 text-center">{isPro ? 'Invoices, card, cancel — all in the Stripe portal.' : 'Checkout and billing are handled by Stripe — we never see your card.'}</p>
          </>)}
        </div>
        <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 mb-6">
          <div className="font-semibold mb-1">Refer a friend — you both get a month of Pro</div>
          <p className="text-sm text-[#16110D]/60 mb-4">They enter your code when they join; you each get 30 days of Pro (500 min/mo). Stack a month for every friend.</p>
          {me?.referral_code && (
            <div className="flex items-center gap-2 mb-3">
              <span className="mono text-lg font-bold tracking-wider bg-[#FBF7EE] border border-[#16110D]/12 rounded-xl px-4 py-2.5">{me.referral_code}</span>
              <button onClick={() => { navigator.clipboard?.writeText(`Try Dis Dat — show your coding agent anything: https://disdat.dev · use my code ${me.referral_code} for a free month of Pro`); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="bg-[#FF5C2A] text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#16110D] transition">{copied ? 'Copied ✓' : 'Copy invite'}</button>
              <span className="ml-auto mono text-xs text-[#16110D]/50">{me.referral_count || 0} joined</span>
            </div>
          )}
          {me && !me.redeemed && (
            <div className="flex items-center gap-2 pt-3 border-t border-[#16110D]/8">
              <input value={refIn} onChange={e => setRefIn(e.target.value)} placeholder="Got a code? DD-······"
                className="flex-1 mono text-sm bg-white border border-[#16110D]/15 rounded-xl px-3.5 py-2.5 outline-none focus:border-[#FF5C2A]" />
              <button onClick={redeem} className="bg-[#16110D] text-[#FBF7EE] px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#FF5C2A] transition">Apply</button>
            </div>
          )}
          {refMsg && <p className="text-xs mt-2 text-[#16110D]/60">{refMsg}</p>}
        </div>
        <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 mb-6">
          <div className="font-semibold mb-1">Your library, everywhere</div>
          <p className="text-sm text-[#16110D]/60 mb-3">Connect your coding agent to your saved tokens, or feed them into Figma.</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="mono text-xs bg-[#FBF7EE] border border-[#16110D]/12 rounded-lg px-3 py-2 flex-1 truncate">https://api.disdat.dev/mcp</span>
            <button onClick={() => navigator.clipboard?.writeText('https://api.disdat.dev/mcp')} className="text-xs font-semibold border border-[#16110D]/15 rounded-lg px-3 py-2 hover:border-[#FF5C2A] hover:text-[#FF5C2A]">Copy MCP address</button>
          </div>
          <p className="text-xs text-[#16110D]/50">Paste it as a custom MCP in Claude or Codex — it opens this site to authenticate and shows what it can access.</p>
        </div>
        <FigmaCard setMsg={setRefMsg} />
        <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 mb-6">
          <div className="font-semibold mb-1">The extension</div>
          <p className="text-sm text-[#16110D]/60 mb-3">Recording happens in Chrome — your account and minutes sync automatically once you sign in there.</p>
          <a href="/download" className="text-sm font-semibold text-[#FF5C2A] hover:underline">Get Dis Dat for Chrome →</a>
        </div>
        <div className="flex items-center justify-between text-sm">
          <button onClick={async () => { await supabase().auth.signOut(); window.location.href = '/' }} className="text-[#16110D]/50 hover:text-[#16110D] underline underline-offset-2">Sign out</button>
          <a href="mailto:peter@disdat.dev" className="text-[#16110D]/50 hover:text-[#16110D]">Delete account / support</a>
        </div>
      </div>
    </Shell>
  )
}

export function AuthCallback() {
  useEffect(() => {
    ;(async () => {
      try {
        await handleAuthCallback()
        // handleAuthCallback already redirects for app-origin + ?next=download.
        // Fallback if it returned without a session: app users go back through the
        // bridge, web users to /download. Never drop an app user on /download.
        if (document.visibilityState !== 'hidden') {
          window.location.replace(isFromApp() ? '/account?app=1' : '/account')
        }
      } catch (e) {
        console.error('auth callback failed', e)
        window.location.replace(isFromApp() ? '/get-started?app=1' : '/get-started?error=callback')
      }
    })()
  }, [])
  return (
    <Shell>
      <div className="py-16 text-center">
        <div className="display text-2xl font-medium mb-2">Signing you in…</div>
        <p className="text-[#16110D]/60 text-sm">If this hangs for more than a few seconds, <a className="text-[#FF5C2A] underline" href="/get-started">try again</a>.</p>
      </div>
    </Shell>
  )
}

// ── Download ────────────────────────────────────────────────────────────────
export function Download() {
  return (
    <Shell sourceInstall>
      <a href="/" className="mono text-xs text-[#FF5C2A] hover:underline">← Back to home</a>
      <div className="pt-8 max-w-lg mx-auto text-center">
        <img src="/icon-1024.png" alt="" width={84} height={84} className="mx-auto rounded-[20px] shadow-lg mb-6" />
        <h1 className="display text-4xl md:text-5xl font-medium tracking-tight mb-3">Install Dis Dat</h1>
        <p className="text-[#16110D]/60 mb-8">Your agent sets up the Chrome extension with your Deepgram and Groq or Anthropic keys.</p>
        <a href={`${SOURCE_URL}#install-with-your-agent`} className="inline-flex bg-[#FF5C2A] text-white px-8 py-4 rounded-full font-semibold text-lg hover:bg-[#16110D] transition">Install with your agent</a>
        <div className="rounded-2xl border border-[#16110D]/10 bg-white p-6 text-left mt-8">
          <p className="font-semibold mb-3">Give your agent this instruction</p>
          <p className="mono text-sm text-[#16110D]/75 break-words">Read {SOURCE_URL}/blob/main/skills/disdat-setup/SKILL.md and set up Dis Dat in own-key mode. Use private local input for my provider keys.</p>
        </div>
        <ol className="text-left space-y-3 mt-10">
          {['Your agent runs setup and doctor, then gives you the generated extension directory.', 'In chrome://extensions, enable Developer mode and load that directory with Load unpacked.', 'Record a page, save the capture locally and give your agent the downloaded file.'].map((t, i) => (
            <li key={i} className="flex gap-3 items-start text-[15px] text-[#16110D]/75"><span className="mono text-[#FF5C2A] font-semibold">{i + 1}.</span><span>{t}</span></li>
          ))}
        </ol>
        <p className="text-sm text-[#16110D]/60 mt-8">macOS or Linux · Python 3.10+ · desktop Chrome · provider usage billed by your providers</p>
        <a className="inline-block text-sm text-[#FF5C2A] underline mt-4" href={`${SOURCE_URL}/blob/main/docs/configuration.md`}>Configuration and data flow</a>
      </div>
    </Shell>
  )
}

export function Privacy() {
  return (
    <Legal title="Privacy Policy">
      <p>Dis Dat turns a screen recording + your voice into feedback for your coding agent. Here's exactly what that involves.</p>
      <h2>What we process</h2>
      <p>When you record, the app captures <strong>screenshots of your screen, your microphone audio, and your cursor positions</strong>. On stop, that bundle is uploaded to our server (<span className="mono">api.disdat.dev</span>), where your audio is transcribed (Deepgram) and the marked screenshots + transcript are sent to an AI model (Anthropic / OpenRouter) to write your feedback. We store the resulting bundle so the link you paste keeps working.</p>
      <h2>What we keep</h2>
      <p>Your account email (via Google sign-in), your feedback sessions (screenshots, transcript, generated markdown), and basic usage counts for billing. That's it. We don't sell your data, and we don't use your recordings to train models.</p>
      <h2>Your screen is sensitive</h2>
      <p>You choose what's on screen when you record. Don't record passwords or secrets you don't want processed. You can delete any session — see <a href="/data-controls">Data controls</a>.</p>
      <h2>Sub-processors</h2>
      <p>Deepgram (transcription), Anthropic / OpenRouter (feedback generation), Hetzner (hosting), Vercel (this site), Supabase (accounts), Stripe (billing). Each sees only what it needs.</p>
      <h2>Contact</h2>
      <p>Questions or deletion requests: <a href="mailto:peter@disdat.dev">peter@disdat.dev</a>.</p>
    </Legal>
  )
}

export function Terms() {
  return (
    <Legal title="Terms of Service">
      <p>By using Dis Dat you agree to these terms. They're short on purpose.</p>
      <h2>The deal</h2>
      <p>Dis Dat is provided <strong>as-is</strong>, with no warranty of any kind. It's an indie side project — it may break, change, or go away. We do our best, but we can't promise uptime, accuracy of the AI feedback, or fitness for any particular purpose.</p>
      <h2>Liability</h2>
      <p>To the maximum extent allowed by law, we are <strong>not liable</strong> for any damages arising from your use of Dis Dat — including anything an AI agent does after you paste its feedback. You're responsible for reviewing changes before you ship them. Our total liability is capped at what you paid us in the last month (often $0).</p>
      <h2>Your content</h2>
      <p>You own your recordings and the feedback generated from them. You grant us the limited right to process and host them so the product works. Don't use Dis Dat to capture other people's private information without their consent, or for anything illegal.</p>
      <h2>Billing</h2>
      <p>Pro is $7/month for 500 audio-minutes, billed via Stripe. New accounts get 30 free minutes, no card. Cancel anytime; access continues until the end of the period.</p>
      <h2>Changes</h2>
      <p>We may update these terms; continued use means you accept them. Questions: <a href="mailto:peter@disdat.dev">peter@disdat.dev</a>.</p>
    </Legal>
  )
}

export function Cookies() {
  return (
    <Legal title="Cookie Policy">
      <p>We keep cookies to a minimum.</p>
      <h2>What we use</h2>
      <p><strong>Essential only:</strong> a session cookie to keep you signed in, and Stripe's cookies during checkout. We don't run advertising or cross-site tracking cookies.</p>
      <h2>Analytics</h2>
      <p>We may use privacy-respecting, aggregate analytics to understand what's working. No selling, no ad networks.</p>
      <h2>Control</h2>
      <p>You can clear cookies in your browser anytime; you'll just need to sign in again. Questions: <a href="mailto:peter@disdat.dev">peter@disdat.dev</a>.</p>
    </Legal>
  )
}

export function DataControls() {
  return (
    <Legal title="Data Controls">
      <p>You're in control of your recordings. Here's how.</p>
      <h2>See your data</h2>
      <p>Every session lives in the Dis Dat app's Library and at its feedback link. Open the app to browse everything you've recorded.</p>
      <h2>Delete your data</h2>
      <p>Delete any session from the Library to remove its screenshots, transcript, and feedback from our server. Want everything gone, including your account? Email <a href="mailto:peter@disdat.dev">peter@disdat.dev</a> and we'll wipe it.</p>
      <h2>Retention</h2>
      <p>Sessions are kept so your pasted links keep working. We don't keep raw audio longer than needed to transcribe it. We never train on your data.</p>
      <h2>On-device first</h2>
      <p>Recording happens locally on your Mac. Nothing leaves your machine until you stop and it uploads to generate your feedback.</p>
      <h2>Contact</h2>
      <p>Any data question: <a href="mailto:peter@disdat.dev">peter@disdat.dev</a>. A human replies.</p>
    </Legal>
  )
}
