import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

// ---- types mirroring the Rust JSON ----
type State = {
  payout_id: string;
  has_key: boolean;
  level: number;
  disabled: boolean;
  mock: boolean;
  api: string;
  cli_path: string;
  installed: boolean;
  config_path: string;
  settings_path: string;
  share: number;
};
type Level = { id: number; key: string; label: string; cpm: number; desc: string; per_impression: number; max_daily: number };
type LevelsInfo = { share: number; daily_cap: number; levels: Level[] };

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
}

async function refresh() {
  S = await invoke<State>("get_state");
  updatePill();
  render();
}

function updatePill() {
  const pill = document.getElementById("pill")!;
  if (S.disabled || S.level === 0) { pill.textContent = "Paused"; pill.className = "pill off"; }
  else if (S.installed && (S.has_key || S.mock)) { pill.textContent = "Earning · L" + S.level; pill.className = "pill good"; }
  else if (S.installed) { pill.textContent = "Set up needed"; pill.className = "pill warn"; }
  else { pill.textContent = "Not installed"; pill.className = "pill warn"; }
}

function render() {
  if (tab === "home") return renderHome();
  if (tab === "earnings") return renderEarnings();
  if (tab === "level") return renderLevel();
  if (tab === "setup") return renderSetup();
  if (tab === "about") return renderAbout();
}

// ---- sponsor line preview (mirrors bin/statusline.js) ----
function sponsorPreview(level: number): string {
  const text = "Neon — serverless Postgres that scales to zero";
  const url = "https://neon.tech";
  if (level <= 0) return `<span class="spon-dim">— no sponsor line (Off) —</span>`;
  if (level >= 3)
    return `<div><span class="spon-mag">◆ SPONSOR</span> <b>${text}</b></div><div style="padding-left:96px" class="spon-yellow">${url} ›</div>`;
  if (level >= 2)
    return `<span class="spon-yellow"><b>▸ [sponsor]</b></span> <span class="spon-cyan">${text}</span> <span class="spon-yellow">›</span>`;
  return `<span class="spon-cyan">[sponsor]</span> <span class="spon-dim">${text} ›</span>`;
}
function termBlock(inner: string): string {
  return `<div class="term"><div class="term-bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="term-body"><div class="spon-dim">· thinking…</div><div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">${inner}</div></div></div>`;
}

// ---- HOME / STATUS ----
async function renderHome() {
  const checks = await invoke<{ checks: { status: string; msg: string }[] }>("doctor");
  const rows = checks.checks
    .map((c) => `<div class="check"><span class="dot ${c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : "bad"}"></span>${esc(c.msg)}</div>`)
    .join("");
  const lvl = L.levels[S.level] || L.levels[1];
  view().innerHTML = `
    <div class="view-head"><h2>Status</h2><p>Your Sponsoric install at a glance. The sponsor line renders in Claude Code's status row — this app manages it.</p></div>
    <div class="card"><h3>Health</h3><div class="hint">The same checks as <code>npx sponsoric --doctor</code>.</div>${rows}</div>
    <div class="card">
      <h3>Sponsor line</h3><div class="hint">This is what renders while your agent thinks — level ${S.level} (${esc(lvl.label)}).</div>
      ${termBlock(sponsorPreview(S.level))}
    </div>
    <div class="card">
      <h3>${S.installed ? "Installed" : "Not installed"}</h3>
      <div class="hint">${S.installed ? "The status line is wired into Claude Code. Restart Claude Code after changes." : "Add the sponsor line to <code>~/.claude/settings.json</code>. Non-destructive; your existing status line is preserved."}</div>
      <div class="btn-row">
        ${S.installed
          ? `<button class="btn ghost" id="uninstall">Uninstall status line</button>`
          : `<button class="btn" id="install">Install status line</button>`}
        <button class="btn ghost" id="reveal-cli">Show CLI path</button>
      </div>
      <div class="msg" id="m"></div>
    </div>`;
  document.getElementById("install")?.addEventListener("click", () => act("install_statusline", { cliPath: S.cli_path || null }, "Installed. Restart Claude Code."));
  document.getElementById("uninstall")?.addEventListener("click", () => act("uninstall_statusline", {}, "Removed the status line."));
  document.getElementById("reveal-cli")?.addEventListener("click", () => {
    msg("m", S.cli_path ? "CLI: " + S.cli_path : "No bin/statusline.js found — set the path in Setup.", "info");
  });
}

