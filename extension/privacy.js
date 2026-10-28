// Storage is optional context. Redact nested credentials before truncating or exporting a value.
(function (root) {
  'use strict';
  const SECRET = /token|auth|session|secret|(?:api|private|signing)[_-]?key|jwt|bearer|password|passphrase|credential|cookie/i;
  function looksSecret(value) {
    return typeof value === 'string' && (/^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(value)
      || /^[A-Za-z0-9_-]{40,}$/.test(value)
      || /(?:sk|pk|api|ghp|xox)[-_][A-Za-z0-9]{16,}/i.test(value));
  }
  function text(value) {
    return value
      .replace(/(bearer\s+)[A-Za-z0-9._\-]+/gi, '$1⟦redacted⟧')
      .replace(/((?:"?[\w-]*(?:token|auth|session|secret|(?:api|private|signing)[_-]?key|jwt|bearer|password|passphrase|credential|cookie)[\w-]*"?)\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,;&\r\n}]+)/gi, '$1"⟦redacted⟧"')
      .replace(/\beyJ[A-Za-z0-9._\-]{20,}/g, '⟦redacted-jwt⟧');
  }
  function clean(value, key = '', depth = 0) {
    if (SECRET.test(key)) return '⟦redacted-key⟧';
    if (depth > 24) return '⟦redacted-depth⟧';
    if (typeof value === 'string') {
      if (looksSecret(value)) return '⟦redacted-secret⟧';
      if (value.length > 1024 * 1024) return '⟦redacted-large-value⟧';
      try {
        const decoded = JSON.parse(value);
        if (decoded && typeof decoded === 'object') return JSON.stringify(clean(decoded, '', depth + 1));
      } catch (e) { /* Plain safe text remains useful context. */ }
      return text(value);
    }
    if (Array.isArray(value)) return value.map(item => clean(item, '', depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item, name, depth + 1)]));
    }
    return value;
  }
  function storage(store) {
    const result = {};
    try {
      for (let index = 0; index < store.length; index++) {
        const key = store.key(index);
        if (!key) continue;
        let value = clean(store.getItem(key), key);
        if (typeof value === 'string' && value.length > 4000) value = value.slice(0, 4000) + '…';
        result[key] = value;
      }
    } catch (e) { /* Capture retains the readable subset. */ }
    return result;
  }
  root.DisdatPrivacy = Object.freeze({ clean, storage, text });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.DisdatPrivacy;
})(globalThis);
