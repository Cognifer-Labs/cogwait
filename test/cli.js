#!/usr/bin/env node
'use strict';
// CLI entry-point tests for bin/setup.js — the one file that rewrites
// ~/.claude/settings.json, and the one that had no coverage at all.
//
// SAFETY: every child runs with BOTH an isolated HOME and an isolated
// COGWAIT_DATA_DIR. The client's config path is derived from os.homedir() and
// does NOT honour COGWAIT_DATA_DIR, so a run without a temp HOME would rewrite
// the real ~/.cogwait/config.json and the real ~/.claude/settings.json.

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SETUP = path.join(ROOT, 'bin', 'setup.js');
const STATUSLINE = path.join(ROOT, 'bin', 'statusline.js');
let failed = 0;
const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
console.log('Cogwait CLI tests');

const homes = [];
function newHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-cli-'));
  homes.push(home);
  return home;
}
function settingsPath(home) { return path.join(home, '.claude', 'settings.json'); }
function readSettings(home) {
  try { return JSON.parse(fs.readFileSync(settingsPath(home), 'utf8')); } catch (_) { return null; }
}
function run(home, args, env) {
  return spawnSync(process.execPath, [SETUP].concat(args || []), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      HOME: home, USERPROFILE: home,
      COGWAIT_DATA_DIR: path.join(home, 'data')
    }, env || {})
  });
}

// 1. --help prints usage, exits 0, and does not install anything.
{
  const home = newHome();
  const r = run(home, ['--help']);
  assert(r.status === 0, '--help exits 0');
  assert(/Usage:\s+npx cogwait/.test(r.stdout), '--help prints usage');
  assert(/--cashout/.test(r.stdout) && /--earnings/.test(r.stdout), '--help lists the new flags');
  assert(readSettings(home) === null, '--help does not create ~/.claude/settings.json');
}

// 2. An unknown flag is rejected instead of falling through to "install".
{
  const home = newHome();
  const r = run(home, ['--nope']);
  assert(r.status !== 0, 'unknown flag exits non-zero');
  assert(/Unknown option/.test(r.stderr), 'unknown flag explains itself on stderr');
  assert(readSettings(home) === null, 'unknown flag does NOT install the statusLine');
}

// 3. A bare run installs the statusLine into settings.json.
{
  const home = newHome();
  const r = run(home, []);
  assert(r.status === 0, 'install exits 0');
  const s = readSettings(home);
  assert(!!(s && s.statusLine && s.statusLine.type === 'command'), 'install writes a command statusLine');
  assert(!!(s && String(s.statusLine.command).includes(STATUSLINE)), 'statusLine points at bin/statusline.js');
}

// 4. --uninstall removes it again, and leaves unrelated settings alone.
{
  const home = newHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(settingsPath(home), JSON.stringify({ model: 'opus' }) + '\n');
  run(home, []);
  const r = run(home, ['--uninstall']);
  assert(r.status === 0, '--uninstall exits 0');
  const s = readSettings(home);
  assert(s !== null && s.statusLine === undefined, '--uninstall removes the statusLine');
  assert(s && s.model === 'opus', '--uninstall preserves unrelated settings');
}

// 5. The pre-Cogwait backup is a one-time snapshot — a second install must not
// clobber it with the already-modified file, or the original is unrecoverable.
{
  const home = newHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const original = JSON.stringify({ model: 'sonnet' }, null, 2) + '\n';
  fs.writeFileSync(settingsPath(home), original);
  run(home, []);
  const bak = settingsPath(home) + '.cogwait-bak';
  assert(fs.existsSync(bak), 'first install writes a backup');
  assert(fs.readFileSync(bak, 'utf8') === original, 'backup holds the pristine pre-Cogwait settings');
  run(home, []);
  assert(fs.readFileSync(bak, 'utf8') === original, 'second install does not clobber the backup');
}

