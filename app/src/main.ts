import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

// ---- types mirroring the Rust JSON ----
type State = {
  payout_id: string; has_key: boolean; level: number; disabled: boolean; mock: boolean;
  api: string; cli_path: string; installed: boolean; config_path: string; settings_path: string;
  chain: string; share: number;
};
type Level = { id: number; key: string; label: string; cpm: number; desc: string; per_impression: number; max_daily: number };
type LevelsInfo = { share: number; daily_cap: number; levels: Level[] };

// ---- Tauri bridge with a browser fallback so the UI runs (and can be previewed)
// outside the desktop shell. In Tauri, calls hit Rust; in a plain browser they
// resolve against realistic demo data. ----
const inTauri = typeof (window as any).__TAURI_INTERNALS__ !== "undefined" || typeof (window as any).__TAURI__ !== "undefined";

const demo: State = {
  payout_id: "demo-dev", has_key: true, level: 2, disabled: false, mock: false,
  api: "https://api.cogwait.io", cli_path: "/Users/you/cogwait/bin/statusline.js",
  installed: true, config_path: "~/.cogwait/config.json", settings_path: "~/.claude/settings.json",
  chain: "", share: 0.7,
};
// Demo cash-out method state for the browser-preview fallback (mirrors the
// server's /earnings + /payout/method shape: masked email, never the raw one).
const demoMethod = { payout_method: "stripe", paypal_email: "", stripe_linked: false };
function demoLevels(): LevelsInfo {
  const base = [
    { id: 0, key: "off", label: "Off", cpm: 0, desc: "No sponsor line. Nothing renders, nothing earns." },
    { id: 1, key: "minimal", label: "Minimal", cpm: 8, desc: "One dim, single-line note. The default — barely there." },
    { id: 2, key: "standard", label: "Standard", cpm: 18, desc: "A brighter line with an icon and a call-to-action." },
    { id: 3, key: "boosted", label: "Boosted", cpm: 35, desc: "A two-line boxed block. Prominent, higher-paid." },
    { id: 4, key: "banner", label: "Banner", cpm: 60, desc: "A full-width inverse-video banner bar — impossible to miss." },
    { id: 5, key: "takeover", label: "Takeover", cpm: 90, desc: "A bordered multi-line takeover with a blinking marker — the most intrusive tier." },
  ];
  return { share: 0.7, daily_cap: 500, levels: base.map((l) => ({ ...l, per_impression: Math.round((l.cpm / 1000) * 0.7 * 1e6) / 1e6, max_daily: Math.round((l.cpm / 1000) * 0.7 * 500 * 100) / 100 })) };
}
// Demo Fund-OSS state for the browser-preview fallback (mirrors the shape of
// `cogwait::oss_config()` / `run_oss_scan()` on the Rust side).
const demoOss = { donate_pct: 20, available: true, synced: true, funded_usd: 4.5, balance_usd: 7.4231 };
function demoReceipt() {
  return {
    generated: Date.now(), donate_pct: 20, source: "lockfile", scanned: 214, skipped: 3, truncated: false,
    totalUsd: 1.48, coverage: 0.18,
    maintainers: [
      { url: "https://github.com/sponsors/sindresorhus", name: "sindresorhus", pct: 42.1, usd: 0.62, packages: ["chalk", "execa", "globby"] },
      { url: "https://opencollective.com/debug", name: "debug", pct: 28.4, usd: 0.42, packages: ["debug"] },
      { url: "https://tidelift.com/funding/github/npm/lodash", name: "lodash", pct: 29.5, usd: 0.44, packages: ["lodash"] },
    ],
  };
}
async function mockInvoke(cmd: string, args?: any): Promise<any> {
  switch (cmd) {
    case "app_version": return "0.1.0";
    case "get_state": return { ...demo };
    case "get_levels": return demoLevels();
    case "save_config": Object.assign(demo, args?.patch || {}); return { ...demo };
    case "install_statusline": demo.installed = true; return { ...demo };
    case "uninstall_statusline": demo.installed = false; return { ...demo };
    case "doctor": return { checks: [
      { status: "ok", msg: "statusLine configured in settings.json" },
      { status: "ok", msg: "payout id set (demo-dev)" },
      { status: "ok", msg: "registered — publisher key present" },
      { status: demo.level === 0 ? "warn" : "ok", msg: demo.level === 0 ? "ad level 0 (Off) — nothing earns" : `ad level ${demo.level} active` },
    ] };
    case "get_earnings": return { balance_usd: 7.4231, impressions: 1326, min_payout_usd: 10,
      payout_method: demoMethod.payout_method, paypal_email: demoMethod.paypal_email, stripe_linked: demoMethod.stripe_linked,
      payouts: [{ ts: Date.now() - 86400000 * 9, amount_usd: 12.5, transfer: "tr_1OkD3x2eZvKYlo", simulated: false },
                { ts: Date.now() - 86400000 * 23, amount_usd: 10.0, transfer: "tr_1Nf9a2eZvKYlo", simulated: false }] };
    case "request_payout": return { ok: false, error: "below_minimum" };
    case "connect_onboard": return { url: "https://connect.stripe.com/setup/demo", simulated: true };
    case "set_payout_method": {
      const m = String(args?.method || "stripe");
      const email = String(args?.paypalEmail || args?.paypal_email || "").trim();
      if (m === "paypal") {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "invalid_paypal_email" };
        // mask like the server does: keep first char + domain
        const [u, host] = email.split("@");
        demoMethod.payout_method = "paypal";
        demoMethod.paypal_email = `${u[0]}***@${host}`;
        return { ok: true, payout_method: "paypal", paypal_email: demoMethod.paypal_email, paypal_email_set: true };
      }
      demoMethod.payout_method = "stripe";
      return { ok: true, payout_method: "stripe", paypal_email: demoMethod.paypal_email, paypal_email_set: !!demoMethod.paypal_email };
    }
    case "ad_preview": { const a = ADS[Math.floor(Date.now() / 20000) % ADS.length]; return { id: "house-demo", text: a.text, url: "https://" + a.url, campaign: false, cpm: 8 }; }
    case "get_oss_config": return { ...demoOss };
    case "set_donate_pct": demoOss.donate_pct = Math.max(0, Math.min(100, Number(args?.pct) || 0)); return { donate_pct: demoOss.donate_pct, synced: true };
    case "run_oss_scan": return demoReceipt();
    default: return {};
  }
}
const invoke: <T>(cmd: string, args?: any) => Promise<T> = inTauri ? (tauriInvoke as any) : (mockInvoke as any);
const openUrl = inTauri ? tauriOpenUrl : async (u: string) => { window.open(u, "_blank"); };

