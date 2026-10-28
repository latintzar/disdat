// Local artifact handoff for an own-key runtime. This module performs no network requests.
(function (root) {
  'use strict';
  const names = new Set(['core', 'dom', 'screenshots', 'assets', 'sources']);
  function bundle(items, meta) {
    const artifacts = {};
    for (const item of items) {
      if (!names.has(item.key)) throw new Error('Unsupported capture artifact.');
      artifacts[item.key] = JSON.parse(item.json);
    }
    if (!artifacts.core) throw new Error('A local capture needs its core artifact.');
    return { format: 'disdat.capture/v1', createdAt: new Date().toISOString(), meta, artifacts };
  }
  function handoff(filename, prose) {
    return (prose || '') + '\n\n━━━ DIS DAT · local capture for your coding agent ━━━\n'
      + 'Capture file: ' + filename + ' (in the browser download folder).\n'
      + 'Use the Dis Dat skill. Unpack this JSON with the checkout’s local CLI:\n'
      + 'python3 tools/disdat.py unpack /path/to/' + filename + '\n'
      + 'Start with core.json. Other local artifacts contain the DOM, screenshots, assets and source when captured.\n'
      + 'The full transcript and exact runtime facts are in the capture. Use those values to make the requested change.\n'
      + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  }
  root.DisdatLocalDelivery = Object.freeze({ bundle, handoff });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DisdatLocalDelivery;
})(typeof globalThis === 'undefined' ? self : globalThis);
