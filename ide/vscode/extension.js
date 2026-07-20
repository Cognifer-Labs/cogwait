'use strict';
// Cogwait VS Code / Cursor extension — renders the labeled sponsor line in the
// extension's OWN status-bar item, via the official `createStatusBarItem` API.
// This is the consensual path: the user installs the extension, it uses the
// editor's sanctioned surface, nothing is patched or injected into the editor.
// Cursor is a VS Code fork and runs this unchanged.
//
// It reuses the same client (config, cached ad, viewable-impression contract)
// and the shared plain-text renderer, so behavior matches every other surface.

const vscode = require('vscode');
const path = require('path');

// Reference wiring: require the repo libs directly. A published .vsix would
// bundle lib/ instead; the logic is identical.
const client = require(path.join(__dirname, '..', '..', 'lib', 'client'));
const { renderPlain } = require(path.join(__dirname, '..', '..', 'lib', 'render'));

let item;
let timer;
let current = null;

function sessionId() {
  return 'vscode-' + (vscode.env.machineId || 'anon');
}

function enabled() {
  try {
    return vscode.workspace.getConfiguration('cogwait').get('enabled', true);
  } catch (_) { return true; }
}

function tick() {
  if (!enabled() || client.DISABLED || client.LEVEL <= 0) { item.hide(); return; }
  const ad = client.getCachedAd(sessionId()); // sync read; refreshes out of band when stale
  if (!ad) { item.hide(); return; }            // no ad → render nothing, bill nothing
  current = ad;
  item.text = '$(megaphone) ' + renderPlain(ad, client.LEVEL);
  item.tooltip = 'Sponsored placement' + (ad.url ? ` — ${ad.url}\nClick to open` : '');
  item.command = ad.url ? 'cogwait.openSponsor' : undefined;
  item.show();
  // The line is on screen → report one viewable impression (throttled in the
  // client, deduped + daily-capped server-side, detached, silent on failure).
  client.reportImpression(sessionId(), ad);
}

function activate(context) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  context.subscriptions.push(item);
  context.subscriptions.push(
    vscode.commands.registerCommand('cogwait.openSponsor', () => {
      if (current && current.url) vscode.env.openExternal(vscode.Uri.parse(current.url));
    })
  );
  tick();
  timer = setInterval(tick, 20000); // backend rotates fill on ~20s buckets
  context.subscriptions.push({ dispose: () => timer && clearInterval(timer) });
}

function deactivate() { if (timer) clearInterval(timer); }

module.exports = { activate, deactivate };
