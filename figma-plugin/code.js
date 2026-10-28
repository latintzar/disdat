// DisDat — Import Tokens (Figma plugin, main thread).
// Turns a DisDat DTCG token library into real Figma Variables — on ANY plan (the Plugin API has no
// Enterprise gate, unlike the Variables REST write API). The UI (ui.html) hands us the DTCG JSON;
// we build one "DisDat" collection and create a typed variable per token.
//
// buildPlan() is pure (no figma.* calls) so it can be unit-tested outside Figma.

function flatten(node, prefix, out) {
  for (const k in node) {
    const v = node[k];
    const name = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && '$value' in v) out[name] = { value: v.$value, type: v.$type || 'string' };
    else if (v && typeof v === 'object') flatten(v, name, out);
  }
  return out;
}

function hexToRgba(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
}

// DTCG token → {name (slashes for Figma groups), resolvedType, value}
function planToken(name, tok) {
  const figName = name.replace(/\./g, '/');
  const t = tok.type, raw = tok.value;
  if (t === 'color' && typeof raw === 'string' && raw.trim().startsWith('#')) {
    return { name: figName, resolvedType: 'COLOR', value: hexToRgba(raw) };
  }
  if (t === 'boolean' || raw === true || raw === false) {
    return { name: figName, resolvedType: 'BOOLEAN', value: !!raw };
  }
  if (t === 'number') return { name: figName, resolvedType: 'FLOAT', value: Number(raw) };
  // dimensions / durations / weights that are "12px" / "120ms" / 600 → FLOAT if a clean number leads
  if (['dimension', 'duration', 'fontWeight', 'fontSize'].indexOf(t) !== -1) {
    const m = /^-?\d*\.?\d+/.exec(String(raw));
    if (m) return { name: figName, resolvedType: 'FLOAT', value: parseFloat(m[0]) };
  }
  return { name: figName, resolvedType: 'STRING', value: String(raw) };
}

function buildPlan(dtcg) {
  const flat = flatten(dtcg, '', {});
  return Object.keys(flat).map(name => planToken(name, flat[name]));
}

async function importTokens(dtcg) {
  const plan = buildPlan(dtcg);
  if (!plan.length) throw new Error('No tokens found in that JSON.');
  // Idempotent: a prior "DisDat" collection is replaced, not duplicated, on re-run.
  const existing = await figma.variables.getLocalVariableCollectionsAsync();
  for (const c of existing) { if (c.name === 'DisDat') c.remove(); }
  const collection = figma.variables.createVariableCollection('DisDat');
  const modeId = collection.modes[0].modeId;
  let ok = 0, failed = [];
  for (const p of plan) {
    try {
      const v = figma.variables.createVariable(p.name, collection, p.resolvedType);
      v.setValueForMode(modeId, p.value);
      ok++;
    } catch (e) {
      failed.push(p.name + ' (' + (e && e.message ? e.message : e) + ')');
    }
  }
  return { ok, total: plan.length, failed };
}

// figma.* only exists inside Figma — guard so Node can require the pure helpers for tests.
if (typeof figma !== 'undefined') {
  figma.showUI(__html__, { width: 380, height: 520, themeColors: true });
  figma.ui.onmessage = async (msg) => {
    if (msg.type === 'import') {
      try {
        const dtcg = typeof msg.dtcg === 'string' ? JSON.parse(msg.dtcg) : msg.dtcg;
        const res = await importTokens(dtcg);
        figma.ui.postMessage({ type: 'done', ok: res.ok, total: res.total, failed: res.failed });
        figma.notify(`DisDat: imported ${res.ok}/${res.total} tokens as Variables`);
      } catch (e) {
        figma.ui.postMessage({ type: 'error', message: (e && e.message) ? e.message : String(e) });
      }
    }
    if (msg.type === 'close') figma.closePlugin();
  };
}

// Export the pure helpers for the Node unit test (ignored inside Figma).
if (typeof module !== 'undefined' && module.exports) module.exports = { buildPlan, planToken, hexToRgba, flatten };
