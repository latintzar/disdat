# Retained Dis Dat server

This directory preserves the original hosted backend source for capture processing, account authentication, billing, token libraries, Figma integration, transcription, briefing and mail. It is separate from the browser extension's local-model mode. The original operating deployment and its accounts, customer data, keys and deployment files are excluded.

The service is retained for development and migration. Its entrypoint is disabled until `DISDAT_ENABLE_LEGACY_SERVER=1` is explicitly set. Replace placeholder domains and filesystem paths and configure your own services before running it. The code requires further security review before exposure: the capture manifest write route was originally public, and the wider authentication, upload limits, OAuth and storage behavior have not been independently verified. The capture proxy now rejects redirects after checking the allowed host.

## Operator configuration

Install `requirements.txt` in a private Python environment. Configure the service through its own environment, including the settings relevant to the features you enable:

- `BASE_DIR`, `SPEND_DB`, `PUBLIC_BASE`, `PUBLIC_API`, `PUBLIC_SITE` and comma-separated `DISDAT_ALLOWED_ORIGINS` for your own state and HTTPS origins.
- `SUPABASE_URL`, `SUPABASE_JWT_SECRET` and `LIBRARY_SIGNING_SECRET` for authentication and signed library/session access.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` for optional billing.
- `DEEPGRAM_API_KEY` and the selected `GROQ_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` for the corresponding provider paths.
- `FIGMA_CLIENT_ID`, `FIGMA_CLIENT_SECRET` and `FIGMA_REDIRECT` for optional Figma integration.
- `DISDAT_KEYDROP_DIR`, `DISDAT_RECDROP_DIR`, `DISDAT_SKILL_PATH`, `LAB_FEEDBACK_PATH`, `DISDAT_MEDIA_DIR` and `DISDAT_EXTENSION_ZIP` for optional local state and content. Email transport needs separately configured sender and provider credentials.

For Figma iframe access, include `null` in `DISDAT_ALLOWED_ORIGINS` only if your deployment needs that origin. The retained modules also include placeholder strings where original operator paths or service origins appeared. Review them for your deployment. After configuration and review, the entrypoint can be started with `uvicorn --app-dir legacy/server feedback_server:app`. Provider calls and outbound mail occur only when those features are invoked.

Offline tests verify the default entrypoint guard and that the capture proxy refuses redirects. They do not establish production safety, provider authentication, billing, Figma authorization or deployed service behavior.
