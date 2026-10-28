// Dis Dat — background = the cross-page session coordinator + timeline store.
// Everything the user does/looks at/says lands on ONE time-correlated timeline that
// spans navigations: each page injects content.js, which streams loose, time-stamped
// hints (mouse/dwell/click/type), deep element facts (captured at the instant they
// matter), network/chat responses, DOM mutations, and live "notes". Audio is one
// continuous offscreen stream so narration survives page changes. On Stop we hand the
// whole assembled session back to the page, which crunches it (Nano on-device first,
// cloud optional). Cloud + Deepgram calls are proxied here to dodge CORS.

// tools/disdat.py prepares this file only inside the user's private runtime directory.
try { importScripts('local-config.js'); } catch (e) { /* The setup screen names the next step. */ }
importScripts('runtime.js');
const RUNTIME = self.DisdatRuntime.config;
const runtimeStatus = () => ({ ...self.DisdatRuntime.status(), version: chrome.runtime.getManifest().version });
const getKeys = async () => ({ dgKey: RUNTIME.deepgramKey,
  groqKey: RUNTIME.llmProvider === 'groq' ? RUNTIME.llmKey : '',
  llmKey: RUNTIME.llmProvider === 'anthropic' ? RUNTIME.llmKey : '' });
const BLOCKED = /^(chrome|edge|about|chrome-extension|chromewebstore|devtools|view-source):/;

// ---------- debug telemetry → Supabase (insert-only; the build owner reviews it) ----------
const SUPA_URL = 'https://xafabacaacgkutrqqmag.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZmFiYWNhYWNna3V0cnFxbWFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MDU4MjksImV4cCI6MjA5NTQ4MTgyOX0.LKw4Xr-OCoUhYhI6eQ1Xw4XGiDW9N4hPm-FG61HMmWE'; // public anon (publishable) key — insert-only RLS on disdat_debug
async function logDebug(payload) {
  if (RUNTIME.mode !== 'hosted') return;
  try {
    await fetch(SUPA_URL + '/rest/v1/disdat_debug', {
      method: 'POST',
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ page: (payload && payload.page) || '', payload })
    });
  } catch (e) { /* telemetry must never break a capture */ }
}

// ---------- LIVE run logs → Supabase disdat_debug (kind:'log'), so the build owner sees every run as it happens, no copy-paste ----------
let RUN_ID = 'boot-' + Date.now();
function setRun(id) { RUN_ID = id; try { chrome.storage.session.set({ ddRun: id }); } catch (e) {} }
async function ensureRun() { try { const r = await chrome.storage.session.get('ddRun'); if (r && r.ddRun) RUN_ID = r.ddRun; } catch (e) {} return RUN_ID; }
ensureRun();
function safeVal(d) { try { JSON.stringify(d); return d; } catch (e) { try { return String(d); } catch (_) { return '[unserializable]'; } } }
let _logQ = [], _logTimer = 0;
function flushRlog() {
  if (RUNTIME.mode !== 'hosted') return;
  clearTimeout(_logTimer); _logTimer = 0;
  if (!_logQ.length) return;
  const batch = _logQ.splice(0, _logQ.length);
  try {
    fetch(SUPA_URL + '/rest/v1/disdat_debug', {
      method: 'POST',
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + SUPA_ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(batch)
    }).catch(() => {});
  } catch (e) {}
}
function rlog(src, level, tag, data, page) {
  if (RUNTIME.mode !== 'hosted') return;
  try {
    _logQ.push({ page: page || '', payload: { kind: 'log', run_id: RUN_ID, ts: Date.now(), src: src || 'bg', level: level || 'log', tag: tag || '', data: safeVal(data) } });
    if (level === 'error' || _logQ.length >= 25) flushRlog();
    else if (!_logTimer) _logTimer = setTimeout(flushRlog, 1000);
  } catch (e) {}
}
// mirror the extension's OWN console + uncaught errors into the live log (background side)
['log', 'warn', 'error', 'info'].forEach(k => { const o = (console[k] || console.log).bind(console); console[k] = (...a) => { o(...a); rlog('bg', k === 'info' ? 'log' : k, '', a.map(safeVal)); }; });
self.addEventListener('error', e => rlog('bg', 'error', 'uncaught', { msg: e.message, file: e.filename, line: e.lineno, col: e.colno }));
self.addEventListener('unhandledrejection', e => { const r = e && e.reason; rlog('bg', 'error', 'unhandledrejection', { reason: (r && (r.stack || r.message)) || String(r) }); });

// ---------- inject / activate ----------
async function activate(tab) {
  if (!tab || !tab.id || BLOCKED.test(tab.url || '')) return;
  await ensureS();
  if (S && S.ownerTabId !== tab.id) return;
  rlog('bg', 'event', 'activate', { url: tab.url });
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['privacy.js', 'local-delivery.js', 'content.js'] }); }
  catch (e) { console.warn('Dis Dat inject failed:', e); }
}
chrome.action.onClicked.addListener(activate);
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'activate') chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => activate(tab));
});
chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
});

// ---------- the live session ----------
// S = { startT(epoch ms), audioOffset(s), timeline[], net[], mut[], events[], notes[] }
let S = null, saveTimer = 0, lastCaptureOwner = null, activeTabEpoch = 0, clearingSession = Promise.resolve();
// MV3 kills the service worker when idle (e.g. during a navigation), wiping in-memory
// state — which broke cross-page sessions. Mirror S to chrome.storage.session (memory-
// backed, survives SW restarts) so a re-woken worker re-hydrates the live session.
async function ensureS() { await clearingSession; if (S) return S; try { const r = await chrome.storage.session.get('dd'); if (Number.isInteger(r?.dd?.ownerTabId) && Number.isInteger(r?.dd?.ownerWindowId) && typeof r.dd.audioSessionId === 'string') S = r.dd; else if (r?.dd) await chrome.storage.session.remove('dd'); } catch (e) {} return S; }
function persist() { if (!S) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { chrome.storage.session.set({ dd: S }); } catch (e) {} }, 250); }
function clearS() { S = null; lastCaptureOwner = null; clearTimeout(saveTimer); try { clearingSession = chrome.storage.session.remove(['dd', 'ddCaptureOwner']).catch(() => {}); } catch (e) { clearingSession = Promise.resolve(); } return clearingSession; }