// ---- state ----
let S: State;
let L: LevelsInfo;
let tab = "home";
const view = () => document.getElementById("view")!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---- theme: explicit, app-owned, persisted. Light is the product's look; dark
// is an opt-in the user picks here, not something inherited from the OS. ----
type Theme = "light" | "dark";
function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  const sw = document.getElementById("theme");
  if (sw) {
    sw.setAttribute("data-active", t);
    sw.querySelectorAll<HTMLButtonElement>("button[data-set]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.set === t)));
  }
  try { localStorage.setItem("cogwait-theme", t); } catch (_) { /* private mode: session-only */ }
}
function initTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem("cogwait-theme"); } catch (_) {}
  applyTheme(saved === "dark" ? "dark" : "light");
  document.querySelectorAll<HTMLButtonElement>("#theme button[data-set]").forEach((b) =>
    b.addEventListener("click", () => applyTheme(b.dataset.set === "dark" ? "dark" : "light")));
}

async function boot() {
  if (document.hidden) document.documentElement.setAttribute("data-noanim", "");
  initTheme();
  L = await invoke<LevelsInfo>("get_levels");
  await refresh();
  document.querySelectorAll<HTMLButtonElement>("#tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      tab = b.dataset.tab!;
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      render();
    });
  });
  if (!inTauri) {
    const f = document.createElement("div");
    f.className = "demo-flag"; f.textContent = "browser preview · demo data";
    document.body.appendChild(f);
  }
  startLive();
}

async function refresh() { S = await invoke<State>("get_state"); updatePill(); render(); }

function updatePill() {
  const pill = document.getElementById("pill")!;
  const set = (cls: string, txt: string) => { pill.className = "pill " + cls; pill.innerHTML = `<span class="lp"></span>${txt}`; };
  if (S.disabled || S.level === 0) set("off", "Paused");
  else if (S.installed && (S.has_key || S.mock)) set("good", "Earning · L" + S.level);
  else if (S.installed) set("warn", "Set up needed");
  else set("warn", "Not installed");
}

function render() {
  if (tab === "home") return renderHome();
  if (tab === "earnings") return renderEarnings();
  if (tab === "level") return renderLevel();
  if (tab === "oss") return renderOss();
  if (tab === "setup") return renderSetup();
  if (tab === "about") return renderAbout();
}

// ---- the living terminal ----
const ADS = [
  { text: "Neon — serverless Postgres that scales to zero", url: "neon.tech" },
  { text: "Warp — the terminal, reimagined for AI devs", url: "warp.dev" },
  { text: "Sentry — see errors before your users do", url: "sentry.io" },
  { text: "Turso — SQLite for the edge, everywhere", url: "turso.tech" },
  { text: "Resend — email built for developers", url: "resend.com" },
];
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
let adIdx = 0, spinIdx = 0, lastSec = "";
// the real ad the backend is currently serving, once fetched (null until then)
let liveAd: { text: string; url: string } | null = null;

