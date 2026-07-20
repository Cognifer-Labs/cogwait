# Cogwait for VS Code / Cursor

A labeled, opt-in sponsor line in the editor **status bar**, rendered through the
official `StatusBarItem` API. Nothing is patched or injected into the editor —
this is an extension you install, using the surface VS Code sanctions for
extensions. Cursor is a VS Code fork and runs it unchanged.

## What it does

- Shows `📣 [sponsor] <ad> ›` in the right side of the status bar.
- Click it to open the sponsor link.
- Reuses the same config (`~/.cogwait/config.json`), cached ad, and
  viewable-impression accounting as the CLI — earnings land in the same place.
- Turn it off any time: `Cogwait: enabled` setting → off (renders nothing).

## Run it (dev)

```
# from ide/vscode
code --extensionDevelopmentPath="$PWD" .
# or press F5 in VS Code with this folder open
```

## Package / install

```
npx @vscode/vsce package          # builds cogwait-vscode-0.1.0.vsix
code --install-extension cogwait-vscode-0.1.0.vsix
cursor --install-extension cogwait-vscode-0.1.0.vsix   # Cursor uses the same VSIX
```

## Why this is the honest IDE path

The user chooses to install it, and it renders only in the extension's own
status-bar item via an official API. That's the consensual model. We do **not**
patch the editor's internals or inject into UI the editor controls — that would
break on updates and violate the host's terms even with consent.