// While a session is live, re-inject content.js on every navigation so capture
// continues across pages (the re-woken worker re-hydrates S from storage first).
async function reinjectIfGone(tabId, url) {
  if (BLOCKED.test(url || '')) return;
  await ensureS();
  if (!S || S.ownerTabId !== tabId) return; // one explicitly activated tab across its navigations
  // Only re-inject when content.js is genuinely GONE (a real document reload). A same-document URL change
  // — a modal, an SPA pushState (e.g. Deliveroo adding ?item-id=…) — leaves content.js alive and would
  // otherwise trigger a spurious re-inject. Ping first; if it answers, skip → the live capture rides on.
  const alive = await new Promise((r) => {
    try { chrome.tabs.sendMessage(tabId, { type: 'dd-ping' }, (resp) => { void chrome.runtime.lastError; r(!!(resp && resp.alive)); }); }
    catch (e) { r(false); }
  });
  if (alive) return;
  chrome.scripting.executeScript({ target: { tabId }, files: ['privacy.js', 'local-delivery.js', 'content.js'] }).catch(() => {});
}
// FAST resume: re-inject the instant the new page COMMITS (webNavigation.onCommitted) — seconds earlier
// than waiting for the whole page to finish loading. So the capture panel comes back almost immediately
// on navigation instead of after a heavy page settles. onUpdated('complete') stays as a backstop.
try {
  if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((d) => { if (d.frameId === 0) reinjectIfGone(d.tabId, d.url); });
  }
} catch (e) {}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !tab) return;
  reinjectIfGone(tabId, tab.url);
});

// ---------- offscreen audio (one continuous stream) ----------
async function hasOffscreen() {
  try { if (chrome.offscreen && chrome.offscreen.hasDocument) return await chrome.offscreen.hasDocument(); } catch (e) {}
  try { const c = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }); return c && c.length > 0; } catch (e) {}
  return false;
}
// ONE offscreen document serves BOTH the mic stream AND the bundled WebLLM engine
// (MV3 allows only one). We keep it alive after recording so the local model stays
// warm in GPU memory between captures.
let _offscreenInit = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return true;
  if (_offscreenInit) { try { await _offscreenInit; } catch (e) {} return await hasOffscreen(); }
  try { _offscreenInit = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'], justification: 'Record narration for the selected tab and keep local capture downloads in the extension origin.' }); await _offscreenInit; }
  catch (e) { rlog('bg', 'error', 'offscreen-create', { err: String(e) }); }
  finally { _offscreenInit = null; }
  return await hasOffscreen();
}
async function startAudio(sessionId) {
  try {
    if (S?.audioSessionId !== sessionId || S.audioState !== 'starting') return { error: 'audio-start-cancelled' };
    await ensureOffscreen();
    if (S?.audioSessionId !== sessionId || S.audioState !== 'starting') return { error: 'audio-start-cancelled' };
    return await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'start', sessionId });
  }
  catch (e) { return { error: String(e) }; }
}
async function stopAudio(sessionId, transcribe = false) {
  // stop the mic but KEEP the offscreen doc alive so the warm WebLLM model persists for the crunch.
  try { if (await hasOffscreen()) return await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'stop', sessionId, local: transcribe && RUNTIME.mode === 'local' }); } catch (e) { return { error: String(e) }; }
  return { error: 'no-offscreen' };
}
// ---------- bundled on-device crunch (WebLLM, runs inside the offscreen doc) ----------
async function localLlmInit(model) {
  if (RUNTIME.mode !== 'local') return { error: 'local-mode-required' };
  try { await ensureOffscreen(); return await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'llm-init', model }); }
  catch (e) { return { error: String(e) }; }
}
async function localLlmPrompt(sys, input, maxTokens) {
  if (RUNTIME.mode !== 'local') return { error: 'local-mode-required' };
  try { await ensureOffscreen(); return await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'llm-prompt', sys, input, maxTokens }); }
  catch (e) { return { error: String(e) }; }
}

// ---------- account: Supabase Google sign-in (chrome.identity) → the metered proxy ----------
// Hosted mode explicitly selects the existing Dis Dat account/proxy service.
// Own-key mode uses the configured providers directly and keeps artifact delivery local.
const API_BASE = 'https://api.disdat.dev';
const REDIRECT = (chrome.identity && chrome.identity.getRedirectURL) ? chrome.identity.getRedirectURL() : '';
const _authGet = () => new Promise(r => chrome.storage.local.get('dd_auth', s => r((s && s.dd_auth) || null)));
const _authSet = (a) => new Promise(r => chrome.storage.local.set({ dd_auth: a }, () => r()));

