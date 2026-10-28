// These are public browser settings for a recipient-owned optional hosted service.
export function resolveHostedConfig(env = {}) {
  const errors = [];
  function endpoint(name) {
    const value = String(env[name] || '').trim();
    if (!value) return '';
    try {
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
          url.username || url.password || url.search || url.hash) throw new Error();
      return value.replace(/\/+$/, '');
    } catch {
      errors.push(name);
      return '';
    }
  }
  const apiBase = endpoint('VITE_API_BASE');
  const supabaseUrl = endpoint('VITE_SUPABASE_URL');
  let supabaseKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (supabaseKey) {
    let publicKey = supabaseKey.startsWith('sb_publishable_');
    if (supabaseKey.split('.').length === 3) {
      try {
        const payload = supabaseKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        publicKey = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))).role === 'anon';
      } catch { publicKey = false; }
    }
    if (!publicKey) {
      errors.push('VITE_SUPABASE_ANON_KEY');
      supabaseKey = '';
    }
  }
  return Object.freeze({ apiBase, supabaseUrl, supabaseKey, errors,
    configured: Boolean(apiBase && supabaseUrl && supabaseKey && !errors.length) });
}