// ---- EARNINGS ----
async function renderEarnings() {
  view().innerHTML = `
    <div class="view-head"><h2>Earnings</h2><p>Viewable-impression revenue for your publisher id. You keep ${Math.round(S.share * 100)}%.</p></div>
    <div class="stat-row">
      <div class="stat"><div class="k">Balance</div><div class="v green" id="bal">—</div></div>
      <div class="stat"><div class="k">Impressions</div><div class="v" id="imp">—</div></div>
      <div class="stat"><div class="k">Min payout</div><div class="v cyan" id="min">—</div></div>
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
    (document.getElementById("bal")!).textContent = "$" + (d.balance_usd || 0).toFixed(4);
    (document.getElementById("imp")!).textContent = String(d.impressions || 0);
    (document.getElementById("min")!).textContent = "$" + (d.min_payout_usd ?? 0);
    const canPay = d.balance_usd > 0 && d.balance_usd >= (d.min_payout_usd || 0);
    const payBtn = document.getElementById("pay") as HTMLButtonElement;
    if (payBtn) payBtn.disabled = !canPay;
    renderHistory(d.payouts || []);
    msg("m", canPay ? "Eligible for payout." : "Keep earning to reach the minimum.", "info");
  } catch (e) { msg("m", String(e), "err"); }
}
function renderHistory(payouts: any[]) {
  const tb = document.getElementById("hist")!;
  if (!payouts.length) { tb.innerHTML = `<tr><td colspan="3" class="note">No payouts yet</td></tr>`; return; }
  tb.innerHTML = payouts.map((p) =>
    `<tr><td>${new Date(p.ts).toLocaleDateString()}</td><td>$${Number(p.amount_usd || 0).toFixed(2)}</td><td class="mono">${esc(String(p.transfer || ""))}${p.simulated ? " (sim)" : ""}</td></tr>`
  ).join("");
}
async function doPayout() {
  msg("m", "Requesting payout…", "info");
  try {
    const d = await invoke<any>("request_payout");
    msg("m", d.ok ? `Paid $${d.paid_usd.toFixed(2)}${d.simulated ? " (simulated)" : ""}` : "Payout failed: " + (d.error || ""), d.ok ? "ok" : "err");
    loadEarnings();
  } catch (e) { msg("m", String(e), "err"); }
}
async function doOnboard() {
  msg("m", "Opening Stripe onboarding…", "info");
  try {
    const d = await invoke<any>("connect_onboard");
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
    <div class="card"><h3>Preview — ${esc(lv.label)}</h3><div class="hint">${esc(lv.desc)}</div>${termBlock(sponsorPreview(S.level))}</div>
    <div class="card"><h3>What it can pay</h3>
      <div class="hint">Illustrative ceiling only. The server caps ${L.daily_cap} viewable impressions per session per day, and real earnings depend on advertiser demand.</div>
      <div class="stat-row">
        <div class="stat"><div class="k">Gross CPM</div><div class="v cyan">${lv.cpm ? "$" + lv.cpm : "—"}</div></div>
        <div class="stat"><div class="k">You keep / imp</div><div class="v green">$${lv.per_impression.toFixed(4)}</div></div>
        <div class="stat"><div class="k">Max / session / day</div><div class="v">$${lv.max_daily.toFixed(2)}</div></div>
      </div>
    </div>
    <div class="msg" id="m"></div>`;
  document.querySelectorAll<HTMLElement>(".lvl").forEach((el) =>
    el.addEventListener("click", async () => {
      const n = Number(el.dataset.lvl);
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
    S = await invoke<State>("save_config", { patch: { payout_id: pid, api } });
    updatePill(); msg("m", "Saved.", "ok");
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
    S = await invoke<State>("save_config", { patch: { disabled: (e.target as HTMLInputElement).checked } });
    updatePill();
  });
  document.getElementById("mock")?.addEventListener("change", async (e) => {
    S = await invoke<State>("save_config", { patch: { mock: (e.target as HTMLInputElement).checked } });
    updatePill();
  });
  document.getElementById("savecli")?.addEventListener("click", async () => {
    const cli = (document.getElementById("cli") as HTMLInputElement).value.trim();
    S = await invoke<State>("save_config", { patch: { cli_path: cli } });
    render();
  });
}

// ---- ABOUT ----
function renderAbout() {
  view().innerHTML = `
    <div class="view-head"><h2>About</h2><p>Honest, opt-in sponsorship for the terminal.</p></div>
    <div class="card"><h3>How it works</h3>
      <p class="note" style="font-size:13px;line-height:1.7">Sponsoric renders one labeled sponsor line in Claude Code's status row while your agent thinks, and shares ad revenue with you. It never reads your code, files, prompts, or environment — only an anonymized session tag, the ad id, and a timestamp ever leave your machine. An impression counts only when the line was actually rendered to a human.</p>
    </div>
    <div class="card"><h3>The honest part</h3>
      <p class="note" style="font-size:13px;line-height:1.7">Earnings are demand-gated: a real advertiser has to pay for the placement. The CPMs shown here are the tier rates, not a promise. Think coffee money, not a paycheck — and you can pause or uninstall in one click.</p>
    </div>
    <div class="card"><h3>Links</h3>
      <div class="btn-row">
        <button class="btn ghost" id="repo">GitHub</button>
        <button class="btn ghost" id="privacy">Privacy</button>
      </div>
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
