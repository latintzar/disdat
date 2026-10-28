# Dis Dat Figma token importer

This original plugin imports DTCG JSON into Figma Variables. In Figma Desktop, use Plugins → Development → Import plugin from manifest and select `manifest.json`. Choose **Paste JSON** and import an exported token library.

The optional library tab accepts an operator-controlled HTTPS server and library key. Before using it, replace the placeholder domain in `manifest.json` with your server's exact origin; Figma restricts plugin network access to the declared domains. The key stays in the plugin UI and is sent only to that origin. Redirects are rejected. A compatible server implements `GET /x/tokens`; the separate historical hosted backend is not configured by this plugin.

Original code is MIT licensed. Figma and its marks belong to their owners. Plugin import logic is tested offline; a live Figma account and server have not been exercised in this release.
