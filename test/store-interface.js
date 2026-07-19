'use strict';
// Guards against interface drift between the two store backends. The server code
// is uniform across them, so store-pg.js must export exactly the same data
// methods as store-json.js. Skips gracefully if the optional `pg` dep is absent.

const assert = require('assert');
const json = require('../server/store-json');

let pg;
try {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@localhost:5432/db';
  pg = require('../server/store-pg'); // constructs a Pool but does not connect
} catch (e) {
  console.log('Store interface test');
  console.log('  ~ skipped (pg not installed): ' + e.message.split('\n')[0]);
  process.exit(0);
}

console.log('Store interface parity test');

// json-only helpers that the pg backend legitimately doesn't have.
const JSON_ONLY = new Set(['flush', 'DB_PATH', 'DATA_DIR']);
const jsonIface = Object.keys(json).filter((k) => !JSON_ONLY.has(k)).sort();
const pgIface = Object.keys(pg).sort();

const missing = jsonIface.filter((k) => !pgIface.includes(k));
const extra = pgIface.filter((k) => !jsonIface.includes(k));

assert.strictEqual(missing.length, 0, `pg store is missing: ${missing.join(', ')}`);
assert.strictEqual(extra.length, 0, `pg store has extra exports: ${extra.join(', ')}`);
console.log(`  ✓ both backends export the same interface (${jsonIface.length} members)`);

for (const k of jsonIface) {
  if (typeof json[k] === 'function') {
    assert.strictEqual(typeof pg[k], 'function', `pg.${k} should be a function`);
  }
}
console.log('  ✓ member kinds match');
assert.strictEqual(json.backend, 'json');
assert.strictEqual(pg.backend, 'postgres');
console.log('  ✓ backend tags correct (json / postgres)');
console.log('PASS');
