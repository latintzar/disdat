// Supabase Google auth + access-token helper. Both used by Pages.Account/AuthCallback
// (the static landing) and (later) the Mac app via the OAuth deep-link bridge.
//
// Env (Vite, public — anon key only — never service_role):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
//   VITE_API_BASE (recipient-owned API; configure all three settings)

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

import { resolveHostedConfig } from './hosted-config.mjs'
export const hostedConfiguration = resolveHostedConfig({
  VITE_API_BASE: import.meta.env.VITE_API_BASE,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
})
const SUPABASE_URL = hostedConfiguration.supabaseUrl
const SUPABASE_ANON = hostedConfiguration.supabaseKey
export const API_BASE = hostedConfiguration.apiBase

let _client: SupabaseClient | null = null
export function supabase(): SupabaseClient {
  if (_client) return _client
  if (!hostedConfiguration.configured) {
    throw new Error('Configure the recipient-owned hosted service in website/.env.local.');
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  return _client
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession()
  return data.session?.access_token ?? null
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json')
  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'omit' })
}

// ── App-origin tracking ──────────────────────────────────────────────────────
// When the user arrives from the Mac app (?app=1) we must ALWAYS hand the session
// back via the disdat:// bridge and never drop them on /download. The query param
// can be lost across the Google→Supabase OAuth round-trip, so we also stash the
// flag in sessionStorage and treat either signal as "came from the app".
const FROM_APP_KEY = 'disdat_from_app'

export function rememberFromApp() {
  try { sessionStorage.setItem(FROM_APP_KEY, '1') } catch {}
}

export function isFromApp(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('app') === '1') return true
    return sessionStorage.getItem(FROM_APP_KEY) === '1'
  } catch {
    return new URLSearchParams(window.location.search).get('app') === '1'
  }
}

export function clearFromApp() {
  try { sessionStorage.removeItem(FROM_APP_KEY) } catch {}
}

export async function signInWithGoogle(redirectTo = window.location.origin + '/auth/callback') {
  // Persist app-origin BEFORE leaving for Google, so the callback can recover it
  // even if the ?app=1 query param doesn't survive the OAuth round-trip.
  if (/[?&]app=1\b/.test(redirectTo) || isFromApp()) rememberFromApp()
  await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'select_account consent' } },
  })
}

export async function signOut() {
  await supabase().auth.signOut()
  window.location.replace('/')
}

export async function handleAuthCallback() {
  // detectSessionInUrl: true on createClient handles the PKCE exchange automatically.
  // Wait until the session lands, then route by `?next=` and `?app=1`.
  for (let i = 0; i < 30; i++) {
    const t = await getAccessToken()
    if (t) {
      const params = new URLSearchParams(window.location.search)
      if (isFromApp()) {
        window.location.replace('/account?app=1')
        return
      }
      const next = params.get('next')
      if (next === 'download') {
        window.location.replace('/download')
        return
      }
      if (next === 'upgrade') {
        window.location.replace('/account?upgrade=1')
        return
      }
      return
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

// ---- Account UI mount (called by /account page) ----
// Drives the buttons + queries the server for subscription state.

type Me = {
  email: string
  subscription_status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trial_ends_at: string | null
  stripe_customer_id: string | null
}

async function fetchMe(): Promise<Me | null> {
  const t = await getAccessToken()
  if (!t) return null
  const res = await authFetch('/me')
  if (!res.ok) return null
  return res.json()
}

async function startCheckout() {
  const res = await authFetch('/billing/checkout', { method: 'POST' })
  if (!res.ok) {
    alert('Could not start checkout. Try again in a moment.')
    return
  }
  const { url } = await res.json()
  window.location.href = url
}

async function openPortal() {
  const res = await authFetch('/billing/portal', { method: 'POST' })
  if (!res.ok) {
    alert('Could not open billing portal.')
    return
  }
  const { url } = await res.json()
  window.location.href = url
}

export async function mountAccount() {
  const root = document.getElementById('account-root')
  if (!root) return

  const session: Session | null = (await supabase().auth.getSession()).data.session
  const params = new URLSearchParams(window.location.search)

  // Mac-app sign-in bridge: when the user came from the desktop app (?app=1)
  // and we have a session, immediately deep-link to the disdat:// scheme.
  // No interstitial UI — keeps the flow snappy.
  if (session && isFromApp()) {
    const frag = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? '',
      expires_in: String(session.expires_in ?? 3600),
      email: session.user?.email ?? '',
    }).toString()
    clearFromApp()
    window.location.href = `disdat://auth#${frag}`
    return
  }

  if (!session) {
    const btn = document.getElementById('sign-in-google') as HTMLButtonElement | null
    if (btn) btn.addEventListener('click', () => signInWithGoogle(window.location.origin + '/auth/callback' + (isFromApp() ? '?app=1' : '')))
    return
  }

  const me = await fetchMe()
  const trialMs = me?.trial_ends_at ? new Date(me.trial_ends_at).getTime() - Date.now() : 0
  const trialDays = Math.max(0, Math.ceil(trialMs / 86400000))
  const status = me?.subscription_status ?? 'none'

  root.innerHTML = `
    <div class="space-y-4">
      <div>
        <div class="mono text-[10px] uppercase tracking-widest text-[#16110D]/45">Signed in</div>
        <div class="text-lg font-medium mt-0.5">${session.user.email ?? ''}</div>
      </div>
      <div class="rounded-xl bg-[#FBF7EE] border border-[#16110D]/10 p-4">
        <div class="mono text-[10px] uppercase tracking-widest text-[#FF5C2A]">Subscription</div>
        <div class="text-base font-medium mt-1">
          ${status === 'active' ? 'Pro · active' : status === 'trialing' ? `Pro trial · ${trialDays} day${trialDays === 1 ? '' : 's'} left` : status === 'past_due' ? 'Pro · past due' : status === 'canceled' ? 'Canceled' : 'Basic (free)'}
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        ${status === 'none' || status === 'canceled'
          ? `<button id="btn-upgrade" class="bg-[#FF5C2A] text-white px-5 py-2.5 rounded-full font-medium hover:bg-[#16110D] transition">Start 14-day Pro trial</button>`
          : `<button id="btn-portal" class="bg-[#16110D] text-white px-5 py-2.5 rounded-full font-medium hover:bg-[#FF5C2A] transition">Manage subscription</button>`}
        <button id="btn-signout" class="bg-white border border-[#16110D]/15 px-5 py-2.5 rounded-full font-medium hover:bg-[#FBF7EE] transition">Sign out</button>
      </div>
    </div>
  `
  document.getElementById('btn-upgrade')?.addEventListener('click', startCheckout)
  document.getElementById('btn-portal')?.addEventListener('click', openPortal)
  document.getElementById('btn-signout')?.addEventListener('click', signOut)

  // Auto-launch checkout when arriving via /account?upgrade=1 with no Pro yet.
  if (params.get('upgrade') === '1' && (status === 'none' || status === 'canceled')) {
    startCheckout()
  }
}