async function signIn() {
  if (RUNTIME.mode !== 'hosted') return { error: 'setup-required' };
  if (!chrome.identity || !chrome.identity.launchWebAuthFlow) return { error: 'no-identity' };
  const url = SUPA_URL + '/auth/v1/authorize?provider=google&prompt=select_account&redirect_to=' + encodeURIComponent(REDIRECT); // prompt=select_account: always show the Google account chooser — never silently reuse whatever session Chrome has (uni accounts etc.)
  let redirect;
  try {
    redirect = await new Promise((res, rej) => {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (r) => {
        const err = chrome.runtime.lastError;
        if (err || !r) return rej(new Error((err && err.message) || 'cancelled'));
        res(r);
      });
    });
  } catch (e) { return { error: 'signin-cancelled', detail: String(e) }; }
  // Supabase returns the session in the URL fragment: #access_token=…&refresh_token=…&expires_in=…
  const p = new URLSearchParams((redirect.split('#')[1]) || '');
  const access = p.get('access_token'), refresh = p.get('refresh_token');
  if (!access) return { error: 'no-token', detail: (redirect || '').slice(0, 120) };
  const expires_at = Date.now() + (parseInt(p.get('expires_in') || '3600', 10) * 1000);
  let email = '';
  try { const u = await fetch(SUPA_URL + '/auth/v1/user', { headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + access } }); email = ((await u.json()) || {}).email || ''; } catch (e) {}
  await _authSet({ access_token: access, refresh_token: refresh, expires_at, email });
  rlog('bg', 'event', 'signin-ok', { email });
  return await me();
}

async function _refresh(a) {
  try {
    const res = await fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: SUPA_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: a.refresh_token })
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j.access_token) return null;
    const next = { access_token: j.access_token, refresh_token: j.refresh_token || a.refresh_token, expires_at: Date.now() + ((j.expires_in || 3600) * 1000), email: a.email };
    await _authSet(next); return next;
  } catch (e) { return null; }
}

async function getToken() {
  if (RUNTIME.mode !== 'hosted') return null;
  let a = await _authGet();
  if (!a || !a.access_token) return null;
  if (Date.now() > (a.expires_at || 0) - 60000) { a = await _refresh(a); if (!a) { await _authSet(null); return null; } }
  return a.access_token;
}

async function signOut() { await _authSet(null); return { ok: true }; }

async function me() {
  const status = runtimeStatus();
  if (RUNTIME.mode !== 'hosted') return { ...status, signedIn: false };
  const a = await _authGet();
  if (!a || !a.access_token) return { ...status, signedIn: false };
  const token = await getToken();
  if (!token) return { ...status, signedIn: false };
  try {
    const res = await fetch(API_BASE + '/x/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return { ...status, signedIn: true, email: a.email, error: 'me ' + res.status };
    const j = await res.json();
    return { ...status, signedIn: true, email: a.email, plan: j.plan, minutesLeft: j.minutes_left,
      cap: j.cap, entitled: j.entitled, status: j.subscription_status, referralCode: j.referral_code,
      referralCount: j.referral_count, redeemed: j.redeemed };
  } catch (e) { return { ...status, signedIn: true, email: a.email, error: 'account-fetch' }; }
}

async function upgradeUrl(which) {
  const token = await getToken();
  if (!token) return { error: 'signin-needed' };
  try {
    const res = await fetch(API_BASE + (which === 'portal' ? '/billing/portal' : '/billing/checkout'), { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const j = await res.json();
    if (!res.ok || !j.url) return { error: 'billing ' + res.status, detail: JSON.stringify(j).slice(0, 160) };
    return { url: j.url };
  } catch (e) { return { error: 'billing-fetch', detail: String(e) }; }
}

// ---------- transcription (explicit hosted proxy or direct Deepgram) ----------
function b64ToBytes(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
function _parseDg(j) {
  const alt = (j && j.results && j.results.channels && j.results.channels[0] && j.results.channels[0].alternatives && j.results.channels[0].alternatives[0]) || {};
  return { transcript: alt.transcript || '', words: (alt.words || []).map(w => ({ w: w.punctuated_word || w.word, start: w.start })), duration: (j && j.metadata && j.metadata.duration) || 0 };
}
async function deepgramBytes(bytes, mime) {
  const token = await getToken();
  if (token) {
    try {
      const res = await fetch(API_BASE + '/x/transcribe', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': mime || 'audio/webm' }, body: bytes
      });
      if (res.status === 401) { await _authSet(null); return { error: 'signin-needed' }; }
      if (res.status === 402) { const detail = (await res.text()).slice(0, 200); return { error: 'limit', detail }; }
      if (!res.ok) { const detail = (await res.text()).slice(0, 200); rlog('bg', 'error', 'x-transcribe', { status: res.status, detail }); return { error: 'transcribe ' + res.status, detail }; }
      return _parseDg(await res.json());
    } catch (e) { rlog('bg', 'error', 'x-transcribe-fetch', { detail: String(e) }); return { error: 'transcribe-fetch', detail: String(e) }; }
  }
  // Own-key mode uses the user's selected direct provider.
  const { dgKey } = await getKeys();
  if (RUNTIME.mode !== 'byok' || !dgKey) return { error: 'setup-required' };
  try {
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true', {
      method: 'POST', headers: { Authorization: 'Token ' + dgKey, 'Content-Type': mime || 'audio/webm' }, body: bytes
    });
    if (!res.ok) { const detail = (await res.text()).slice(0, 200); rlog('bg', 'error', 'deepgram', { status: res.status, detail }); return { error: 'deepgram ' + res.status, detail }; }
    return _parseDg(await res.json());
  } catch (e) { rlog('bg', 'error', 'deepgram-fetch', { detail: String(e) }); return { error: 'deepgram-fetch', detail: String(e) }; }
}

// ---------- cloud briefing — the explicitly selected Groq or Anthropic provider ----------
const GROQ_MODEL = RUNTIME.llmProvider === 'groq' ? RUNTIME.llmModel : 'llama-3.3-70b-versatile';
const LLM_MODEL = RUNTIME.llmProvider === 'anthropic' ? RUNTIME.llmModel : 'claude-sonnet-4-6';
async function groqLlm(key, sys, input, maxTokens) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.3,
      ...(GROQ_MODEL.startsWith('openai/gpt-oss-')
        ? { max_completion_tokens: Math.max(2048, maxTokens || 900), include_reasoning: false, reasoning_effort: 'low' }
        : { max_tokens: maxTokens || 900 }),
      messages: [{ role: 'system', content: sys }, { role: 'user', content: input }] })
  });
  const j = await res.json();
  if (!res.ok) { rlog('bg', 'error', 'groq', { status: res.status, detail: JSON.stringify(j).slice(0, 200) }); return { error: 'groq ' + res.status, detail: JSON.stringify(j).slice(0, 200) }; }
  const out = { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim(), via: 'groq · ' + GROQ_MODEL, usage: { in: (j.usage && j.usage.prompt_tokens) || 0, out: (j.usage && j.usage.completion_tokens) || 0 } };
  rlog('bg', 'event', 'groq-ok', { usage: out.usage, textLen: out.text.length });
  return out;
}
async function anthropicLlm(key, sys, input, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: LLM_MODEL, max_tokens: maxTokens || 900, system: sys, messages: [{ role: 'user', content: input }] })
  });
  const j = await res.json();
  if (!res.ok) { rlog('bg', 'error', 'anthropic', { status: res.status, detail: JSON.stringify(j).slice(0, 200) }); return { error: 'anthropic ' + res.status }; }
  const out = { text: (Array.isArray(j.content) ? j.content.filter(b => b.type === 'text' || typeof b.text === 'string').map(b => b.text || '').join('\n') : '').trim(), via: LLM_MODEL + ' · cloud', usage: { in: (j.usage && j.usage.input_tokens) || 0, out: (j.usage && j.usage.output_tokens) || 0 } };
  rlog('bg', 'event', 'llm-ok', { model: LLM_MODEL, usage: out.usage, textLen: out.text.length });
  return out;
}
async function llm(sys, input, maxTokens) {
  if (RUNTIME.mode === 'local') return localLlmPrompt(sys, input, maxTokens);
  const token = await getToken();
  if (token) {
    try {
      const res = await fetch(API_BASE + '/x/crunch', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.3,
      ...(GROQ_MODEL.startsWith('openai/gpt-oss-')
        ? { max_completion_tokens: Math.max(2048, maxTokens || 900), include_reasoning: false, reasoning_effort: 'low' }
        : { max_tokens: maxTokens || 900 }),
      messages: [{ role: 'system', content: sys }, { role: 'user', content: input }] })
      });
      if (res.status === 401) { await _authSet(null); return { error: 'signin-needed' }; }
      if (res.status === 402) return { error: 'limit' };
      const j = await res.json();
      if (!res.ok) { rlog('bg', 'error', 'x-crunch', { status: res.status }); return { error: 'crunch ' + res.status }; }
      const out = { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim(), via: 'disdat · nova-3 + groq', usage: { in: (j.usage && j.usage.prompt_tokens) || 0, out: (j.usage && j.usage.completion_tokens) || 0 } };
      rlog('bg', 'event', 'x-crunch-ok', { usage: out.usage, textLen: out.text.length });
      return out;
    } catch (e) { rlog('bg', 'error', 'x-crunch-fetch', { detail: String(e) }); return { error: 'crunch-fetch', detail: String(e) }; }
  }
  // Provider choice is explicit; errors stay with that provider.
  const { groqKey, llmKey } = await getKeys();
  try {
    if (RUNTIME.mode !== 'byok') return { error: 'setup-required' };
    if (groqKey) return await groqLlm(groqKey, sys, input, maxTokens);
    if (llmKey) return await anthropicLlm(llmKey, sys, input, maxTokens);
    return { error: 'setup-required' };
  } catch (e) { rlog('bg', 'error', 'llm-fetch', { detail: String(e) }); return { error: 'llm-fetch', detail: String(e) }; }
}

