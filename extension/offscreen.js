// Dis Dat — offscreen audio (cloud mode). ONE continuous mic stream + MediaRecorder for
// the whole recording session, so narration survives page navigations. Transcription
// (Deepgram) and the crunch (Groq) run in the background worker — no local models here,
// so nothing taxes the user's GPU. The local WebLLM/Whisper engine lives in git history
// (v0.4–0.6) for a future capable-machine toggle.
const rlog = (level, tag, data) => { try { chrome.runtime.sendMessage({ type: 'rlog', src: 'offscreen', level, tag, data }); } catch (e) {} };
let rec = null, chunks = [], stream = null, mime = 'audio/webm', audioSessionId = null, audioGeneration = 0;

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (!m || m.target !== 'offscreen') return;
  if (sender.id !== chrome.runtime.id || sender.tab) { send({ error: 'offscreen-sender' }); return false; }
  if (m.cmd?.startsWith('capture-download-')) {
    if (m.cmd === 'capture-download-create') send(DisdatPrivateDownloads.create(m.capture, m.filename, m.owner));
    else if (m.cmd === 'capture-download-get') send(DisdatPrivateDownloads.get(m.receipt, m.owner));
    else if (m.cmd === 'capture-download-release') send(DisdatPrivateDownloads.release(m.owner));
    return false;
  }
  if (m.cmd === 'start') { start(m.sessionId).then(send); return true; }
  if (m.cmd === 'stop') { stop(m.sessionId).then(send); return true; }
  if (m.cmd === 'mics') { listMics().then(send); return true; }
  if (m.cmd === 'llm-status') { send({ ready: true }); return false; } // cloud: nothing to download
});

// list audio inputs for the home-screen mic picker. Labels only appear once the extension origin has
// mic permission (granted via request-mic.html) — empty labels → tell the UI to offer the grant flow.
async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter(d => d.kind === 'audioinput');
    if (!mics.length || mics.every(d => !d.label)) return { error: 'no-permission' };
    return { mics: mics.map(d => ({ id: d.deviceId, label: d.label || 'Microphone' })) };
  } catch (e) { return { error: String((e && e.name) || e) }; }
}

function retireAudio() {
  const oldRec = rec, oldStream = stream;
  rec = null; stream = null; chunks = [];
  try { if (oldRec && oldRec.state !== 'inactive') oldRec.stop(); } catch (e) {}
  try { oldStream?.getTracks().forEach(t => t.stop()); } catch (e) {}
}
async function start(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return { error: 'audio-session-required' };
  if (audioSessionId === sessionId && rec?.state === 'recording') return { ok: true, mime };
  const generation = ++audioGeneration;
  audioSessionId = sessionId; retireAudio();
  let nextStream = null;
  try {
    // honor the user's chosen input (home-screen picker); fall back to the default mic on any failure
    const pick = await new Promise(r => { try { chrome.storage.local.get('dd_mic', s => r((s && s.dd_mic) || '')); } catch (e) { r(''); } });
    if (generation !== audioGeneration || audioSessionId !== sessionId) return { error: 'audio-start-cancelled' };
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: pick ? { deviceId: { exact: pick } } : true });
    } catch (e) {
      if (generation !== audioGeneration || audioSessionId !== sessionId) return { error: 'audio-start-cancelled' };
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (generation !== audioGeneration || audioSessionId !== sessionId) {
      nextStream.getTracks().forEach(t => t.stop()); return { error: 'audio-start-cancelled' };
    }
    const M = window.MediaRecorder;
    mime = (M && M.isTypeSupported && M.isTypeSupported('audio/webm')) ? 'audio/webm' : '';
    const nextChunks = [], nextRec = new M(nextStream, mime ? { mimeType: mime } : undefined);
    nextRec.ondataavailable = e => { if (e.data && e.data.size) nextChunks.push(e.data); };
    nextRec.start();
    rec = nextRec; stream = nextStream; chunks = nextChunks;
    rlog('event', 'audio-rec-start', { mime: mime || 'audio/webm' });
    return { ok: true, mime: mime || 'audio/webm' };
  } catch (e) {
    try { nextStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    if (generation === audioGeneration && audioSessionId === sessionId) { audioSessionId = null; retireAudio(); }
    rlog('error', 'audio-start-fail', { err: String((e && e.name) || e) }); return { error: String((e && e.name) || e) };
  }
}
async function stop(sessionId) {
  if (!sessionId || audioSessionId !== sessionId) return { error: 'audio-session-mismatch' };
  const currentRec = rec, currentStream = stream, currentChunks = chunks, currentMime = mime;
  audioGeneration++; audioSessionId = null; rec = null; stream = null; chunks = [];
  try {
    if (!currentRec) return { error: 'audio-start-cancelled' };
    await new Promise(res => { currentRec.onstop = res; try { currentRec.requestData(); } catch (e) {} currentRec.stop(); });
    const blob = new Blob(currentChunks, { type: currentMime || 'audio/webm' });
    if (!blob.size) return { ok: true, audioB64: '', mime: currentMime || 'audio/webm' };
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return { ok: true, audioB64: btoa(s), mime: currentMime || 'audio/webm' };
  } catch (e) { return { error: String(e) }; }
  finally { try { currentStream?.getTracks().forEach(t => t.stop()); } catch (e) {} }
}
rlog('event', 'offscreen-loaded', { mode: 'cloud-audio' });
