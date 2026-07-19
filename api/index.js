'use strict';
// Vercel serverless adapter — routes every request to the shared backend handler.
// The handler signature (req, res) is plain Node http, which Vercel Functions provide.
//
// PRODUCTION NOTE: serverless filesystems are ephemeral and each instance is
// isolated, so before deploying this you MUST:
//   1. Replace server/store.js with a Postgres-backed implementation (same interface).
//   2. Move the in-memory `rate` and `dedupe` maps in server/index.js to a shared
//      store (Redis/Postgres) — otherwise limits/dedupe only apply per instance.
// Set SPONSORIC_ADMIN_TOKEN, STRIPE_SECRET_KEY, etc. via `vercel env`.
module.exports = require('../server/index.js').handler;