function sponsorInner(level: number, ad: { text: string; url: string }): string {
  const cur = `<span class="cursor"></span>`;
  if (level <= 0) return `<span class="spon-dim">— sponsor line off —</span>`;
  if (level >= 5)
    return `<div class="spon-box"><div class="spon-box-l"><span class="spon-blink spon-gold">●</span> <b>[sponsor]</b></div><div class="spon-box-l"><b>${esc(ad.text)}</b></div><div class="spon-box-l spon-yellow">▶ https://${esc(ad.url)} ›${cur}</div></div>`;
  if (level >= 4)
    return `<div><span class="spon-banner">★ [sponsor] ${esc(ad.text)}</span></div><div style="padding-left:96px" class="spon-yellow">▶ https://${esc(ad.url)} ›${cur}</div>`;
  if (level >= 3)
    return `<div><span class="spon-gold">◆ SPONSOR</span> <b>${esc(ad.text)}</b></div><div style="padding-left:96px" class="spon-yellow">https://${esc(ad.url)} ›${cur}</div>`;
  if (level >= 2)
    return `<span class="spon-yellow"><b>▸ [sponsor]</b></span> <span class="spon-cyan">${esc(ad.text)}</span> <span class="spon-yellow">›</span>${cur}`;
  return `<span class="spon-cyan">[sponsor]</span> <span class="spon-dim">${esc(ad.text)} ›</span>${cur}`;
}
// `live` marks the sponsor line as showing the real backend ad (Status tab); the
// canned rotation in startLive() skips live lines and a backend poll feeds them.
function termBlock(level: number, title = "claude-code — zsh", live = false): string {
  const seed = live && liveAd ? liveAd : ADS[adIdx];
  return `<div class="term"><div class="term-bar">
      <i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>
      <span class="ttl">${esc(title)}</span><span class="clock">--:--:--</span></div>
    <div class="term-body">
      <div class="prompt"><span class="caret">❯</span> claude "refactor the auth middleware"</div>
      <div class="spon-dim">· <span class="spinner">⠋</span> thinking… reading 12 files</div>
      <div class="divider"><div class="spon-line" data-level="${level}"${live ? ' data-live="1"' : ''}>${sponsorInner(level, seed)}</div></div>
    </div></div>`;
}
// Pull the real ad the network would serve and paint it into any live sponsor line.
// Honest labelling: green LIVE tag on success; dim EXAMPLE (with reason) otherwise.
// Skipped in mock mode — the user opted into local-only demo ads.
async function refreshLiveAd() {
  const lines = document.querySelectorAll<HTMLElement>('.spon-line[data-live]');
  if (!lines.length) return;
  const tag = document.getElementById("live-tag");
  const hint = document.getElementById("live-hint");
  if (S?.mock) {
    if (tag) { tag.textContent = "MOCK"; tag.className = "live-tag ex"; }
    if (hint) hint.textContent = "Mock mode — local demo ads, nothing fetched from the network.";
    return;
  }
  try {
    const ad = await invoke<any>("ad_preview");
    liveAd = { text: String(ad.text || ""), url: String(ad.url || "").replace(/^https?:\/\//, "") };
    lines.forEach((el) => (el.innerHTML = sponsorInner(Number(el.dataset.level), liveAd!)));
    if (!inTauri) {
      if (tag) { tag.textContent = "DEMO"; tag.className = "live-tag ex"; }
      if (hint) hint.textContent = "Browser preview — demo ad, not fetched from a live network.";
    } else {
      if (tag) { tag.textContent = "● LIVE"; tag.className = "live-tag live"; }
      if (hint) hint.textContent = ad.campaign
        ? "A paid advertiser's live placement — the real line the network is serving you now."
        : "House ad (no paid campaign has budget right now) — the real line the network is serving you now.";
    }
  } catch (e) {
    if (tag) { tag.textContent = "EXAMPLE"; tag.className = "live-tag ex"; }
    if (hint) hint.textContent = "Can't reach the network — showing an example. Check the API base in Setup.";
  }
}
function startLive() {
  // spinner + clock
  setInterval(() => {
    spinIdx = (spinIdx + 1) % SPIN.length;
    document.querySelectorAll<HTMLElement>(".spinner").forEach((el) => (el.textContent = SPIN[spinIdx]));
    const d = new Date();
    const s = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    if (s !== lastSec) { lastSec = s; document.querySelectorAll<HTMLElement>(".clock").forEach((el) => (el.textContent = s)); }
  }, 95);
  // canned rotation with a fade — for illustrative (non-live) preview lines only
  setInterval(() => {
    const lines = document.querySelectorAll<HTMLElement>(".spon-line:not([data-live])");
    if (!lines.length) return;
    lines.forEach((el) => el.classList.add("fade"));
    setTimeout(() => {
      adIdx = (adIdx + 1) % ADS.length;
      lines.forEach((el) => { el.innerHTML = sponsorInner(Number(el.dataset.level), ADS[adIdx]); el.classList.remove("fade"); });
    }, 350);
  }, 3900);
  // live lines track the backend (which rotates its fill on ~20s buckets)
  setInterval(refreshLiveAd, 20000);
}

// count a number element up to its target. The final value is guaranteed even if
// rAF is throttled (background tab) or motion is reduced — animation is a bonus.
function countUp(el: HTMLElement | null, target: number, decimals = 0, prefix = "") {
  if (!el) return;
  const final = prefix + target.toFixed(decimals);
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || document.hidden) { el.textContent = final; return; }
  const dur = 850, start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = t >= 1 ? final : prefix + (target * e).toFixed(decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => { el.textContent = final; }, dur + 120); // safety net
}

// ---- HOME / STATUS ----
async function renderHome() {
  const checks = await invoke<{ checks: { status: string; msg: string }[] }>("doctor");
  const rows = checks.checks.map((c) => `<div class="check"><span class="dot ${c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : "bad"}"></span>${esc(c.msg)}</div>`).join("");
  const lvl = L.levels[S.level] || L.levels[1];
  view().innerHTML = `
    <div class="view-head"><h2>Status</h2><p>The sponsor line renders in Claude Code's status row while your agent works. This app keeps it running — here it is, live.</p></div>
    <div class="card"><h3>Sponsor line — level ${S.level} · ${esc(lvl.label)} <span id="live-tag" class="live-tag">…</span></h3><div class="hint" id="live-hint">Fetching the ad the network is serving you…</div>${termBlock(S.level, "claude-code — zsh", true)}</div>
    <div class="card"><h3>Health</h3><div class="hint">The same checks as <code>npx cogwait --doctor</code>.</div>${rows}</div>
    <div class="card">
      <h3>${S.installed ? "Installed" : "Not installed"}</h3>
      <div class="hint">${S.installed ? "Wired into Claude Code. Restart it after changes." : "Adds the sponsor line to <code>~/.claude/settings.json</code> — non-destructive; your existing status line is preserved."}</div>
      ${S.installed ? (S.chain ? `<div class="hint">Chaining your existing status line — it renders first, the sponsor line below it.</div>` : "") : `<label class="chain-toggle"><input type="checkbox" id="chain" ${S.chain ? "checked" : ""}><span>Keep my existing status line — render the sponsor line below it (chain)</span></label>`}
      <div class="btn-row">
        ${S.installed ? `<button class="btn ghost" id="uninstall">Uninstall</button>` : `<button class="btn" id="install">Install status line</button>`}
        <button class="btn ghost" id="reveal-cli">Show CLI path</button>
      </div>
      <div class="msg" id="m"></div>
    </div>`;
  document.getElementById("install")?.addEventListener("click", () => act(
    "install_statusline",
    { cliPath: S.cli_path || null, chain: (document.getElementById("chain") as HTMLInputElement | null)?.checked || false },
    "Installed. Restart Claude Code."));
  document.getElementById("uninstall")?.addEventListener("click", () => {
    if (!confirm("Remove the Cogwait sponsor line from Claude Code?\n\nYour settings.json is restored and nothing renders or earns until you install again.")) return;
    act("uninstall_statusline", {}, "Removed the status line.");
  });
  document.getElementById("reveal-cli")?.addEventListener("click", () => msg("m", S.cli_path ? "CLI: " + S.cli_path : "No bin/statusline.js found — set the path in Setup.", "info"));
  refreshLiveAd();
}

// ---- EARNINGS ----
async function renderEarnings() {
  view().innerHTML = `
    <div class="view-head"><h2>Earnings</h2><p>Viewable-impression revenue for your publisher id. You keep ${Math.round(S.share * 100)}%.</p></div>
    <div class="stat-row">
      <div class="stat"><div class="k">Balance</div><div class="v gold skeleton" id="bal">$0.00</div></div>
      <div class="stat"><div class="k">Impressions</div><div class="v blue skeleton" id="imp">0</div></div>
      <div class="stat"><div class="k">Min payout</div><div class="v green skeleton" id="min">$—</div></div>
    </div>
    <div class="card">
      <div class="btn-row">
        <button class="btn ghost" id="reload">Refresh</button>
        <button class="btn" id="pay" disabled>Request payout</button>
        <button class="btn" id="onboard">Connect Stripe</button>
      </div>
      <div class="msg" id="m">${S.has_key || S.mock ? "Loading…" : "Register in Setup first to load earnings."}</div>
    </div>
    <div class="card hidden" id="method-card">
      <h3>Cash-out method</h3>
      <div class="hint">Where your cash-outs are sent. Minimum cash-out is <b id="method-min">$—</b>.</div>
      <div class="method-current" id="method-current" data-linked="no">—</div>
      <div class="method-grid">
        <div class="method-rail">
          <div class="rail-h">Bank account or card</div>
          <p class="note">Linked securely through Stripe — it verifies the account. Use <b>Connect Stripe</b> above to start.</p>
        </div>
        <div class="method-rail">
          <div class="rail-h">PayPal</div>
          <label class="field"><input type="text" id="paypal-email" inputmode="email" autocomplete="off" placeholder="you@example.com"></label>
          <button class="btn" id="paypal-save">Use PayPal</button>
        </div>
      </div>
      <div class="msg" id="method-msg"></div>
    </div>
    <div class="card"><h3>Payout history</h3>
      <table class="hist"><thead><tr><th>Date</th><th>Amount</th><th>Transfer</th></tr></thead><tbody id="hist"><tr><td colspan="3" class="note">—</td></tr></tbody></table>
    </div>`;
  document.getElementById("reload")?.addEventListener("click", loadEarnings);
  document.getElementById("pay")?.addEventListener("click", doPayout);
  document.getElementById("onboard")?.addEventListener("click", doOnboard);
  document.getElementById("paypal-save")?.addEventListener("click", setPaypal);
  // The shimmer is only honest while a request is actually in flight — with no
  // key there is nothing to wait for, so clear it immediately.
  if (S.has_key || S.mock) loadEarnings(); else clearSkeletons();
}
// Stat tiles render as shimmer placeholders until real numbers land.
function clearSkeletons() {
  document.querySelectorAll<HTMLElement>(".skeleton").forEach((el) => el.classList.remove("skeleton"));
}
// Last figures seen, so the cash-out confirmation can state the exact amount
// and split instead of asking the user to confirm an abstraction.
let lastEarnings = { balance_usd: 0, min_payout_usd: 0, donate_pct: 0 };
async function loadEarnings() {
  try {
    const d = await invoke<any>("get_earnings");
    clearSkeletons();
    lastEarnings = {
      balance_usd: Number(d.balance_usd) || 0,
      min_payout_usd: Number(d.min_payout_usd) || 0,
      donate_pct: Number(d.donate_pct !== undefined ? d.donate_pct : (ossState && ossState.donate_pct) || 0) || 0,
    };
    countUp(document.getElementById("bal"), d.balance_usd || 0, 4, "$");
    countUp(document.getElementById("imp"), d.impressions || 0, 0);
    (document.getElementById("min")!).textContent = "$" + (d.min_payout_usd ?? 0);
    const canPay = d.balance_usd > 0 && d.balance_usd >= (d.min_payout_usd || 0);
    const payBtn = document.getElementById("pay") as HTMLButtonElement;
    if (payBtn) payBtn.disabled = !canPay;
    renderHistory(d.payouts || []);
    renderMethod(d);
    msg("m", canPay ? "Eligible for payout." : `$${((d.min_payout_usd || 0) - (d.balance_usd || 0)).toFixed(2)} to go until payout.`, "info");
  } catch (e) { clearSkeletons(); msg("m", String(e), "err"); }
}
// Cash-out method card — graceful degradation if this backend predates §10:
// no `payout_method` field means the endpoint isn't there, so hide the card
// entirely (mirrors the web dashboard + the Fund-OSS panel's "unavailable" path).
function renderMethod(d: any) {
  const card = document.getElementById("method-card");
  if (!card) return;
  const available = d.payout_method !== undefined;
  card.classList.toggle("hidden", !available);
  if (!available) return;
  const min = document.getElementById("method-min");
  if (min) min.textContent = "$" + (d.min_payout_usd ?? 0);
  const method = d.payout_method === "paypal" ? "paypal" : "stripe";
  const cur = document.getElementById("method-current") as HTMLElement | null;
  if (cur) {
    if (method === "paypal" && d.paypal_email) {
      cur.textContent = `PayPal — ${d.paypal_email}`; cur.dataset.linked = "yes";
    } else if (method === "stripe" && d.stripe_linked) {
      cur.textContent = "Bank / card linked via Stripe"; cur.dataset.linked = "yes";
    } else {
      cur.textContent = "Not linked yet — choose a method below."; cur.dataset.linked = "no";
    }
  }
  // Show the masked address the server already holds as the input placeholder.
  const inp = document.getElementById("paypal-email") as HTMLInputElement | null;
  if (inp && d.paypal_email) inp.placeholder = d.paypal_email;
}
// Set PayPal as the cash-out rail. Client-side format check mirrors the CLI +
// server regex, so a fat-fingered address never leaves the app.
async function setPaypal() {
  const inp = document.getElementById("paypal-email") as HTMLInputElement | null;
  const email = (inp?.value || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg("method-msg", "Enter a valid PayPal email.", "err"); return; }
  const btn = document.getElementById("paypal-save") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  msg("method-msg", "Saving…", "info");
  try {
    const d = await invoke<any>("set_payout_method", { method: "paypal", paypalEmail: email });
    if (d.ok) {
      if (inp) inp.value = "";
      msg("method-msg", `PayPal set — cash-outs go to ${d.paypal_email || email}.`, "ok");
      loadEarnings();
    } else {
      msg("method-msg", d.error === "unavailable"
        ? "This backend doesn't support choosing a cash-out method yet."
        : "Could not save PayPal: " + (d.error || "unknown error"), "err");
    }
  } catch (e) { msg("method-msg", String(e), "err"); }
  finally { if (btn) btn.disabled = false; }
}
function renderHistory(payouts: any[]) {
  const tb = document.getElementById("hist")!;
  if (!payouts.length) { tb.innerHTML = `<tr><td colspan="3" class="note">No payouts yet — your first one lands here.</td></tr>`; return; }
  tb.innerHTML = payouts.map((p) => `<tr><td>${new Date(p.ts).toLocaleDateString()}</td><td>$${Number(p.amount_usd || 0).toFixed(2)}</td><td class="mono">${esc(String(p.transfer || ""))}${p.simulated ? " (sim)" : ""}</td></tr>`).join("");
}
async function doPayout() {
  // Real money, irreversible from here. Confirm the amount and the give-back
  // split before sending — the split is applied server-side at payout, so this
  // is the last moment the user can see what they are agreeing to.
  const bal = lastEarnings.balance_usd;
  const pct = lastEarnings.donate_pct;
  const give = bal * pct / 100;
  const lines = [`Cash out $${bal.toFixed(2)}?`, ""];
  if (pct > 0) {
    lines.push(`You receive: $${(bal - give).toFixed(2)}`);
    lines.push(`Give-back to open source (${pct}%): $${give.toFixed(2)}`);
    lines.push("");
  }
  lines.push("This is final — the transfer is sent as soon as you confirm.");
  if (!confirm(lines.join("\n"))) { msg("m", "Cash-out cancelled.", "info"); return; }
  const payBtn = document.getElementById("pay") as HTMLButtonElement | null;
  if (payBtn) payBtn.disabled = true;                 // no double-send in flight
  msg("m", "Requesting payout…", "info");
  try { const d = await invoke<any>("request_payout");
    msg("m", d.ok ? `Paid $${d.paid_usd.toFixed(2)}${d.simulated ? " (simulated)" : ""}` : "Payout: " + (d.error === "below_minimum" ? "balance is below the minimum." : d.error || ""), d.ok ? "ok" : "err");
    loadEarnings();                                     // re-derives the button state
  } catch (e) {
    msg("m", String(e), "err");
    const b = document.getElementById("pay") as HTMLButtonElement | null;
    if (b) b.disabled = false;                        // nothing sent — allow a retry
  }
}
async function doOnboard() {
  msg("m", "Opening Stripe onboarding…", "info");
  try { const d = await invoke<any>("connect_onboard");
    if (d.url) { await openUrl(d.url); msg("m", d.simulated ? "Simulated Stripe account connected." : "Opened onboarding in your browser.", "ok"); }
    else msg("m", "No onboarding URL returned.", "err");
  } catch (e) { msg("m", String(e), "err"); }
}

// ---- AD LEVEL ----
function renderLevel() {
  const cards = L.levels.map((lv) => `
    <div class="lvl ${lv.id === S.level ? "sel" : ""}" data-lvl="${lv.id}">
      <div class="id">Level ${lv.id}</div><div class="name">${esc(lv.label)}</div>
      <div class="cpm">${lv.cpm ? "$" + lv.cpm : "—"}</div>
      <div class="keep">${lv.cpm ? "keep $" + lv.per_impression.toFixed(4) + "/imp" : "no earnings"}</div>
    </div>`).join("");
  const lv = L.levels[S.level] || L.levels[1];
  view().innerHTML = `
    <div class="view-head"><h2>Ad level</h2><p>Trade prominence for pay. A more visible line earns a higher CPM — your call. Always opt-in, labeled, viewable-only.</p></div>
    <div class="levels">${cards}</div>
    <div class="card"><h3>Preview — ${esc(lv.label)}</h3><div class="hint">${esc(lv.desc)}</div>${termBlock(S.level, "claude-code — status line")}</div>
    <div class="card"><h3>What it can pay</h3>
      <div class="hint">Illustrative ceiling only — the server caps ${L.daily_cap} viewable impressions per session per day, and real earnings depend on advertiser demand.</div>
      <div class="stat-row">
        <div class="stat"><div class="k">Gross CPM</div><div class="v gold" id="s-cpm">$0</div></div>
        <div class="stat"><div class="k">You keep / imp</div><div class="v blue" id="s-keep">$0</div></div>
        <div class="stat"><div class="k">Max / session / day</div><div class="v green" id="s-max">$0</div></div>
      </div>
    </div>
    <div class="msg" id="m"></div>`;
  countUp(document.getElementById("s-cpm"), lv.cpm, 0, "$");
  countUp(document.getElementById("s-keep"), lv.per_impression, 4, "$");
  countUp(document.getElementById("s-max"), lv.max_daily, 2, "$");
  document.querySelectorAll<HTMLElement>(".lvl").forEach((el) =>
    el.addEventListener("click", async () => {
      const n = Number(el.dataset.lvl);
      if (n === S.level) return;
      S = await invoke<State>("save_config", { patch: { level: n } });
      updatePill(); renderLevel();
    }));
}

// ---- FUND OSS ----
let ossState: any = null;
async function renderOss() {
  view().innerHTML = `
    <div class="view-head"><h2>Fund OSS</h2><p>By default, a slice of your earnings funds the open source you build on. Dial it anywhere from 0–100% — 0 keeps everything.</p></div>
    <div class="card oss-hero" id="oss-status-card"><h3>Give-back</h3><div class="hint">Loading…</div></div>
    <div class="card"><h3>Local scan</h3>
      <div class="hint">Scans this project's <code>package-lock.json</code> / <code>node_modules</code> for maintainer <code>funding</code> fields. Nothing about your dependencies ever leaves this machine — only the resulting dollar total does.</div>
      <div class="btn-row"><button class="btn" id="scan">Run local scan</button></div>
      <div class="msg" id="scan-msg"></div>
    </div>
    <div class="card hidden" id="receipt-card"><h3>Maintainer receipt</h3>
      <div class="hint" id="receipt-hint"></div>
      <table class="receipt"><thead><tr><th>Maintainer</th><th>Share</th><th>$</th></tr></thead><tbody id="receipt-body"></tbody></table>
      <div class="note" style="margin-top:10px">Pooled fund, illustrative snapshot — not a per-maintainer payment guarantee.</div>
    </div>`;
  document.getElementById("scan")?.addEventListener("click", runScan);
  await loadOssConfig();
}

async function loadOssConfig() {
  const card = document.getElementById("oss-status-card")!;
  try {
    ossState = await invoke<any>("get_oss_config");
    if (!ossState.available) {
      card.innerHTML = `<h3>Give-back</h3>
        <div class="hint">Fund-OSS not available on this backend yet${ossState.synced === false && ossState.donate_pct !== undefined ? ` — showing your locally saved ${ossState.donate_pct}% until it syncs` : ""}.</div>`;
      return;
    }
    const pct = ossState.donate_pct;
    const bal = Number(ossState.balance_usd) || 0;
    card.innerHTML = `
      <h3>Give-back — <span id="donate-pct-label" class="mono">${pct}%</span></h3>
      <div class="stat-row">
        <div class="stat"><div class="k">Funded to date</div><div class="v gold" id="oss-funded">$${(Number(ossState.funded_usd) || 0).toFixed(2)}</div></div>
      </div>
      <div class="hint">Pooled fund, illustrative snapshot — not a per-maintainer payment guarantee.</div>
      <input type="range" id="donate-slider" min="0" max="100" step="1" value="${pct}">
      <div class="split-row">
        <div class="keep"><div class="lab">You keep</div><div class="amt" id="split-keep">$0.00</div></div>
        <div class="give"><div class="lab">You give</div><div class="amt" id="split-give">$0.00</div></div>
      </div>
      <div class="msg" id="donate-msg"></div>`;
    const renderSplit = (p: number) => {
      const give = bal * p / 100, keep = bal - give;
      document.getElementById("split-keep")!.textContent = "$" + keep.toFixed(2);
      document.getElementById("split-give")!.textContent = "$" + give.toFixed(2);
    };
    renderSplit(pct);
    const slider = document.getElementById("donate-slider") as HTMLInputElement;
    let debounce: any = null;
    slider.addEventListener("input", () => {
      const p = Number(slider.value);
      document.getElementById("donate-pct-label")!.textContent = p + "%";
      renderSplit(p);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const m = document.getElementById("donate-msg")!;
        m.textContent = "Saving…"; m.className = "msg info";
        try {
          const d = await invoke<any>("set_donate_pct", { pct: p });
          m.textContent = d.synced ? `Give-back set to ${d.donate_pct}%.` : (d.note || "Saved locally.");
          m.className = d.synced ? "msg ok" : "msg info";
        } catch (e) { m.textContent = String(e); m.className = "msg err"; }
      }, 400);
    });
  } catch (e) {
    card.innerHTML = `<h3>Give-back</h3><div class="hint">Fund-OSS not available on this backend yet.</div>`;
  }
}

