#!/usr/bin/env node
'use strict';
// Cogwait platform CLI — honest coverage report + install snippets.
//   node bin/platforms.js            print the support matrix
//   node bin/platforms.js --detect   show the host detected right now
//   node bin/platforms.js --install <id>   print the install snippet for a host

const { PLATFORMS, byId, detectHost } = require('../lib/platforms');

const BADGE = {
  shipped: '\x1b[32m● shipped\x1b[0m',
  'adapter-ready': '\x1b[36m● adapter-ready\x1b[0m',
  planned: '\x1b[33m○ planned\x1b[0m',
  unsupported: '\x1b[31m✕ unsupported\x1b[0m',
};

const args = process.argv.slice(2);

if (args[0] === '--detect') {
  const id = detectHost(process.env);
  const p = byId(id);
  process.stdout.write(`detected host: ${p.label} (${id}) — ${p.status}\n`);
  process.exit(0);
}

if (args[0] === '--install') {
  const p = byId(args[1]);
  if (!p) { process.stderr.write(`unknown host: ${args[1]}\n`); process.exit(1); }
  process.stdout.write(`${p.label} — ${p.status}\nmechanism: ${p.mechanism || '(none)'}\n\n${p.install}\n`);
  process.exit(0);
}

process.stdout.write('\nCogwait — where the sponsor line renders\n\n');
for (const p of PLATFORMS) {
  const pad = ' '.repeat(Math.max(0, 22 - p.label.length));
  process.stdout.write(`  ${p.label}${pad}${BADGE[p.status] || p.status}\n`);
  process.stdout.write(`  ${' '.repeat(22)}${p.mechanism || 'no official surface — not injected'}\n\n`);
}
process.stdout.write('  Legend: shipped = automatic · adapter-ready = one config line ·\n');
process.stdout.write('          planned = official API, extension/plugin not built · unsupported = no consensual surface\n\n');
process.stdout.write('  Install a host:  node bin/platforms.js --install <id>\n');
process.stdout.write('  IDs: ' + PLATFORMS.map((p) => p.id).join(', ') + '\n\n');
