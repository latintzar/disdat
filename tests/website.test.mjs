import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHostedConfig } from '../website/src/hosted-config.mjs';

const own = { VITE_API_BASE: 'https://api.example.test/',
  VITE_SUPABASE_URL: 'https://auth.example.test/',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_example' };

test('a clone starts without any account binding', () => {
  assert.deepEqual(resolveHostedConfig(), { apiBase: '', supabaseUrl: '',
    supabaseKey: '', errors: [], configured: false });
  assert.equal(resolveHostedConfig({ VITE_API_BASE: own.VITE_API_BASE }).configured, false);
});

test('recipient settings and loopback development are explicit', () => {
  const result = resolveHostedConfig(own);
  assert.equal(result.configured, true);
  assert.equal(result.apiBase, 'https://api.example.test');
  assert.equal(resolveHostedConfig({ ...own, VITE_API_BASE: 'http://localhost:8000' }).configured, true);
  for (const value of ['http://remote.example.test', 'https://user:password@example.test',
    'https://api.example.test?token=example', 'javascript:alert(1)']) {
    const invalid = resolveHostedConfig({ ...own, VITE_API_BASE: value });
    assert.deepEqual(invalid.errors, ['VITE_API_BASE']);
    assert.equal(invalid.apiBase, '');
  }
});

test('only a public Supabase browser key is accepted', () => {
  const jwt = role => ['example', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'example'].join('.');
  assert.equal(resolveHostedConfig({ ...own, VITE_SUPABASE_ANON_KEY: jwt('anon') }).configured, true);
  for (const key of ['sb_secret_example', jwt('service_role'), 'example-private-key', 'a.not-json.c']) {
    const result = resolveHostedConfig({ ...own, VITE_SUPABASE_ANON_KEY: key });
    assert.equal(result.configured, false);
    assert.equal(result.supabaseKey, '');
    assert.deepEqual(result.errors, ['VITE_SUPABASE_ANON_KEY']);
    assert.ok(!JSON.stringify(result).includes(key));
  }
});