// 6. --status works with nothing configured at all, and never prints the key.
{
  const home = newHome();
  const r = run(home, ['--status']);
  assert(r.status === 0, '--status exits 0 with an empty config');
  assert(/ad level/.test(r.stdout) && /give-back/.test(r.stdout), '--status prints level and give-back');
  assert(/not installed/.test(r.stdout), '--status reports the status line as not installed');
  assert(readSettings(home) === null, '--status changes nothing');

  const home2 = newHome();
  fs.mkdirSync(path.join(home2, '.cogwait'), { recursive: true });
  fs.writeFileSync(path.join(home2, '.cogwait', 'config.json'),
    JSON.stringify({ payout_id: 'pub-1', publisher_key: 'SUPER-SECRET-KEY', level: 3 }));
  const r2 = run(home2, ['--status']);
  assert(r2.status === 0, '--status exits 0 with a populated config');
  assert(!/SUPER-SECRET-KEY/.test(r2.stdout + r2.stderr), '--status never prints the publisher key');
  assert(/present \(hidden\)/.test(r2.stdout), '--status reports the key as present without showing it');
  assert(/Boosted/.test(r2.stdout), '--status reflects the configured ad level');
}

// 7. --earnings / --cashout refuse to act when unregistered (no network call).
{
  const home = newHome();
  const e = run(home, ['--earnings']);
  assert(e.status === 1 && /Not registered/.test(e.stderr), '--earnings refuses when unregistered');
  const c = run(home, ['--cashout']);
  assert(c.status === 1 && /Not registered/.test(c.stderr), '--cashout refuses when unregistered');
}

// 8. --cashout never moves money without confirmation: with a publisher key but
// no TTY and no --yes it must abort before any request.
{
  const home = newHome();
  fs.mkdirSync(path.join(home, '.cogwait'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cogwait', 'config.json'),
    JSON.stringify({ payout_id: 'pub-1', publisher_key: 'k' }));
  const r = run(home, ['--cashout'], { COGWAIT_API: 'http://127.0.0.1:1' });
  assert(r.status === 1, '--cashout exits non-zero when it cannot reach the backend');
  assert(/Cannot reach/.test(r.stderr), '--cashout reports the unreachable backend rather than paying out');
}

// 9. State-dir GC prunes stale per-session files and nothing else.
{
  const home = newHome();
  const dir = path.join(home, '.cogwait');
  fs.mkdirSync(dir, { recursive: true });
  const old = Date.now() - 72 * 60 * 60 * 1000;
  const write = (name, stale) => {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, '{}');
    if (stale) fs.utimesSync(fp, old / 1000, old / 1000);
  };
  write('ad-aaaaaaaaaaaaaaaa.json', true);
  write('imp-aaaaaaaaaaaaaaaa.stamp', true);
  write('wait-aaaaaaaaaaaaaaaa.start', true);
  write('wait-aaaaaaaaaaaaaaaa.end', true);
  write('ad-bbbbbbbbbbbbbbbb.json', false);
  write('config.json', true);
  write('oss-receipt.json', true);
  write('refresh.fail', true);

  const code = `const c=require(${JSON.stringify(path.join(ROOT, 'lib', 'client.js'))});process.stdout.write(String(c.gcState()));`;
  const r = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COGWAIT_DATA_DIR: path.join(home, 'data') })
  });
  const left = fs.readdirSync(dir);
  assert(r.stdout.trim() === '4', 'gc removes the 4 stale per-session files');
  assert(left.includes('config.json') && left.includes('oss-receipt.json') && left.includes('refresh.fail'),
    'gc never touches config.json, oss-receipt.json or refresh.fail');
  assert(left.includes('ad-bbbbbbbbbbbbbbbb.json'), 'gc keeps a fresh session cache');

  // Rate limit: a second immediate sweep must short-circuit on the stamp.
  write('ad-cccccccccccccccc.json', true);
  const r2 = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: home, USERPROFILE: home })
  });
  assert(r2.stdout.trim() === '0' && fs.existsSync(path.join(dir, 'ad-cccccccccccccccc.json')),
    'gc is rate-limited to one sweep per hour');
}

for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
