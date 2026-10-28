# Dis Dat macOS source

This directory preserves two original Mac capture applications. `app/` is the later Dis Dat recorder; `macos/SmartCapture/` is the earlier native capture prototype. They use macOS screen, microphone and accessibility permissions. Run and build them only on a Mac you control.

The later app's source uses AppKit, SwiftUI and ScreenCaptureKit. Its backend, site and Supabase endpoint are supplied through app defaults or environment variables: `DISDAT_API_BASE`, `DISDAT_SITE_BASE`, `DISDAT_SUPABASE_URL` and `DISDAT_SUPABASE_ANON_KEY`. Without configuration they point to a reserved invalid host and do not use the original operating service. Its app identity and callback scheme are isolated from the original installation. Set up a compatible backend and authentication callback before using upload or sign-in. The update check runs only when requested by the user.

For a local source build on macOS with Xcode command-line tools:

```sh
sdk="$(xcrun --sdk macosx --show-sdk-path)"
swiftc -sdk "$sdk" -target arm64-apple-macos13.0 native/macos/app/Sources/*.swift -o /tmp/DisDat
```

A distributable app bundle requires the operator's own signing and packaging. The historical signing, deployment and updater credentials are excluded. The earlier prototype keeps crash logs local by default; its optional manual crash-report endpoint must be explicitly configured.

This is recovered source and is separate from the browser extension's local model path. CI typechecks the native recorder and builds the earlier SmartCapture prototype; no physical Mac capture, account sign-in, server upload or distribution signing has been tested as part of this release.