// ---------- assemble the session for the page to crunch ----------
function assemble(transcript, words) {
  const pages = [], seen = new Set();
  S.timeline.forEach(e => { if (e.page && !seen.has(e.page)) { seen.add(e.page); pages.push(e.page); } });
  S.events.forEach(e => { if (e.url && !seen.has(e.url)) { seen.add(e.url); pages.push(e.url); } });
  const trims = [];
  const cap = (arr, n, label) => { if (arr.length > n) { trims.push((arr.length - n) + ' ' + label + ' trimmed (kept newest ' + n + ')'); return arr.slice(-n); } return arr; };
  return {
    startT: S.startT, audioOffset: S.audioOffset,
    engagements: cap(S.timeline, 220, 'engagements'),
    net: cap(S.net, 120, 'network events'),
    mut: cap(S.mut, 120, 'mutations'),
    console: cap(S.console || [], 60, 'console messages'),
    render: cap(S.render || [], 120, 'render events'),
    events: cap(S.events, 220, 'interactions'),
    notes: S.notes,
    transcript, words, pages,
    trims: trims.join('; ')
  };
}
async function stopSession(liveText) {
  await ensureS();
  if (!S) return { error: 'no-session' };
  if (S.audioState !== 'recording') return { error: S.audioState === 'starting' ? 'microphone-starting' : 'microphone-unavailable' };
  const current = S;
  let transcript = '', words = [], audioSec = 0, via = 'none', dgErr = '';
  const a = await stopAudio(current.audioSessionId, true);
  if (S !== current) return { error: 'capture-tab-unavailable' };
  audioSec = (a && a.dur) || 0;
  if (a && a.transcript) {
    transcript = a.transcript; via = 'whisper · on-device';
    words = (a.words || []).map(w => ({ t: +(S.audioOffset + (w.t || 0)).toFixed(2), w: w.w }));
    rlog('bg', 'event', 'asr-used', { words: words.length, len: transcript.length });
  } else if (a && a.audioB64 && RUNTIME.mode !== 'local') {
    const r = await deepgramBytes(b64ToBytes(a.audioB64), a.mime); // optional sharper transcription if a Deepgram key is set
    if (S !== current) return { error: 'capture-tab-unavailable' };
    if (r.transcript) { transcript = r.transcript; via = 'deepgram'; audioSec = r.duration || audioSec; words = (r.words || []).map(w => ({ t: +(S.audioOffset + (w.start || 0)).toFixed(2), w: w.w })); }
    else { dgErr = (a.asrErr ? 'whisper: ' + a.asrErr + '; ' : '') + (r.error ? r.error + (r.detail ? ': ' + r.detail : '') : ''); }
  } else if (a && a.asrErr) { dgErr = 'whisper: ' + a.asrErr; }
  const session = assemble(transcript, words);
  session.audioSec = audioSec;
  session.transcriptVia = via;
  session.audio = { ok: !!(a && a.audioB64), bytes: (a && a.audioB64) ? a.audioB64.length : 0, mime: (a && a.mime) || '', error: (a && a.error) || dgErr || '' };
  rlog('bg', session.audio.error ? 'warn' : 'event', 'stopSession', { via, audioSec, transcriptLen: (transcript || '').length, engagements: (session.engagements || []).length, net: (session.net || []).length, mut: (session.mut || []).length, consoleMsgs: (session.console || []).length, render: (session.render || []).length, notes: (session.notes || []).length, trims: session.trims || '', audioErr: session.audio.error || '' });
  S = null;
  try { chrome.storage.session.remove('dd'); } catch (e) {} // fully end the session so a late event / SW restart can't resurrect it
  return { session };
}

