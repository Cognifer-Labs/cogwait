#!/usr/bin/env node
'use strict';
// Backend test: campaigns, viewable-impression settlement, dedupe, and payout
// (Stripe simulated). Isolated temp data dir; no client involved — pure API.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsoric-be-'));
const PORT = 8801;
const API = `http://localhost:${PORT}`;
const PUB = 'be-pub';
const ADMIN = 'test-admin';
const ROOT = path.resolve(__dirname, '..');

const env = Object.assign({}, process.env, {
  PORT: String(PORT), SPONSORIC_DATA_DIR: DATA_DIR, SPONSORIC_QUIET: '1',
  SPONSORIC_ADMIN_TOKEN: ADMIN, SPONSORIC_MIN_PAYOUT: '0.001', SPONSORIC_CPM: '2', SPONSORIC_SHARE: '0.7',
  SPONSORIC_RATE_MAX: '1000'
});

function call(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${API}${p}`, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (_) {} resolve({ code: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let failed = 0;
  const assert = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) failed++; };
  console.log('Sponsoric backend test');

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, stdio: 'ignore' });
  await sleep(600);
  try {
    // Campaign requires admin token.
    const noauth = await call('POST', '/campaign', { text: 'x', budget_usd: 5 });
    assert(noauth.code === 403, 'campaign creation rejected without admin token');

    const camp = await call('POST', '/campaign',
      { text: 'Acme CI — ship faster', url: 'https://acme.dev', budget_usd: 100, cpm_usd: 5, status: 'approved' },
      { 'x-admin-token': ADMIN });
    assert(camp.code === 200 && camp.json.campaign.id, 'approved campaign created');
    const campId = camp.json.campaign.id;

    // Ad serving now prefers the campaign.
    const ad = await call('GET', `/ad/next?tag=abc`);
    assert(ad.json.id === campId, 'campaign ad served over house ad');

    // Register the publisher to get a secret; all publisher calls must authenticate.
    const reg = await call('POST', '/session/init', { publisher_id: PUB });
    assert(reg.code === 200 && reg.json.secret, 'publisher registered, secret issued');
    const AUTH = { authorization: `Publisher ${PUB}:${reg.json.secret}` };

    // Unauthenticated impression is rejected.
    const noauthImp = await call('POST', '/impression',
      { session_tag: 'tagZ', ad_id: campId, surface: 'statusline' });
    assert(noauthImp.code === 401, 'impression without auth rejected');

    // Authenticated impression settles.
    const imp = await call('POST', '/impression',
      { session_tag: 'tagX', ad_id: campId, surface: 'statusline', ts: Date.now() }, AUTH);
    assert(imp.code === 200 && imp.json.credited_usd > 0, `impression credited $${imp.json.credited_usd}`);

    // Immediate duplicate is deduped (not billed).
    const dup = await call('POST', '/impression',
      { session_tag: 'tagX', ad_id: campId, surface: 'statusline', ts: Date.now() }, AUTH);
    assert(dup.json.deduped === true && dup.json.credited_usd === 0, 'duplicate impression deduped');

    // Higher ad level pays a higher CPM. Level 3 ($35 CPM × 0.7 share) = $0.0245.
    const l3 = await call('POST', '/impression',
      { session_tag: 'tagL3', ad_id: campId, surface: 'statusline', level: 3, ts: Date.now() }, AUTH);
    assert(l3.json.credited_usd === 0.0245 && l3.json.level === 3,
      `level 3 impression credited $${l3.json.credited_usd} at tier ${l3.json.level}`);

    // An out-of-range client-declared level is clamped, never trusted as-is (caps at level 3).
    const lHigh = await call('POST', '/impression',
      { session_tag: 'tagLhi', ad_id: campId, surface: 'statusline', level: 99, ts: Date.now() }, AUTH);
    assert(lHigh.json.level === 3 && lHigh.json.credited_usd === 0.0245,
      `over-range level clamped to 3 (got ${lHigh.json.level})`);

    // Wrong surface rejected.
    const bad = await call('POST', '/impression',
      { session_tag: 'tagY', ad_id: campId, surface: 'popup' }, AUTH);
    assert(bad.code === 422, 'non-statusline surface rejected');

    // A body-supplied publisher_id cannot redirect the credit — auth identity wins.
    const spoof = await call('POST', '/impression',
      { publisher_id: 'victim', session_tag: 'tagS', ad_id: campId, surface: 'statusline' }, AUTH);
    assert(spoof.code === 200, 'body publisher_id ignored, credited to authed publisher');
    const victim = await call('POST', '/session/init', { publisher_id: 'victim' });
    const victimEarn = await call('GET', '/earnings', null, { authorization: `Publisher victim:${victim.json.secret}` });
    assert(victimEarn.json.impressions === 0, 'spoofed publisher received no credit');

    // Earnings require auth and are scoped to the caller; query param cannot enumerate others.
    const noauthEarn = await call('GET', `/earnings?publisher_id=${PUB}`);
    assert(noauthEarn.code === 401, 'earnings without auth rejected (no enumeration)');
    const earn = await call('GET', `/earnings?publisher_id=victim`, null, AUTH);
    assert(earn.json.publisher_id === PUB && earn.json.impressions === 4, 'earnings scoped to authed publisher, query param ignored');

    // Payout requires auth; unauthenticated is rejected.
    const noauthPay = await call('POST', '/payout', {});
    assert(noauthPay.code === 401, 'payout without auth rejected');
    // Authenticated payout (Stripe simulated) zeroes the balance; body stripe_account is ignored.
    const pay = await call('POST', '/payout', { stripe_account: 'acct_ATTACKER' }, AUTH);
    assert(pay.code === 200 && pay.json.simulated === true && pay.json.paid_usd > 0, `payout simulated $${pay.json.paid_usd}`);
    const earn2 = await call('GET', '/earnings', null, AUTH);
    assert(earn2.json.balance_usd === 0, 'balance zeroed after payout');
    assert(earn2.json.payouts.length === 1, 'payout recorded in ledger');

    // Connect onboarding (simulated) links a connected account.
    const reg2 = await call('POST', '/session/init', { publisher_id: 'be-pub2' });
    const AUTH2 = { authorization: `Publisher be-pub2:${reg2.json.secret}` };
    const onb = await call('POST', '/connect/onboard', {}, AUTH2);
    assert(onb.code === 200 && onb.json.simulated === true && /^acct_sim_/.test(onb.json.account), 'connect onboarding returns a simulated account + url');
    const noauthOnb = await call('POST', '/connect/onboard', {});
    assert(noauthOnb.code === 401, 'onboarding requires auth');

    // Advertiser stats require admin and report spend.
    const noAdminStats = await call('GET', '/campaign/stats');
    assert(noAdminStats.code === 403, 'campaign stats require admin token');
    const stats = await call('GET', '/campaign/stats', null, { 'x-admin-token': ADMIN });
    const camp0 = stats.json.campaigns.find(c => c.id === campId);
    assert(camp0 && camp0.spent_usd > 0, `campaign stats report spend ($${camp0 && camp0.spent_usd})`);

    // Persistence: db.json exists on disk (write is debounced ~50ms).
    await sleep(150);
    assert(fs.existsSync(path.join(DATA_DIR, 'db.json')), 'store persisted to disk');
  } catch (e) {
    console.log('  ✗ error:', e.message); failed++;
  } finally {
    server.kill();
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  }
  console.log(failed === 0 ? 'PASS' : `FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
