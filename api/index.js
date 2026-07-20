'use strict';
// Vercel serverless adapter — routes every request to the shared backend handler.
// The handler signature (req, res) is plain Node http, which Vercel Functions provide.
//
// PRODUCTION NOTE: serverless filesystems are ephemeral and each instance is
// isolated. Set DATABASE_URL and the store selector uses Postgres (store-pg.js)
// automatically — impression dedupe and the daily cap are then atomic across
// instances. The only remaining per-instance state is the soft rate limiter
// (server/index.js `rate` map); move it to Redis if you need a hard global limit.
// Set COGWAIT_ADMIN_TOKEN, DATABASE_URL, STRIPE_SECRET_KEY, etc. via `vercel env`.
module.exports = require('../server/index.js').handler;
