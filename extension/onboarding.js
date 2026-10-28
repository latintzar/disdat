// External script — MV3 extension pages block inline <script> via CSP.
// This page IS an extension page, so it can message the background to sign the user in inline.

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((r) => { try { chrome.runtime.sendMessage(msg, (resp) => { void chrome.runtime.lastError; r(resp); }); } catch (e) { r(null); } });

// ---- Step 1: sign in (inline, via the background's Supabase Google flow) ----
function renderAuth(me) {
  if (me && me.mode !== 'hosted') {
    $('signin').style.display = 'none';
    $('refbox').hidden = true;
    $('step-auth').classList.toggle('done', !!me.ready);
    $('setup-title').textContent = me.ready ? 'Your provider setup is ready' : 'Configure your providers';
    $('setup-description').textContent = me.ready
      ? 'Deepgram transcribes your audio. ' + me.provider + ' writes your briefing. Capture artifacts save locally.'
      : 'Ask your coding agent to run the checkout’s tools/disdat.py setup with your private provider environment.';
    $('signed').classList.remove('show');
    $('setup-command').hidden = !!me.ready;
    $('setup-footer').textContent = 'Provider setup: local CLI. Check it with doctor.';
    $('toggle').style.display = 'none';
    $('snip-hint').textContent = 'Ask your coding agent';
    $('snip').textContent = 'Install skills/disdat from this checkout.';
    $('record-help').textContent = 'Click Dis Dat on a page, start recording, and talk while you point or scroll. Stop downloads the capture and copies the briefing for your agent.';
    return;
  }
  const signedIn = me && me.signedIn;
  $('signin').style.display = signedIn ? 'none' : 'inline-flex';
  const s = $('signed');
  if (signedIn) {
    $('email').textContent = me.email || 'your account';
    const left = (me.minutesLeft != null) ? Math.round(me.minutesLeft) : null;
    $('mins').textContent = left != null ? ' · ' + left + ' min left' : '';
    s.classList.add('show');
    $('step-auth').classList.add('done');
    // referral: show own code + count; offer redeem until used
    const rb = $('refbox'); rb.hidden = false;
    $('refcode').textContent = me.referralCode || '…';
    $('refcount').textContent = (me.referralCount || 0) + ' joined';
    $('ref-redeem').style.display = me.redeemed ? 'none' : 'flex';
    $('refcopy').onclick = () => {
      navigator.clipboard.writeText('Try Dis Dat — show your coding agent anything: https://disdat.dev · use my code ' + (me.referralCode || '') + ' for a free month of Pro').then(() => {
        $('refcopy').textContent = 'copied ✓'; setTimeout(() => ($('refcopy').textContent = 'copy invite'), 1400);
      });
    };
    $('refapply').onclick = async () => {
      const code = $('refin').value.trim(); if (!code) return;
      $('refapply').disabled = true; $('refapply').textContent = '…';
      const r = await send({ type: 'dd-redeem', code });
      $('refapply').disabled = false; $('refapply').textContent = 'Apply';
      if (r && r.ok) { $('ref-redeem').innerHTML = '<span style="color:#1f7a3d;font-weight:700;font-size:13px">🎉 ' + (r.message || 'You both got a month of Pro') + '</span>'; send({ type: 'dd-me' }).then(renderAuth); }
      else { $('refin').style.borderColor = '#c0142b'; $('refin').value = ''; $('refin').placeholder = (r && r.error) || 'Code not found — try again'; }
    };
  } else {
    s.classList.remove('show');
    $('step-auth').classList.remove('done');
    $('refbox').hidden = true;
  }
}
$('signin').onclick = async () => {
  $('signin').disabled = true; $('signin').textContent = 'Opening Google…';
  const r = await send({ type: 'dd-signin' });
  $('signin').disabled = false;
  if (!(r && r.signedIn)) { location.reload(); return; } // sign-in cancelled/failed → reset the button
  renderAuth(r);
};
// reflect an existing session on load
send({ type: 'dd-me' }).then((me) => { if (me) renderAuth(me); });

// ---- Step 2: the skill-install snippet, per agent ----
const SNIP = {
  claude: { hint: 'Run this in your project (Claude Code)', text: 'npx skills add DisDat-dev/disdat' },
  cursor: { hint: 'Run this in your project (Cursor)', text: 'npx skills add DisDat-dev/disdat' },
  codex: { hint: 'Paste this in Codex', text: '$skill-installer Install the Dis Dat skill from https://github.com/DisDat-dev/disdat' },
  copilot: { hint: 'Run this in your project (Copilot & 18+ agents)', text: 'npx skills add DisDat-dev/disdat' },
  lovable: { hint: 'Lovable → Settings → Skills → Add → Import from GitHub — paste this URL', text: 'https://github.com/DisDat-dev/disdat/tree/main/skills/disdat' },
};
document.querySelectorAll('#toggle button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('#toggle button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    const s = SNIP[b.dataset.k] || SNIP.npx;
    $('snip-hint').textContent = s.hint;
    $('snip').textContent = s.text;
  };
});

// ---- copy the snippet ----
$('copy-snip').onclick = () => {
  navigator.clipboard.writeText($('snip').textContent).then(() => {
    const t = $('copy-snip').textContent; $('copy-snip').textContent = 'Copied ✓';
    setTimeout(() => ($('copy-snip').textContent = t), 1200);
  }).catch(() => {});
};
