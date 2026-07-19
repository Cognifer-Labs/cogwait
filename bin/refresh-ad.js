#!/usr/bin/env node
'use strict';
// Detached helper: fetches the next ad and updates the local cache so the
// statusline never blocks on the network. Spawned by lib/client.spawnRefresh.
const client = require('../lib/client');
const sessionId = process.env.SPONSORIC_SESSION || 'anon';
client.refreshAd(sessionId, () => process.exit(0));
setTimeout(() => process.exit(0), 4000).unref(); // safety cap
