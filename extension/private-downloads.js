// Loaded only by the extension-owned offscreen document. Page content never receives Blob URLs.
(function (root) {
  'use strict';
  const held = new Map();
  const TTL = 15 * 60 * 1000;
  function remove(receipt) {
    const record = held.get(receipt);
    if (!record) return;
    clearTimeout(record.timer); URL.revokeObjectURL(record.url); held.delete(receipt);
  }
  function create(capture, filename, owner) {
    if (!capture || capture.format !== 'disdat.capture/v1' || !capture.artifacts?.core
        || !/^disdat-capture-[A-Za-z0-9._-]+\.json$/.test(filename)
        || !Number.isInteger(owner?.tabId) || !Number.isInteger(owner?.windowId)) {
      return { error: 'capture-download-input' };
    }
    for (const [receipt, record] of held) {
      if (record.owner.tabId === owner.tabId) remove(receipt);
    }
    const receipt = crypto.randomUUID();
    const url = URL.createObjectURL(new Blob([JSON.stringify(capture)], { type: 'application/json' }));
    const timer = setTimeout(() => remove(receipt), TTL);
    held.set(receipt, { url, filename, owner, timer });
    return { receipt, url, filename };
  }
  function get(receipt, owner) {
    const record = held.get(receipt);
    if (!record || record.owner.tabId !== owner?.tabId || record.owner.windowId !== owner?.windowId) {
      return { error: 'capture-download-expired' };
    }
    return { receipt, url: record.url, filename: record.filename };
  }
  function release(owner) {
    for (const [receipt, record] of held) if (record.owner.tabId === owner?.tabId) remove(receipt);
    return { ok: true };
  }
  root.DisdatPrivateDownloads = Object.freeze({ create, get, release });
})(globalThis);
