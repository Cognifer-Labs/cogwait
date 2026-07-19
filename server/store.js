'use strict';
// Store selector: Postgres when DATABASE_URL is set (multi-instance / serverless
// safe), otherwise the file-backed JSON store (single-node self-host / local).
// Both expose the same async interface — see store-json.js / store-pg.js.
module.exports = process.env.DATABASE_URL ? require('./store-pg') : require('./store-json');