async function runScan() {
  const m = document.getElementById("scan-msg")!;
  m.textContent = "Scanning…"; m.className = "msg info";
  try {
    const receipt = await invoke<any>("run_oss_scan");
    m.textContent = `Scanned ${receipt.scanned} packages (${receipt.source}) — ${Math.round((receipt.coverage || 0) * 100)}% declare a funding target.`;
    m.className = "msg ok";
    const card = document.getElementById("receipt-card")!;
    const body = document.getElementById("receipt-body")!;
    const maintainers = receipt.maintainers || [];
    body.innerHTML = maintainers.length
      ? maintainers.map((mm: any) => `<tr><td>${esc(mm.name || mm.url)}</td><td class="pct">${Number(mm.pct).toFixed(1)}%</td><td class="amt">$${Number(mm.usd).toFixed(2)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="note">No funding targets found among scanned dependencies.</td></tr>`;
    document.getElementById("receipt-hint")!.textContent = `Generated ${new Date(receipt.generated).toLocaleString()} — saved to ~/.cogwait/oss-receipt.json.`;
    card.classList.remove("hidden");
  } catch (e) { m.textContent = String(e); m.className = "msg err"; }
}

// ---- SETUP ----
function renderSetup() {
  view().innerHTML = `
    <div class="view-head"><h2>Setup</h2><p>Your payout identity, backend, and controls. The publisher key is stored owner-only in <code>~/.cogwait/config.json</code> and sent only to the API base below.</p></div>
    <div class="card"><h3>Payout identity</h3>
      <label class="field"><span class="lab">Payout id (your chosen publisher id)</span><input type="text" id="pid" value="${esc(S.payout_id)}" placeholder="your-id" autocomplete="off"></label>
      <label class="field"><span class="lab">API base</span><input type="text" id="api" value="${esc(S.api)}" placeholder="https://api.cogwait.io"></label>
      <div class="btn-row">
        <button class="btn ghost" id="save">Save</button>
        <button class="btn" id="register" ${S.has_key ? "disabled" : ""}>${S.has_key ? "Registered ✓" : "Register (get key)"}</button>
      </div>
      <div class="msg" id="m"></div>
    </div>
    <div class="card"><h3>Controls</h3>
      <div class="toggle"><div><div class="tlab">Pause ads</div><div class="tsub">Stops rendering + billing. Nothing earns while paused.</div></div>
        <label class="switch"><input type="checkbox" id="disabled" ${S.disabled ? "checked" : ""}><span class="slider"></span></label></div>
      <div class="toggle"><div><div class="tlab">Mock mode</div><div class="tsub">Local demo ads, nothing sent to any backend.</div></div>
        <label class="switch"><input type="checkbox" id="mock" ${S.mock ? "checked" : ""}><span class="slider"></span></label></div>
    </div>
    <div class="card"><h3>Cogwait CLI path</h3>
      <div class="hint">Path to <code>bin/statusline.js</code> the install button wires in. Auto-detected when the repo is nearby.</div>
      <label class="field"><input type="text" id="cli" value="${esc(S.cli_path)}" placeholder="/path/to/cogwait/bin/statusline.js"></label>
      <button class="btn ghost" id="savecli">Save path</button>
    </div>`;
  document.getElementById("save")?.addEventListener("click", async () => {
    const pid = (document.getElementById("pid") as HTMLInputElement).value.trim();
    const api = (document.getElementById("api") as HTMLInputElement).value.trim();
    S = await invoke<State>("save_config", { patch: { payout_id: pid, api } }); updatePill(); msg("m", "Saved.", "ok");
  });
  document.getElementById("register")?.addEventListener("click", async () => {
    msg("m", "Registering…", "info");
    const pid = (document.getElementById("pid") as HTMLInputElement).value.trim();
    const api = (document.getElementById("api") as HTMLInputElement).value.trim();
    await invoke("save_config", { patch: { payout_id: pid, api } });
    try { S = await invoke<State>("register"); updatePill(); msg("m", "Registered — key saved (0600).", "ok"); setTimeout(renderSetup, 700); }
    catch (e) { msg("m", String(e), "err"); }
  });
  document.getElementById("disabled")?.addEventListener("change", async (e) => {
    S = await invoke<State>("save_config", { patch: { disabled: (e.target as HTMLInputElement).checked } }); updatePill();
  });
  document.getElementById("mock")?.addEventListener("change", async (e) => {
    S = await invoke<State>("save_config", { patch: { mock: (e.target as HTMLInputElement).checked } }); updatePill();
  });
  document.getElementById("savecli")?.addEventListener("click", async () => {
    const cli = (document.getElementById("cli") as HTMLInputElement).value.trim();
    S = await invoke<State>("save_config", { patch: { cli_path: cli } }); render();
  });
}

// ---- ABOUT ----
async function renderAbout() {
  const ver = await invoke<string>("app_version").catch(() => "");
  view().innerHTML = `
    <div class="view-head"><h2>About</h2><p>Honest, opt-in sponsorship for the terminal.</p></div>
    <div class="card"><h3>How it works</h3>
      <p class="note" style="font-size:13px;line-height:1.75">Cogwait renders one labeled sponsor line in Claude Code's status row while your agent thinks, and shares ad revenue with you. It never reads your code, files, prompts, or environment — only an anonymized session tag, the ad id, and a timestamp ever leave your machine. An impression counts only when the line is actually rendered to a human.</p>
    </div>
    <div class="card"><h3>The honest part</h3>
      <p class="note" style="font-size:13px;line-height:1.75">Earnings are demand-gated: a real advertiser has to pay for the placement. The CPMs shown here are the tier rates, not a promise. Think coffee money, not a paycheck — and you can pause or uninstall in one click.</p>
    </div>
    <div class="card"><h3>Version &amp; updates</h3>
      <div class="about-meta">
        <div><span class="k">Version</span><span class="v mono" id="ver">${ver ? esc(ver) : "—"}</span></div>
        <div><span class="k">Support</span><a class="v" href="mailto:contactdharsan@gmail.com" id="support">contactdharsan@gmail.com</a></div>
      </div>
      <p class="note" style="margin-top:12px">Updates ship via GitHub once the repo is public.</p>
    </div>
    <div class="card"><h3>Links</h3>
      <div class="btn-row"><button class="btn ghost" id="repo">GitHub</button><button class="btn ghost" id="privacy">Privacy</button><button class="btn ghost" id="email">Email support</button></div>
    </div>`;
  document.getElementById("repo")?.addEventListener("click", () => openUrl("https://github.com/cognifer-labs/cogwait"));
  document.getElementById("privacy")?.addEventListener("click", () => openUrl("https://github.com/cognifer-labs/cogwait/blob/main/PRIVACY.md"));
  document.getElementById("email")?.addEventListener("click", () => openUrl("mailto:contactdharsan@gmail.com"));
}

// ---- helpers ----
async function act(cmd: string, args: any, okMsg: string) {
  try { S = await invoke<State>(cmd, args); updatePill(); renderHome(); msg("m", okMsg, "ok"); }
  catch (e) { msg("m", String(e), "err"); }
}
function msg(id: string, text: string, kind: "ok" | "err" | "info") {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.className = "msg " + kind; }
}

window.addEventListener("DOMContentLoaded", boot);
