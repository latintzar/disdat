# Website hosting

Use Node 20.19+ or 22.12+ and the npm lockfile:

```sh
npm ci
npm run build
```

Serve `dist/` from a static HTTPS host. Keep its HTML and asset files at their existing paths, and route other page requests to `index.html`. The main page embeds `research-vision.html`; the Library and its local token export use `library.html`.

The browser extension uses its separate private CLI configuration. Hosted account and billing pages depend on the existing Dis Dat service. This source beta includes their client code; server deployment remains part of the deferred source extraction in [RELEASE-STATUS](../RELEASE-STATUS.md).
