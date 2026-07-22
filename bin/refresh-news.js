#!/usr/bin/env node
'use strict';
// Detached helper: fetches the latest AI-news headlines and updates the local
// cache so the statusline never blocks on the network. Spawned by
// lib/news.spawnNewsRefresh. The request is anonymous — see lib/news.js.
const news = require('../lib/news');
news.refreshNews(() => process.exit(0));
setTimeout(() => process.exit(0), 6000).unref(); // safety cap
