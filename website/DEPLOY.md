# Website hosting

Use Node 20.19+ or 22.12+ and the npm lockfile:

```sh
npm ci
npm run build
```

Serve `dist/` from a static HTTPS host. Keep its HTML and asset files at their existing paths, and route other page requests to `index.html`. The main page embeds `research-vision.html`; the Library and its local token export use `library.html`.

The browser extension uses its separate private CLI configuration. The website works without hosted-service settings.

To connect your own existing account service, copy `.env.example` to `.env.local` before building and set:

| Public setting | Recipient-owned service |
|---|---|
| `VITE_API_BASE` | API base URL implementing the retained `/me`, billing, referral, MCP and Figma client contracts. |
| `VITE_SUPABASE_URL` | Your Supabase project URL with Google OAuth and this website's callback URL configured. |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase publishable key, or a legacy JWT whose role is `anon`. Database access is governed by your server policies. |

Vite embeds these values in public browser code. Keep provider keys, Stripe secrets and Supabase secret/service-role keys in your own server's private configuration. The build rejects a private Supabase key in the public key field. URLs use HTTPS, with HTTP accepted for loopback development. An incomplete configuration shows a setup page on `/get-started`, `/account` and `/auth/callback`; the client creates an auth session only after all settings are valid.

Billing continues through the configured API's checkout/portal endpoints. Its returned redirect URLs belong to that service. The public fork contains no original Stripe payment-link default or original website auth/API fallback. The separately deployed Disdat.dev hosted account runtime is unchanged by this source update. Server deployment remains part of the deferred extraction in [RELEASE-STATUS](../RELEASE-STATUS.md).

Public key types were checked against the [Supabase API key documentation](https://supabase.com/docs/guides/getting-started/api-keys) on 28 October 2026. The legacy variable name is retained for client compatibility; new deployments should use a publishable key.

The Library's sliders, presets, projects and token exports work locally. Its existing chat editor uses the configured API's `POST /x/labchat` contract: `{instruction, specimens}` returns `{message, calls}`. Vite emits the public API base in `hosted-config.json`; an empty base produces a setup message before any chat service request. The recipient's service owns access control, provider credentials, validation of tool calls and usage limits. That server is outside this source beta. Figma and Account links stay on the current website origin.