function handleMessage(msg, sender, send) {
  switch (msg && msg.type) {
    case 'sessionState': {
      const owner = S && owns(sender, { tabId: S.ownerTabId, windowId: S.ownerWindowId });
      send(owner ? { recording: true, startT: S.startT, audioState: S.audioState, audioOffset: S.audioOffset }
        : { recording: false, startT: 0 }); return false;
    }
    case 'startSession': {
      lastCaptureOwner = { tabId: sender.tab.id, windowId: sender.tab.windowId };
      chrome.storage.session.set({ ddCaptureOwner: lastCaptureOwner });
      S = { ownerTabId: sender.tab.id, ownerWindowId: sender.tab.windowId, startT: msg.startT, audioOffset: 0,
        audioState: 'starting', audioSessionId: crypto.randomUUID(), timeline: [], net: [], mut: [], events: [], notes: [], console: [], render: [] };
      const current = S;
      try { chrome.storage.session.set({ dd: S }); } catch (e) {}
      setRun('run-' + msg.startT); rlog('bg', 'event', 'startSession', { startT: msg.startT });
      if (RUNTIME.mode === 'local') localLlmInit();
      startAudio(current.audioSessionId).then(a => {
        if (S !== current) { stopAudio(current.audioSessionId); send({ error: 'capture-tab-unavailable' }); return; }
        S.audioState = a?.ok ? 'recording' : 'failed';
        S.audioOffset = Math.max(0, (Date.now() - msg.startT) / 1000); persist();
        chrome.tabs.sendMessage(current.ownerTabId, { type: 'dd-audio-state', startT: current.startT,
          audioState: S.audioState, audioOffset: S.audioOffset }, { frameId: 0 }).catch(() => {});
        if (a && a.error && /NotAllowed|Permission|denied/i.test(a.error)) chrome.tabs.create({ url: chrome.runtime.getURL('request-mic.html') });
        rlog('bg', a && a.error ? 'error' : 'event', 'audio-start', { ok: !!(a && !a.error), error: (a && a.error) || '' });
        send({ ok: true, startT: msg.startT, audioState: S.audioState, audioOffset: S.audioOffset, audio: a });
      });
      return true;
    }
    case 'engage': S.timeline.push({ page: msg.page, kind: msg.kind, t: msg.t, dwellMs: msg.dwellMs, value: msg.value, facts: msg.facts }); persist(); send({ ok: true }); return false;
    case 'event': S.events.push(msg.ev); persist(); send({ ok: true }); return false;
    case 'net': S.net.push(msg.ev); persist(); send({ ok: true }); return false;
    case 'mut': S.mut.push(msg.ev); persist(); send({ ok: true }); return false;
    case 'console': (S.console = S.console || []).push(msg.ev); persist(); send({ ok: true }); return false;
    case 'render': (S.render = S.render || []).push(msg.ev); persist(); send({ ok: true }); return false;
    case 'note': S.notes.push(msg.note); persist(); send({ ok: true }); return false;
    case 'injectShim': {
      const id = sender && sender.tab && sender.tab.id;
      if (id) chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', files: ['privacy.js', 'inject-hooks.js', 'inject-main.js'] }).then(() => send({ ok: true })).catch(e => send({ error: String(e) }));
      else send({ error: 'no-tab' });
      return true;
    }
    case 'abortSession': { const id = S.audioSessionId; const cleared = clearS(); stopAudio(id); cleared.then(() => send({ ok: true })); return true; }
    case 'rlog': rlog(msg.src || 'content', msg.level || 'log', msg.tag || '', msg.data, msg.page); send({ ok: true }); return false;
    case 'debug': logDebug(msg.payload).then(() => send({ ok: true })); return true;
    case 'stopSession': stopSession(msg.liveText).then(send); return true;
    case 'llm': llm(msg.sys, msg.input, msg.maxTokens).then(send); return true;
    case 'localllmInit': localLlmInit(msg.model).then(send); return true;
    case 'localllm': localLlmPrompt(msg.sys, msg.input, msg.maxTokens).then(send); return true;
    case 'localllm-status': (async () => { if (RUNTIME.mode !== 'local') return send({ error: 'local-mode-required' }); try { await ensureOffscreen(); send(await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'llm-status' })); } catch (e) { send({ error: String(e) }); } })(); return true;
    case 'dd-runtime': send(runtimeStatus()); return false;
    case 'dd-setup': chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }); send({ ok: true }); return false;
    case 'dd-signin': signIn().then(send); return true;
    case 'dd-signout': signOut().then(send); return true;
    case 'dd-me': me().then(send); return true;
    case 'dd-upgrade': upgradeUrl(msg.which).then((r) => { if (r && r.url) chrome.tabs.create({ url: r.url }); send(r); }); return true;
    case 'dd-redeem': (async () => { try { const t = await getToken(); if (!t) return send({ error: 'signin-needed' });
      const r = await fetch(API_BASE + '/x/redeem', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: msg.code || '' }) });
      const j = await r.json(); send(r.ok ? j : { error: (j && j.detail) || 'redeem failed' }); } catch (e) { send({ error: String(e) }); } })(); return true;
    case 'dd-mics': (async () => { try { await ensureOffscreen(); send(await chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'mics' })); } catch (e) { send({ error: String(e) }); } })(); return true;
    case 'dd-micgrant': chrome.tabs.create({ url: chrome.runtime.getURL('request-mic.html') }); send({ ok: true }); return false;
    case 'dd-open': if (msg.url && /^https:\/\/(disdat\.dev|api\.disdat\.dev)\//.test(msg.url)) chrome.tabs.create({ url: msg.url }); send({ ok: true }); return false;
    case 'shot': captureShot(sender).then(send); return true;
    case 'local-capture': localCaptureDownload(msg, sender, false).then(send); return true;
    case 'local-capture-retry': localCaptureDownload(msg, sender, true).then(send); return true;
    case 'bundle': uploadBundle(msg.json, msg.name).then(send); return true;
    case 'bundleMulti': uploadArtifacts(msg.items, msg.name).then(send); return true;
    case 'fetchassets': fetchAssets(msg.urls).then(send); return true;
    case 'fetchcss': fetchCss(msg.urls).then(send); return true;
    case 'fetchsrc': fetchSrc(msg.urls, msg.tokens).then(send); return true;
  }
}

