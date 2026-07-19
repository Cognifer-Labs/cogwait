import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

// ---- types mirroring the Rust JSON ----
type State = {
  payout_id: string; has_key: boolean; level: number; disabled: boolean; mock: boolean;
  api: string; cli_path: string; installed: boolean; config_path: string; settings_path: string; share: number;
};
type Level = { id: number; key: string; label: string; cpm: number; desc: string; per_impression: number; max_daily: number };
type LevelsInfo = { share: number; daily_cap: number; levels: Level[] };

// ---- Tauri bridge with a browser fallback so the UI runs (and can be previewed)
// outside the desktop shell. In Tauri, calls hit Rust; in a plain browser they
// resolve against realistic demo data. ----
const inTauri = typeof (window as any).__TAURI_INTERNALS__ !== "undefined" || typeof (window as any).__TAURI__ !== "undefined";

const demo: State = {
  payout_id: "demo-dev", has_key: true, level: 2, disabled: false, mock: false,
  api: "https://api.sponsoric.io", cli_path: "/Users/you/sponsoric/bin/statusline.js",
  installed: true, config_path: "~/.sponsoric/config.json", settings_path: "~/.claude/settings.json", share: 0.7,
};
function demoLevels(): LevelsInfo {
  const base = [
    { id: 0, key: "off", label: "Off", cpm: 0, desc: "No sponsor line. Nothing renders, nothing earns." },
    { id: 1, key: "minimal", label: "Minimal", cpm: 8, desc: "One dim, single-line note. The default — barely there." },
    { id: 2, key: "standard", label: "Standard", cpm: 18, desc: "A brighter line with an icon and a call-to-action." },
    { id: 3, key: "boosted", label: "Boosted", cpm: 35, desc: "A two-line boxed block. The most prominent tier." },
  ];
  return { share: 0.7, daily_cap: 500, levels: base.map((l) => ({ ...l, per_impression: Math.round((l.cpm / 1000) * 0.7 * 1e6) / 1e6, max_daily: Math.round((l.cpm / 1000) * 0.7 * 500 * 100) / 100 })) };
}
async function mockInvoke(cmd: string, args?: any): Promise<any> {
  switch (cmd) {
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
      payouts: [{ ts: Date.now() - 86400000 * 9, amount_usd: 12.5, transfer: "tr_1OkD3x2eZvKYlo", simulated: false },
                { ts: Date.now() - 86400000 * 23, amount_usd: 10.0, transfer: "tr_1Nf9a2eZvKYlo", simulated: false }] };
    case "request_payout": return { ok: false, error: "below_minimum" };
    case "connect_onboard": return { url: "https://connect.stripe.com/setup/demo", simulated: true };
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

async function boot() {
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

function sponsorInner(level: number, ad: { text: string; url: string }): string {
  const cur = `<span class="cursor"></span>`;
  if (level <= 0) return `<span class="spon-dim">— sponsor line off —</span>`;
  if (level >= 3)
    return `<div><span class="spon-mag">◆ SPONSOR</span> <b>${esc(ad.text)}</b></div><div style="padding-left:96px" class="spon-yellow">https://${esc(ad.url)} ›${cur}</div>`;
  if (level >= 2)
    return `<span class="spon-yellow"><b>▸ [sponsor]</b></span> <span class="spon-cyan">${esc(ad.text)}</span> <span class="spon-yellow">›</span>${cur}`;
  return `<span class="spon-cyan">[sponsor]</span> <span class="spon-dim">${esc(ad.text)} ›</span>${cur}`;
}
function termBlock(level: number, title = "claude-code — zsh"): string {
  return `<div class="term"><div class="term-bar">
      <i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>
      <span class="ttl">${esc(title)}</span><span class="clock">--:--:--</span></div>
    <div class="term-body">
      <div class="prompt"><span class="caret">❯</span> claude "refactor the auth middleware"</div>
      <div class="spon-dim">· <span class="spinner">⠋</span> thinking… reading 12 files</div>
      <div class="divider"><div class="spon-line" data-level="${level}">${sponsorInner(level, ADS[adIdx])}</div></div>
    </div></div>`;
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
  // ad rotation with a fade
  setInterval(() => {
    const lines = document.querySelectorAll<HTMLElement>(".spon-line");
    if (!lines.length) return;
    lines.forEach((el) => el.classList.add("fade"));
    setTimeout(() => {
      adIdx = (adIdx + 1) % ADS.length;
      lines.forEach((el) => { el.innerHTML = sponsorInner(Number(el.dataset.level), ADS[adIdx]); el.classList.remove("fade"); });
    }, 350);
  }, 3900);
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
    <div class="card"><h3>Live sponsor line — level ${S.level} · ${esc(lvl.label)}</h3><div class="hint">Exactly what a human sees while the model thinks.</div>${termBlock(S.level)}</div>
    <div class="card"><h3>Health</h3><div class="hint">The same checks as <code>npx sponsoric --doctor</code>.</div>${rows}</div>
    <div class="card">
      <h3>${S.installed ? "Installed" : "Not installed"}</h3>
      <div class="hint">${S.installed ? "Wired into Claude Code. Restart it after changes." : "Adds the sponsor line to <code>~/.claude/settings.json</code> — non-destructive; your existing status line is preserved."}</div>
      <div class="btn-row">
        ${S.installed ? `<button class="btn ghost" id="uninstall">Uninstall</button>` : `<button class="btn" id="install">Install status line</button>`}
        <button class="btn ghost" id="reveal-cli">Show CLI path</button>
      </div>
      <div class="msg" id="m"></div>
    </div>`;
  document.getElementById("install")?.addEventListener("click", () => act("install_statusline", { cliPath: S.cli_path || null }, "Installed. Restart Claude Code."));
  document.getElementById("uninstall")?.addEventListener("click", () => act("uninstall_statusline", {}, "Removed the status line."));
  document.getElementById("reveal-cli")?.addEventListener("click", () => msg("m", S.cli_path ? "CLI: " + S.cli_path : "No bin/statusline.js found — set the path in Setup.", "info"));
}

// ---- EARNINGS ----
async function renderEarnings() {
  view().innerHTML = `
    <div class="view-head"><h2>Earnings</h2><p>Viewable-impression revenue for your publisher id. You keep ${Math.round(S.share * 100)}%.</p></div>
    <div class="stat-row">
      <div class="stat"><div class="k">Balance</div><div class="v green" id="bal">$0.00</div></div>
      <div class="stat"><div class="k">Impressions</div><div class="v" id="imp">0</div></div>
      <div class="stat"><div class="k">Min payout</div><div class="v cyan" id="min">$—</div></div>
    </div>
    <div class="card">
      <div class="btn-row">
        <button class="btn ghost" id="reload">Refresh</button>
        <button class="btn" id="pay" disabled>Request payout</button>
        <button class="btn cyan" id="onboard">Connect Stripe</button>
      </div>
      <div class="msg" id="m">${S.has_key || S.mock ? "Loading…" : "Register in Setup first to load earnings."}</div>
    </div>
    <div class="card"><h3>Payout history</h3>
      <table class="hist"><thead><tr><th>Date</th><th>Amount</th><th>Transfer</th></tr></thead><tbody id="hist"><tr><td colspan="3" class="note">—</td></tr></tbody></table>
    </div>`;
  document.getElementById("reload")?.addEventListener("click", loadEarnings);
  document.getElementById("pay")?.addEventListener("click", doPayout);
  document.getElementById("onboard")?.addEventListener("click", doOnboard);
  if (S.has_key || S.mock) loadEarnings();
}
async function loadEarnings() {
  try {
    const d = await invoke<any>("get_earnings");
    countUp(document.getElementById("bal"), d.balance_usd || 0, 4, "$");
    countUp(document.getElementById("imp"), d.impressions || 0, 0);
    (document.getElementById("min")!).textContent = "$" + (d.min_payout_usd ?? 0);
    const canPay = d.balance_usd > 0 && d.balance_usd >= (d.min_payout_usd || 0);
    const payBtn = document.getElementById("pay") as HTMLButtonElement;
    if (payBtn) payBtn.disabled = !canPay;
    renderHistory(d.payouts || []);
    msg("m", canPay ? "Eligible for payout." : `$${((d.min_payout_usd || 0) - (d.balance_usd || 0)).toFixed(2)} to go until payout.`, "info");
  } catch (e) { msg("m", String(e), "err"); }
}
function renderHistory(payouts: any[]) {
  const tb = document.getElementById("hist")!;
  if (!payouts.length) { tb.innerHTML = `<tr><td colspan="3" class="note">No payouts yet — your first one lands here.</td></tr>`; return; }
  tb.innerHTML = payouts.map((p) => `<tr><td>${new Date(p.ts).toLocaleDateString()}</td><td>$${Number(p.amount_usd || 0).toFixed(2)}</td><td class="mono">${esc(String(p.transfer || ""))}${p.simulated ? " (sim)" : ""}</td></tr>`).join("");
}
async function doPayout() {
  msg("m", "Requesting payout…", "info");
  try { const d = await invoke<any>("request_payout");
    msg("m", d.ok ? `Paid $${d.paid_usd.toFixed(2)}${d.simulated ? " (simulated)" : ""}` : "Payout: " + (d.error === "below_minimum" ? "balance is below the minimum." : d.error || ""), d.ok ? "ok" : "err");
    loadEarnings();
  } catch (e) { msg("m", String(e), "err"); }
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
        <div class="stat"><div class="k">Gross CPM</div><div class="v cyan" id="s-cpm">$0</div></div>
        <div class="stat"><div class="k">You keep / imp</div><div class="v green" id="s-keep">$0</div></div>
        <div class="stat"><div class="k">Max / session / day</div><div class="v" id="s-max">$0</div></div>
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

// ---- SETUP ----
function renderSetup() {
  view().innerHTML = `
    <div class="view-head"><h2>Setup</h2><p>Your payout identity, backend, and controls. The publisher key is stored owner-only in <code>~/.sponsoric/config.json</code> and sent only to the API base below.</p></div>
    <div class="card"><h3>Payout identity</h3>
      <label class="field"><span class="lab">Payout id (your chosen publisher id)</span><input type="text" id="pid" value="${esc(S.payout_id)}" placeholder="your-id" autocomplete="off"></label>
      <label class="field"><span class="lab">API base</span><input type="text" id="api" value="${esc(S.api)}" placeholder="https://api.sponsoric.io"></label>
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
    <div class="card"><h3>Sponsoric CLI path</h3>
      <div class="hint">Path to <code>bin/statusline.js</code> the install button wires in. Auto-detected when the repo is nearby.</div>
      <label class="field"><input type="text" id="cli" value="${esc(S.cli_path)}" placeholder="/path/to/sponsoric/bin/statusline.js"></label>
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
function renderAbout() {
  view().innerHTML = `
    <div class="view-head"><h2>About</h2><p>Honest, opt-in sponsorship for the terminal.</p></div>
    <div class="card"><h3>How it works</h3>
      <p class="note" style="font-size:13px;line-height:1.75">Sponsoric renders one labeled sponsor line in Claude Code's status row while your agent thinks, and shares ad revenue with you. It never reads your code, files, prompts, or environment — only an anonymized session tag, the ad id, and a timestamp ever leave your machine. An impression counts only when the line is actually rendered to a human.</p>
    </div>
    <div class="card"><h3>The honest part</h3>
      <p class="note" style="font-size:13px;line-height:1.75">Earnings are demand-gated: a real advertiser has to pay for the placement. The CPMs shown here are the tier rates, not a promise. Think coffee money, not a paycheck — and you can pause or uninstall in one click.</p>
    </div>
    <div class="card"><h3>Links</h3>
      <div class="btn-row"><button class="btn ghost" id="repo">GitHub</button><button class="btn ghost" id="privacy">Privacy</button></div>
    </div>`;
  document.getElementById("repo")?.addEventListener("click", () => openUrl("https://github.com/cognifer-labs/sponsoric"));
  document.getElementById("privacy")?.addEventListener("click", () => openUrl("https://github.com/cognifer-labs/sponsoric/blob/main/PRIVACY.md"));
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
