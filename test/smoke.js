#!/usr/bin/env node
'use strict';
// Smoke test: drives the statusline exactly as Claude Code would (JSON on stdin)
// in MOCK mode, and asserts a labeled sponsor line is rendered. No network.

const { spawnSync } = require('child_process');
const path = require('path');

const statusline = path.resolve(__dirname, '..', 'bin', 'statusline.js');
const sample = JSON.stringify({
  session_id: 'smoke-test-session',
  model: { display_name: 'Fable' },
  cost: { total_api_duration_ms: 1234 },
  context_window: { used_percentage: 12 }
});

function run(env) {
  return spawnSync(process.execPath, [statusline], {
    input: sample,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env)
  });
}

let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else { console.log('  ✗', msg); failed++; }
}

console.log('Sponsoric smoke test');

// 1. Mock mode renders a labeled sponsor line.
const mock = run({ SPONSORIC_MOCK: '1', SPONSORIC_PAYOUT_ID: '', SPONSORIC_DISABLED: '' });
assert(mock.status === 0, 'statusline exits 0');
assert(/\[sponsor\]/.test(mock.stdout), 'renders [sponsor] label');
assert(mock.stdout.trim().length > 0, 'produces visible output');

// 2. Disabled -> prints nothing (no ad, no impression).
const off = run({ SPONSORIC_MOCK: '1', SPONSORIC_DISABLED: '1' });
assert(off.status === 0, 'disabled exits 0');
assert(off.stdout.trim() === '', 'disabled renders nothing');

// 3. No payout id and not mocked -> nothing shown (never bills without a surface).
const nokey = run({ SPONSORIC_MOCK: '', SPONSORIC_PAYOUT_ID: '', SPONSORIC_DISABLED: '' });
assert(nokey.stdout.trim() === '', 'no payout id + no mock renders nothing');

console.log(failed === 0 ? '\nPASS' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