function owns(sender, owner) {
  return !!owner && sender?.id === chrome.runtime.id && sender.frameId === 0
    && sender.tab?.id === owner.tabId && sender.tab?.windowId === owner.windowId;
}
async function captureOwner() {
  if (lastCaptureOwner) return lastCaptureOwner;
  const saved = await chrome.storage.session.get('ddCaptureOwner');
  lastCaptureOwner = saved?.ddCaptureOwner || null;
  return lastCaptureOwner;
}
const liveSessionMessages = new Set(['engage', 'event', 'net', 'mut', 'console', 'render', 'note', 'stopSession', 'abortSession', 'shot']);
const captureMessages = new Set(['localllmInit', 'localllm', 'localllm-status', 'llm', 'fetchassets', 'fetchcss', 'fetchsrc', 'bundle', 'bundleMulti', 'local-capture', 'local-capture-retry']);
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!['startSession', 'sessionState'].includes(msg?.type) && !liveSessionMessages.has(msg?.type) && !captureMessages.has(msg?.type)) return handleMessage(msg, sender, send);
  (async () => {
    await ensureS();
    if (msg.type === 'startSession') {
      if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.tab?.windowId)) return send({ error: 'capture-tab-required' });
      if (S) return send({ error: 'capture-already-recording' });
    } else if (msg.type === 'sessionState') {
      return handleMessage(msg, sender, send);
    } else if (liveSessionMessages.has(msg.type)) {
      if (!S || !owns(sender, { tabId: S.ownerTabId, windowId: S.ownerWindowId })) return send({ error: 'capture-tab-mismatch' });
      if (['stopSession', 'abortSession'].includes(msg.type) && msg.startT !== S.startT) return send({ error: 'capture-session-mismatch' });
    } else if (!owns(sender, await captureOwner())) return send({ error: 'capture-tab-mismatch' });
    handleMessage(msg, sender, send);
  })().catch(() => send({ error: 'capture-unavailable' }));
  return true;
});
chrome.tabs.onActivated.addListener(() => { activeTabEpoch++; });
chrome.tabs.onRemoved.addListener(tabId => {
  activeTabEpoch++;
  ensureS().then(async () => {
    const owner = S ? { tabId: S.ownerTabId, windowId: S.ownerWindowId } : await captureOwner();
    if (owner?.tabId !== tabId) return;
    const audioId = S?.audioSessionId;
    clearS();
    if (audioId) stopAudio(audioId);
    if (await hasOffscreen()) chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'capture-download-release', owner }).catch(() => {});
  });
});
chrome.tabs.onDetached.addListener(tabId => {
  activeTabEpoch++;
  ensureS().then(() => { if (S?.ownerTabId === tabId) { const id = S.audioSessionId; clearS(); stopAudio(id); } });
});

async function localCaptureDownload(msg, sender, retry) {
  if (!['byok', 'local'].includes(RUNTIME.mode)) return { error: 'own-key-mode-required' };
  const owner = await captureOwner();
  if (!owns(sender, owner)) return { error: 'capture-tab-mismatch' };
  let held;
  try {
    if (!await ensureOffscreen()) return { error: 'capture-download-unavailable' };
    held = await chrome.runtime.sendMessage({ target: 'offscreen',
    cmd: retry ? 'capture-download-get' : 'capture-download-create', owner,
    ...(retry ? { receipt: msg.receipt } : { capture: msg.capture, filename: msg.filename }) });
  } catch (e) { return { error: 'capture-download-unavailable' }; }
  if (!held?.url || !held.receipt) return { error: held?.error || 'capture-download-unavailable' };
  try {
    await chrome.downloads.download({ url: held.url, filename: held.filename, saveAs: false, conflictAction: 'uniquify' });
    return { ok: true, receipt: held.receipt, filename: held.filename };
  } catch (e) { return { error: 'capture-download-retry', receipt: held.receipt, filename: held.filename }; }
}

