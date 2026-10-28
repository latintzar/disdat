// External script — MV3 extension pages block inline <script> via CSP.
document.getElementById('go').onclick = async () => {
  const msg = document.getElementById('msg');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop()); // we only needed the permission grant
    msg.className = 'ok'; msg.textContent = '✓ Microphone enabled. Close this tab and hit Start recording.';
    document.getElementById('go').disabled = true;
  } catch (e) {
    msg.className = 'err'; msg.textContent = 'Denied (' + ((e && e.name) || e) + '). Click the mic icon in the address bar to allow, then retry.';
  }
};
