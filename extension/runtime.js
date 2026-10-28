// Configuration is generated into the user's private unpacked extension by tools/disdat.py.
// This module exposes status without passing credentials to page content scripts.
(function (root) {
  'use strict';
  const input = root.DISDAT_CONFIG || {};
  const mode = ['byok', 'hosted'].includes(input.mode) ? input.mode : 'setup';
  const llmProvider = ['groq', 'anthropic'].includes(input.llmProvider) ? input.llmProvider : '';
  const defaults = { groq: 'openai/gpt-oss-20b', anthropic: 'claude-sonnet-4-6' };
  const config = Object.freeze({
    mode, llmProvider,
    llmModel: typeof input.llmModel === 'string' ? input.llmModel : (defaults[llmProvider] || ''),
    deepgramKey: typeof input.deepgramKey === 'string' ? input.deepgramKey : '',
    llmKey: typeof input.llmKey === 'string' ? input.llmKey : '',
  });
  function status() {
    const missing = [];
    if (mode === 'setup') missing.push('mode');
    if (mode === 'byok') {
      if (!config.deepgramKey) missing.push('DEEPGRAM_API_KEY');
      if (!llmProvider) missing.push('DISDAT_LLM_PROVIDER');
      if (!config.llmKey) missing.push(llmProvider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GROQ_API_KEY');
    }
    return { mode, ready: missing.length === 0, provider: llmProvider || null,
      model: config.llmModel || null, missing, delivery: mode === 'byok' ? 'local-file' : 'hosted' };
  }
  root.DisdatRuntime = Object.freeze({ config, status });
})(typeof self === 'undefined' ? globalThis : self);
