# Dis Dat website

Disdat is a browser extension for coding agents. This directory builds its home and download pages from the approved Disdat.dev React components, with bundled fonts and the original product demonstration. The Library retains fifteen token, spring and UI specimens with local export.

```sh
npm ci
npm run build
npm run preview
```

Use Node 20.19+ or 22.12+ and run those commands in this directory. The main React page embeds `public/research-vision.html` with the existing demonstrations. Source and install links target `latintzar/disdat`. [Export scope](../docs/export-scope.md) records the historical compiled-orb experiment, unused reference demos/media and macOS installer preserved in the private original.

Home and Download link directly to the public extension ZIP. [The portable packager](../docs/extension-download.md) reproduces that ZIP, including setup mode and its font notices.

Account, sign-in and OAuth callback routes use an optional recipient-owned API and Supabase project. A clean clone shows their setup state before any auth client mounts. Copy `.env.example` to `.env.local` and configure all three public settings to enable them. The original hosted server, billing configuration and Figma OAuth service are separate dependencies; this repository includes their existing browser client. [Website hosting](DEPLOY.md) describes those boundaries and routing.
