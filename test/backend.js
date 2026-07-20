#!/usr/bin/env node
'use strict';
// Backend test: campaigns, viewable-impression settlement, dedupe, and payout
// (Stripe simulated). Isolated temp data dir; no client involved — pure API.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cogwait-be-'));
const PORT = 8801;
const API = `http://localhost:${PORT}`;
const PUB = 'be-pub';
const ADMIN = 'test-admin';
const ROOT = path.resolve(__dirname, '..');

const env = Object.assign({}, process.env, {
  PORT: String(PORT), COGWAIT_DATA_DIR: DATA_DIR, COGWAIT_QUIET: '1',
  COGWAIT_ADMIN_TOKEN: ADMIN, COGWAIT_MIN_PAYOUT: '0.001', COGWAIT_CPM: '2', COGWAIT_SHARE: '0.7',
  COGWAIT_RATE_MAX: '1000',
  // Test-only hook (server/index.js): fails the donation leg exactly once per
  // idempotency key, so the partial-failure/idempotency test below is
  // deterministic without a real Stripe outage. Publisher PUB's donate_pct is
  // set to 0 above, so this never fires for PUB's plain-cashout flow.
  COGWAIT_TEST_FAIL_DONATE_ONCE: '1'
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
  console.log('Cogwait backend test');

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

    // An out-of-range client-declared level is clamped to MAX_LEVEL, never
    // trusted as-is. Derived from the level model so new tiers don't break this.
    const levelModel = require('../lib/levels');
    const maxLvl = levelModel.MAX_LEVEL;
    const maxPay = Math.round(levelModel.cpmForLevel(maxLvl) / 1000 * 0.7 * 1e4) / 1e4;
    const lHigh = await call('POST', '/impression',
      { session_tag: 'tagLhi', ad_id: campId, surface: 'statusline', level: 99, ts: Date.now() }, AUTH);
    assert(lHigh.json.level === maxLvl && lHigh.json.credited_usd === maxPay,
      `over-range level clamped to ${maxLvl} (got ${lHigh.json.level}, $${lHigh.json.credited_usd})`);

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
    // Publishers default to donate_pct 20 (Fund-OSS on by default). Set PUB to 0
    // here so this payout is a plain, single-leg cashout — the split itself is
    // covered in its own dedicated block below.
    const zeroDonate = await call('POST', '/donate/config', { donate_pct: 0 }, AUTH);
    assert(zeroDonate.code === 200 && zeroDonate.json.donate_pct === 0, 'donate_pct set to 0 for the plain-cashout flow');
    // Authenticated payout (Stripe simulated) zeroes the balance; body stripe_account is ignored.
    const pay = await call('POST', '/payout', { stripe_account: 'acct_ATTACKER' }, AUTH);
    assert(pay.code === 200 && pay.json.simulated === true && pay.json.paid_usd > 0 && pay.json.donated_usd === 0, `payout simulated $${pay.json.paid_usd}`);
    const earn2 = await call('GET', '/earnings', null, AUTH);
    assert(earn2.json.balance_usd === 0, 'balance zeroed after payout');
    assert(earn2.json.payouts.length === 1, 'payout recorded in ledger');
    assert(earn2.json.payouts[0].kind === 'cashout', 'plain payout row is kind cashout');

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

    // --- Fund-OSS: donate/config, split math, and two-leg payout idempotency ---
    {
      const ossReg = await call('POST', '/session/init', { publisher_id: 'oss-pub' });
      assert(ossReg.code === 200 && ossReg.json.secret, 'oss-pub registered');
      const OSS = { authorization: `Publisher oss-pub:${ossReg.json.secret}` };

      // New publishers default to donate_pct 20 (Fund-OSS on by default).
      const initialEarn = await call('GET', '/earnings', null, OSS);
      assert(initialEarn.json.donate_pct === 20, `new publisher defaults to donate_pct 20 (got ${initialEarn.json.donate_pct})`);

      // /donate/config requires auth and clamps out-of-range values server-side.
      const noauthCfg = await call('POST', '/donate/config', { donate_pct: 50 });
      assert(noauthCfg.code === 401, 'donate/config requires auth');
      const cfgHigh = await call('POST', '/donate/config', { donate_pct: 500 }, OSS);
      assert(cfgHigh.code === 200 && cfgHigh.json.donate_pct === 100, 'donate/config clamps > 100 down to 100');
      const cfgLow = await call('POST', '/donate/config', { donate_pct: -10 }, OSS);
      assert(cfgLow.code === 200 && cfgLow.json.donate_pct === 0, 'donate/config clamps < 0 up to 0');
      const cfg = await call('POST', '/donate/config', { donate_pct: 25 }, OSS);
      assert(cfg.code === 200 && cfg.json.donate_pct === 25, 'donate/config sets 25%');

      // Earn a balance: 5 impressions at level 3 ($35 CPM x 0.7 share = $0.0245 each).
      for (let i = 0; i < 5; i++) {
        await call('POST', '/impression',
          { session_tag: `oss-tag-${i}`, ad_id: campId, surface: 'statusline', level: 3, ts: Date.now() }, OSS);
      }
      const before = await call('GET', '/earnings', null, OSS);
      assert(before.json.donate_pct === 25, 'earnings reports donate_pct');
      assert(Array.isArray(before.json.donations) && before.json.donations.length === 0, 'no donations recorded yet');
      const balance = before.json.balance_usd;
      assert(balance > 0, `oss-pub accrued balance $${balance}`);
      const expectedDonate = Math.round(balance * 0.25 * 1e6) / 1e6;
      const expectedKeep = Math.round((balance - expectedDonate) * 1e6) / 1e6;

      // First /payout: the cashout leg settles, the donation leg is forced to
      // fail once (COGWAIT_TEST_FAIL_DONATE_ONCE). This must NOT zero the balance,
      // and must NOT re-transfer the (already-settled) cashout leg on retry.
      const payFail = await call('POST', '/payout', {}, OSS);
      assert(payFail.code === 502, 'payout with a forced donation failure returns 502');
      const afterFail = await call('GET', '/earnings', null, OSS);
      assert(afterFail.json.balance_usd === balance, 'balance NOT zeroed after a partial payout failure');
      assert(afterFail.json.payouts.length === 1 && afterFail.json.payouts[0].kind === 'cashout',
        'settled cashout leg is visible; the still-pending donation leg is hidden');
      assert(afterFail.json.donations.length === 0, 'donation leg not yet settled, not shown as a completed donation');

      // Retry: only the donation leg is attempted; no second cashout transfer is issued.
      const payRetry = await call('POST', '/payout', {}, OSS);
      assert(payRetry.code === 200, 'retry payout succeeds');
      assert(payRetry.json.paid_usd === 0, 'retry does not re-attempt the already-settled cashout leg (paid_usd 0 this call)');
      assert(Math.abs(payRetry.json.donated_usd - expectedDonate) < 1e-6, `retry settles only the donation leg ($${payRetry.json.donated_usd})`);
      assert(payRetry.json.simulated === true, 'donation leg simulates without COGWAIT_FUND_ACCOUNT');

      const afterRetry = await call('GET', '/earnings', null, OSS);
      assert(afterRetry.json.balance_usd === 0, 'balance zeroed once every leg is settled');
      const cashoutRows = afterRetry.json.payouts.filter((r) => r.kind === 'cashout');
      const donationRows = afterRetry.json.payouts.filter((r) => r.kind === 'donation');
      assert(cashoutRows.length === 1, `exactly one cashout row ever recorded — no double cashout (got ${cashoutRows.length})`);
      assert(donationRows.length === 1 && donationRows[0].fund, 'exactly one donation row recorded, with fund set');
      assert(Math.abs((cashoutRows[0].amount_usd + donationRows[0].amount_usd) - balance) < 1e-6,
        'split math: cashout + donation == original balance');
      assert(afterRetry.json.donations.length === 1, '/earnings donations subset reflects the settled donation');
    }

    // --- Concurrent double-payout regression (HIGH money-safety fix) ---
    // Fires several /payout requests for the same publisher as concurrently as
    // this harness allows. The JSON store has no real DB round trip between
    // "check pending" and "insert" (single-instance, synchronous under the
    // hood), so this run mainly guards the behavioral contract of the atomic
    // claim/settle methods (claimPayoutBatch / settlePayoutLeg) rather than
    // exercising the actual race window — the real race-closing proof (a row
    // lock across separate DB round trips) only means something against
    // Postgres, covered by the opportunistic block further below.
    {
      const racePid = 'race-pub-json';
      const raceReg = await call('POST', '/session/init', { publisher_id: racePid });
      assert(raceReg.code === 200 && raceReg.json.secret, 'race-pub-json registered');
      const RACE = { authorization: `Publisher ${racePid}:${raceReg.json.secret}` };
      await call('POST', '/donate/config', { donate_pct: 30 }, RACE);
      for (let i = 0; i < 10; i++) {
        await call('POST', '/impression',
          { session_tag: `race-tag-${i}`, ad_id: campId, surface: 'statusline', level: 3, ts: Date.now() }, RACE);
      }
      const raceBefore = await call('GET', '/earnings', null, RACE);
      const raceBalance = raceBefore.json.balance_usd;
      assert(raceBalance > 0, `race-pub-json accrued balance $${raceBalance}`);

      const N = 6;
      const raceResults = await Promise.all(Array.from({ length: N }, () => call('POST', '/payout', {}, RACE)));
      assert(raceResults.some((r) => r.code === 200), 'at least one concurrent /payout call succeeds');

      const raceAfter = await call('GET', '/earnings', null, RACE);
      const raceCashout = raceAfter.json.payouts.filter((r) => r.kind === 'cashout');
      const raceDonation = raceAfter.json.payouts.filter((r) => r.kind === 'donation');
      assert(raceCashout.length === 1, `${N} concurrent /payout calls yield exactly one cashout row (got ${raceCashout.length})`);
      assert(raceDonation.length === 1, `${N} concurrent /payout calls yield exactly one donation row (got ${raceDonation.length})`);
      // Sum across ALL rows (not just index 0) — if a duplicate batch slipped
      // through, this still catches the amount mismatch even when the row-count
      // assertions above were (incorrectly) satisfied.
      const raceTotal = raceCashout.reduce((s, r) => s + r.amount_usd, 0) + raceDonation.reduce((s, r) => s + r.amount_usd, 0);
      assert(Math.abs(raceTotal - raceBalance) < 1e-6,
        `no double-pay: settled total $${raceTotal} matches original balance $${raceBalance}`);
      assert(raceAfter.json.balance_usd === 0, 'balance zeroed exactly once after concurrent payout calls');
    }

    // --- Same regression against a REAL Postgres backend (opt-in) ---
    // This is the actual bug: two separate DB round trips (check pending, then
    // insert) with a real network gap between them, which is where the fix
    // (store.claimPayoutBatch / settlePayoutLeg row-locking under
    // SELECT ... FOR UPDATE) does its real work. Only runs when
    // COGWAIT_TEST_DATABASE_URL points at a reachable, disposable Postgres
    // database (e.g. `createdb cogwait_test` locally, or a CI service
    // container) — skips gracefully otherwise so `npm test` stays green
    // without a Postgres install.
    await (async () => {
      const pgUrl = process.env.COGWAIT_TEST_DATABASE_URL;
      if (!pgUrl) { console.log('  ~ skipped: Postgres concurrent-payout regression (COGWAIT_TEST_DATABASE_URL not set)'); return; }
      let Pool;
      try { ({ Pool } = require('pg')); }
      catch (e) { console.log('  ~ skipped: Postgres concurrent-payout regression (pg not installed)'); return; }
      const probe = new Pool({ connectionString: pgUrl, max: 1 });
      try {
        await probe.query('SELECT 1');
      } catch (e) {
        console.log(`  ~ skipped: Postgres concurrent-payout regression (cannot reach ${pgUrl}: ${e.message})`);
        await probe.end().catch(() => {});
        return;
      }
      // Clean schema so this run's row-count assertions aren't polluted by a previous run.
      await probe.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
      await probe.end();

      const PG_PORT = 8802;
      const pgEnv = Object.assign({}, process.env, {
        PORT: String(PG_PORT), DATABASE_URL: pgUrl, COGWAIT_QUIET: '1',
        COGWAIT_ADMIN_TOKEN: ADMIN, COGWAIT_MIN_PAYOUT: '0.001', COGWAIT_CPM: '2', COGWAIT_SHARE: '0.7',
        COGWAIT_RATE_MAX: '10000', COGWAIT_TEST_FAIL_DONATE_ONCE: ''
      });
      const pgServer = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: pgEnv, stdio: 'ignore' });
      await sleep(800);
      const pgAPI = `http://localhost:${PG_PORT}`;
      const pgCall = (method, p, body, headers) => new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request(`${pgAPI}${p}`, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
          let d = ''; res.on('data', (c) => d += c);
          res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (_) {} resolve({ code: res.statusCode, json: j }); });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
      });
      try {
        const reg = await pgCall('POST', '/session/init', { publisher_id: 'race-pub-pg' });
        const AUTH = { authorization: `Publisher race-pub-pg:${reg.json.secret}` };
        await pgCall('POST', '/donate/config', { donate_pct: 30 }, AUTH);
        for (let i = 0; i < 10; i++) {
          await pgCall('POST', '/impression',
            { session_tag: `pg-race-${i}`, ad_id: 'x', surface: 'statusline', level: 3, ts: Date.now() }, AUTH);
        }
        const before = await pgCall('GET', '/earnings', null, AUTH);
        const balance = before.json.balance_usd;
        // N=50: empirically the smallest count that reproduces the pre-fix race
        // reliably (10/10 local trials) against a real Postgres backend — the
        // window this closes (last-leg-settled-but-balance-not-yet-zeroed) is
        // narrow because simulated Stripe calls and localhost round trips are
        // both fast, so fewer concurrent calls miss it more often than not.
        const N = 50;
        await Promise.all(Array.from({ length: N }, () => pgCall('POST', '/payout', {}, AUTH)));
        const after = await pgCall('GET', '/earnings', null, AUTH);
        const cashout = after.json.payouts.filter((r) => r.kind === 'cashout');
        const donation = after.json.payouts.filter((r) => r.kind === 'donation');
        assert(cashout.length === 1, `[pg] ${N} concurrent /payout calls yield exactly one cashout row (got ${cashout.length})`);
        assert(donation.length === 1, `[pg] ${N} concurrent /payout calls yield exactly one donation row (got ${donation.length})`);
        const total = cashout.reduce((s, r) => s + r.amount_usd, 0) + donation.reduce((s, r) => s + r.amount_usd, 0);
        assert(Math.abs(total - balance) < 1e-6, `[pg] no double-pay against real Postgres: settled $${total} == balance $${balance}`);
      } finally {
        pgServer.kill();
      }
    })();

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
