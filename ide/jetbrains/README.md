# Cogwait for JetBrains IDEs

A labeled, opt-in sponsor line in the JetBrains **status bar**, via the official
`StatusBarWidget` API. Nothing is injected into the IDE — you install the plugin
and it uses the sanctioned status-bar surface. Works across IntelliJ IDEA,
PyCharm, WebStorm, GoLand, etc. (the widget API is platform-wide).

## Status

Reference source, scaffolded here. It follows the official extension-point
pattern (`statusBarWidgetFactory` → `StatusBarWidget.TextPresentation`) and is
self-contained (reads `~/.cogwait/config.json`, fetches the current ad, reports a
viewable impression — same accounting as the CLI). It has **not** been compiled
in this repo's environment (no Kotlin/IntelliJ SDK offline), so treat it as a
buildable starting point pending a verified `gradle buildPlugin`.

## Build + install

```
cd ide/jetbrains
gradle buildPlugin              # pulls the IntelliJ Platform SDK, produces build/distributions/*.zip
# then in any JetBrains IDE: Settings → Plugins → ⚙ → Install Plugin from Disk… → pick the zip
```

Or run it in a sandbox IDE:

```
gradle runIde
```

## Why this is the honest IDE path

You choose to install it, and it renders only in the plugin's own status-bar
widget through an official API. We do **not** patch the IDE's internals — that
would break across versions and violate the host's terms even with consent.