// fetch cross-origin stylesheets the page's CSSOM won't expose (CDN-served CSS). The SW has
// host_permissions <all_urls>, so it can read these cross-origin bodies the content script can't —
// recovering authored CSS (incl :hover/:active/@media) that was otherwise a silent blind spot.
async function fetchCss(urls) {
  const out = {};
  await Promise.all((urls || []).slice(0, 12).map(async (u) => {
    try { const r = await fetch(u, { credentials: 'omit' }); if (!r.ok) return; const t = await r.text(); out[u] = t.length > 600000 ? t.slice(0, 600000) : t; } catch (e) {}
  }));
  return { css: out };
}

// SELF-HOST PACK: fetch the page's OWN JS source bytes (the render harness behind the WebGL/animations).
// The user's agent can't pull these itself (CORS/403, and the normie has no resi proxy) — but our bg can,
// on the user's residential IP, with host perms. Hard total budget so it never re-bloats the bundle;
// sequential so the running cap holds. Content already filtered to first-party, non-analytics .js.
async function fetchSrc(urls, tokens) {
  const TOTAL = 2_500_000, PER = 1_200_000, MAXFETCH = 100;
  const toks = (tokens || []).filter(Boolean);
  const fetched = [];
  await Promise.all((urls || []).slice(0, MAXFETCH).map(async (u) => {
    try {
      const r = await fetch(u, { credentials: 'omit' });
      if (!r.ok) return;
      let t = await r.text();
      if (t.length > PER) t = t.slice(0, PER) + '\n/* …Dis Dat truncated this source at 1.2MB */';
      // relevance = how many of the captured shader uniform names appear as string literals here. The
      // chunk that SETS UP the WebGL (gl.getUniformLocation("uFluidSimTexture")) matches the most — that
      // is the render harness, regardless of its position in the (mostly-boilerplate) chunk graph.
      let hits = 0; for (const k of toks) if (t.indexOf(k) >= 0) hits++;
      fetched.push({ u, t, hits, len: t.length });
    } catch (e) {}
  }));
  // keep the harness chunks (token hits) first, then the largest app chunks, until the budget is spent —
  // so we re-host the code behind what the user reacted to, not 2.5MB of framework boilerplate.
  fetched.sort((a, b) => (b.hits - a.hits) || (b.len - a.len));
  const out = {}, dropped = []; let total = 0, harnessFiles = 0;
  for (const f of fetched) {
    if (total + f.len > TOTAL) { dropped.push(f.u); continue; }
    out[f.u] = f.t; total += f.len; if (f.hits) harnessFiles++;
  }
  return { sources: out, dropped, bytes: total, harnessFiles };
}

// grab the visible tab as a JPEG, then DOWNSCALE it — content can't call captureVisibleTab, so it asks us.
// captureVisibleTab returns at the device pixel ratio (a 1440px viewport @2x = 2880px wide), which made
// 24 frames ≈ 3.4MB and was the dominant bundle weight + a memory/crash driver. A timeline thumbnail
// doesn't need retina, so we re-encode each to ≤1280px wide — ~4-5× smaller, no meaningful loss of gist.
function abToB64(ab) { let s = ''; const b = new Uint8Array(ab), chunk = 0x8000; for (let i = 0; i < b.length; i += chunk) s += String.fromCharCode.apply(null, b.subarray(i, i + chunk)); return btoa(s); }
async function downscaleJpeg(dataUrl, maxW, q) {
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    if (bmp.width <= maxW) { bmp.close && bmp.close(); return dataUrl; }
    const w = maxW, h = Math.round(bmp.height * (maxW / bmp.width)), c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
    const out = await c.convertToBlob({ type: 'image/jpeg', quality: q });
    return 'data:image/jpeg;base64,' + abToB64(await out.arrayBuffer());
  } catch (e) { return dataUrl; } // any failure → fall back to the full-res frame, never lose the shot
}
async function captureShot(sender) {
  await ensureS();
  const current = S;
  const owner = S ? { tabId: S.ownerTabId, windowId: S.ownerWindowId } : null;
  if (!owns(sender, owner)) return { error: 'capture-tab-mismatch' };
  try {
    const before = await chrome.tabs.get(owner.tabId);
    if (!before.active || before.windowId !== owner.windowId) return { error: 'capture-tab-inactive' };
    const epoch = activeTabEpoch;
    const url = await chrome.tabs.captureVisibleTab(owner.windowId, { format: 'jpeg', quality: 50 });
    const after = await chrome.tabs.get(owner.tabId);
    if (!after.active || after.windowId !== owner.windowId || epoch !== activeTabEpoch || S !== current) return { error: 'capture-tab-changed' };
    return { url: await downscaleJpeg(url, 1280, 0.65) };
  } catch (e) { return { error: 'capture-tab-unavailable' }; }
}

