#!/usr/bin/env node
'use strict';
// Optional wait-timing hook. UserPromptSubmit marks wait start; Stop marks wait end.
// This records only local timestamps to size how long the sponsor line was visible.
// It sends NOTHING containing prompt text or code — hook stdin is read but discarded
// except for the session id. Exit 0 always; never blocks or alters the turn.

const fs = require('fs');
const path = require('path');
const os = require('os');

const phase = process.argv[2] === 'start' ? 'start' : 'end';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let sessionId = 'anon';
  try { sessionId = (JSON.parse(input || '{}').session_id) || 'anon'; } catch (_) {}
  const crypto = require('crypto');
  const tag = crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16);
  const dir = path.join(os.homedir(), '.cogwait');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `wait-${tag}.${phase}`), String(Date.now()));
  } catch (_) {}
  process.exit(0);
});
// If no stdin arrives, still exit cleanly.
setTimeout(() => process.exit(0), 1500).unref();
