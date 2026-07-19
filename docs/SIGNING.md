# Signing & notarizing the macOS app

The desktop app builds unsigned by default (runnable locally via right-click →
Open). To ship a `.dmg` that opens cleanly on any Mac, sign with an Apple
Developer ID and notarize. Tauri reads everything from environment variables —
no code changes, just secrets.

## One-time Apple setup

1. Apple Developer Program membership ($99/yr).
2. Create a **Developer ID Application** certificate in the Apple Developer
   portal; download and install it in your login keychain.
3. Create an **App Store Connect API key** (Users & Access → Integrations) OR an
   app-specific password for your Apple ID (appleid.apple.com → Sign-In & Security).

## Build signed + notarized locally

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"   # or use the API-key vars below
export APPLE_TEAM_ID="TEAMID"

cd app && npm run tauri build
```

Tauri signs the `.app` with the hardened runtime + `entitlements.plist`, then
notarizes and staples the ticket to the `.dmg`. Verify:

```bash
codesign --verify --deep --strict --verbose=2 \
  "src-tauri/target/release/bundle/macos/Sponsoric.app"
spctl -a -t open --context context:primary-signature -vv \
  "src-tauri/target/release/bundle/dmg/Sponsoric_0.1.0_aarch64.dmg"
```

Both should report `accepted` / `valid on disk`.

## In CI

`.github/workflows/release-desktop.yml` builds on tag push and signs +
notarizes automatically when these repo secrets are set (otherwise it produces
an unsigned build):

| Secret | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: … (TEAMID)` |
| `APPLE_CERTIFICATE` | base64 of the exported `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | your 10-char team id |

Tag a release to trigger it:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Windows/Linux signing follow the same env-driven pattern — see the Tauri
distribution docs.