// gzip the full payload and push it to a neutral temp host so the agent gets ONE re-hosted link
// (no origin 403s, no auth). Primary: litterbox (catbox) — accepts .gz, direct link, 72h TTL.
// Fallback: tmpfiles — extension allowlist rejects .gz, so we send the gzip bytes as .txt and
// rewrite the viewer URL to its /dl/ direct-download form (1h TTL).
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _to = (ms) => { try { return AbortSignal.timeout(ms); } catch (e) { return undefined; } }; // per-host timeout so one hung host can't eat the whole window
async function upLitterbox(blob, base, gzipped) {
  const fd = new FormData(); fd.append('reqtype', 'fileupload'); fd.append('time', '72h'); fd.append('fileToUpload', blob, base + (gzipped ? '.json.gz' : '.json'));
  const txt = (await (await fetch('https://litterbox.catbox.moe/resources/internals/api.php', { method: 'POST', body: fd, signal: _to(15000) })).text()).trim();
  if (/^https?:\/\//.test(txt)) return { url: txt, host: 'litterbox', ttl: '72h' };
  throw new Error('litterbox: ' + txt.slice(0, 80));
}
async function upTmpfiles(blob, base, gzipped) {
  const fd = new FormData(); fd.append('file', blob, base + (gzipped ? '.json.gz.txt' : '.json'));
  const j = await (await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd, signal: _to(15000) })).json();
  const url = j && j.data && j.data.url;
  if (url) return { url: url.replace('://tmpfiles.org/', '://tmpfiles.org/dl/'), host: 'tmpfiles', ttl: '1h' };
  throw new Error('tmpfiles: no url');
}
async function up0x0(blob, base, gzipped) {
  const fd = new FormData(); fd.append('file', blob, base + (gzipped ? '.json.gz' : '.json'));
  const txt = (await (await fetch('https://0x0.st', { method: 'POST', body: fd, signal: _to(15000) })).text()).trim();
  if (/^https?:\/\//.test(txt)) return { url: txt, host: '0x0', ttl: 'days' };
  throw new Error('0x0: ' + txt.slice(0, 80));
}
// Re-host the gzipped bundle on a neutral, no-auth host so the agent never hits an origin 403. The
// "bundle didn't attach" reports were a single transient host failure with no retry — now each host gets
// retries with backoff, and there are THREE independent hosts, so it takes all of them failing to lose it.
async function uploadOne(jsonStr, base) {
  if (RUNTIME.mode !== 'hosted') return { error: 'hosted-mode-required' };
  base = (base || 'disdat-capture').replace(/[^a-z0-9._-]/gi, '');
  let blob, gzipped = false;
  try {
    if (typeof CompressionStream !== 'undefined') {
      const gz = new Response(jsonStr).body.pipeThrough(new CompressionStream('gzip'));
      blob = await new Response(gz).blob(); gzipped = true;
    } else { blob = new Blob([jsonStr], { type: 'application/json' }); }
  } catch (e) { blob = new Blob([jsonStr], { type: 'application/json' }); gzipped = false; }
  const bytes = blob.size;
  // ordered by reliability THEN how long the link lives: litterbox (72h, solid) → 0x0 (kept weeks–months,
  // scaled by size) → tmpfiles (only 1h, last resort). tmpfiles caps at 1h with no longer option, so it's
  // demoted below 0x0 — a fallback link now lives weeks, not an hour.
  const plan = [['litterbox', upLitterbox, 4], ['tmpfiles', upTmpfiles, 3]]; // 0x0.st disabled uploads (AI-spam) 2026-07 — removed
  for (const [host, fn, tries] of plan) {
    for (let i = 0; i < tries; i++) {
      try { const r = await fn(blob, base, gzipped); if (i || host !== 'litterbox') rlog('bg', 'event', 'bundle-host', { host: r.host, attempt: i + 1 }); return Object.assign(r, { bytes, gzipped }); }
      catch (e) { rlog('bg', 'warn', 'bundle-host-fail', { host, attempt: i + 1, err: String((e && e.message) || e).slice(0, 90) }); if (i + 1 < tries) await _sleep(700 * (i + 1)); }
    }
  }
  return { error: 'all-hosts-failed', bytes };
}
async function uploadBundle(jsonStr, name) { return uploadOne(jsonStr, name); } // v1 single-bundle (fallback path)
// v2: upload each artifact of the cascade separately so the agent fetches only the layers its task needs.
// items: [{key, json}] → results: {key: {url,bytes,gzipped,host,ttl}|{error}}. Parallel; each gets the
// full per-file 3-host retry above.
async function uploadArtifacts(items, name) {
  const out = {};
  await Promise.all((items || []).map(async (it) => {
    try { out[it.key] = await uploadOne(it.json, (name || 'disdat') + '-' + it.key); }
    catch (e) { out[it.key] = { error: String((e && e.message) || e).slice(0, 90) }; }
  }));
  return { results: out };
}
// Fetch the page's first-party asset BYTES (images/fonts/SVG) the user's agent can't pull past CORS, and
// return them base64'd so a pixel-exact clone doesn't depend on origin URLs that 403/expire. Hard caps so
// the assets artifact stays bounded; content already filtered to first-party, non-analytics asset URLs.
async function fetchAssets(urls) {
  const out = {}, dropped = []; let total = 0; const TOTAL = 6_000_000, PER = 2_000_000;
  for (const u of (urls || []).slice(0, 40)) { // sequential: keeps the running budget accurate + holds one buffer at a time (60 concurrent 2MB images would blow SW memory)
    if (total >= TOTAL) { dropped.push(u); continue; }
    try {
      const r = await fetch(u, { credentials: 'omit', signal: _to(20000) });
      if (!r.ok) { dropped.push(u); continue; }
      const buf = await r.arrayBuffer();
      if (buf.byteLength > PER || total + buf.byteLength > TOTAL) { dropped.push(u); continue; }
      total += buf.byteLength;
      out[u] = { mime: (r.headers.get('content-type') || '').split(';')[0], b64: abToB64(buf) };
    } catch (e) { dropped.push(u); }
  }
  return { assets: out, dropped, bytes: total };
}

// keep the service worker alive while a capture/crunch is in flight (content holds a port),
// so a long model download/inference doesn't get the worker killed mid-wait (which stranded
// the result and left the "Writing the code-speak" spinner stuck forever).
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'dd-keepalive') return;
  port.onMessage.addListener(() => { try { port.postMessage({ pong: 1 }); } catch (e) {} });
});
