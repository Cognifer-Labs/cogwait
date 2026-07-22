// Cogwait desktop backend — native Rust reimplementation of the small pieces
// the CLI does (config I/O, settings.json patching, API calls), so the app is
// self-contained and the publisher key never leaves the Rust side.
//
// Mirrors: lib/client.js (config precedence + owner-only writes), lib/levels.js
// (ad tiers), bin/setup.js (statusLine install), server contract (README.md).

use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}
fn config_path() -> PathBuf {
    home().join(".cogwait").join("config.json")
}
fn settings_path() -> PathBuf {
    home().join(".claude").join("settings.json")
}
// `~/.claude/settings.json.cogwait-bak` — byte-identical name to bin/setup.js's
// backup target, so the CLI and the app share one pristine snapshot.
fn settings_bak_path() -> PathBuf {
    let mut s = settings_path().into_os_string();
    s.push(".cogwait-bak");
    PathBuf::from(s)
}

// Snapshot settings.json ONCE, before Cogwait ever modifies it, and never
// overwrite that snapshot on a re-install. This is a recorded fix (mirrors
// bin/setup.js's backup()): a second install must not replace the pristine copy
// with an already-modified one, or the user's original statusLine becomes
// unrecoverable. Best-effort — a failed copy never blocks the install.
fn backup_settings() {
    let sp = settings_path();
    if !sp.exists() {
        return;
    }
    let bak = settings_bak_path();
    if bak.exists() {
        return;
    }
    let _ = std::fs::copy(&sp, &bak);
}

// ---- owner-only file writes (dir 0700, file 0600), mirroring lib/client.js ----
fn secure_write(path: &PathBuf, data: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        set_mode(dir, 0o700);
    }
    std::fs::write(path, data)?;
    set_mode(path, 0o600);
    Ok(())
}
#[cfg(unix)]
fn set_mode(path: &std::path::Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}
#[cfg(not(unix))]
fn set_mode(_path: &std::path::Path, _mode: u32) {}

fn read_json(path: &PathBuf) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

// ---- ad levels (single source of truth, mirrors lib/levels.js) ----
#[derive(Serialize, Clone)]
pub struct Level {
    pub id: u8,
    pub key: &'static str,
    pub label: &'static str,
    pub lines: u8,
    pub cpm: f64,
    pub desc: &'static str,
}
const SHARE: f64 = 0.7;

fn env_cpm(key: &str, dflt: f64) -> f64 {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(dflt)
}
pub fn levels() -> Vec<Level> {
    vec![
        Level { id: 0, key: "off", label: "Off", lines: 0, cpm: 0.0,
            desc: "No sponsor line. Nothing renders, nothing earns." },
        Level { id: 1, key: "minimal", label: "Minimal", lines: 1, cpm: env_cpm("COGWAIT_CPM_L1", 8.0),
            desc: "One dim, single-line sponsor note. The default — barely there." },
        Level { id: 2, key: "standard", label: "Standard", lines: 1, cpm: env_cpm("COGWAIT_CPM_L2", 18.0),
            desc: "A brighter, colored line with an icon and a call-to-action." },
        Level { id: 3, key: "boosted", label: "Boosted", lines: 2, cpm: env_cpm("COGWAIT_CPM_L3", 35.0),
            desc: "A two-line boxed sponsor block. Prominent, higher-paid." },
        Level { id: 4, key: "banner", label: "Banner", lines: 2, cpm: env_cpm("COGWAIT_CPM_L4", 60.0),
            desc: "A full-width inverse-video banner bar with headline + link — impossible to miss." },
        Level { id: 5, key: "takeover", label: "Takeover", lines: 4, cpm: env_cpm("COGWAIT_CPM_L5", 90.0),
            desc: "A bordered multi-line takeover with a blinking marker — the most intrusive tier the status row allows." },
    ]
}
fn clamp_level(n: i64) -> u8 {
    let max = levels().len().saturating_sub(1) as i64;
    n.max(0).min(max) as u8
}
fn per_impression(level: u8) -> f64 {
    let cpm = levels().get(level as usize).map(|l| l.cpm).unwrap_or(0.0);
    (cpm / 1000.0) * SHARE
}

// ---- config accessors ----
fn cfg_str(cfg: &Value, key: &str) -> String {
    cfg.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn cfg_bool(cfg: &Value, key: &str) -> bool {
    match cfg.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "1" || s == "true",
        Some(Value::Number(n)) => n.as_i64() == Some(1),
        _ => false,
    }
}
fn api_base(cfg: &Value) -> String {
    // Production default matches lib/client.js. Point at a local backend by
    // setting the API base in Setup (or COGWAIT_API for the CLI) during dev.
    let a = cfg_str(cfg, "api");
    if a.is_empty() { "https://api.cogwait.io".into() } else { a }
}

// Try to locate the repo's bin/statusline.js so the install button works in dev.
fn detect_cli_path(cfg: &Value) -> String {
    let saved = cfg_str(cfg, "cli_path");
    if !saved.is_empty() { return saved; }
    if let Ok(cwd) = std::env::current_dir() {
        for anc in cwd.ancestors() {
            let cand = anc.join("bin").join("statusline.js");
            if cand.exists() {
                return cand.to_string_lossy().to_string();
            }
        }
    }
    String::new()
}

fn statusline_installed(settings: &Value) -> bool {
    settings
        .get("statusLine")
        .and_then(|s| s.get("command"))
        .and_then(|c| c.as_str())
        .map(|c| c.contains("statusline.js"))
        .unwrap_or(false)
}

// ---- public state snapshot for the UI ----
pub fn state() -> Value {
    let cfg = read_json(&config_path());
    let settings = read_json(&settings_path());
    let level = clamp_level(
        cfg.get("level").and_then(|v| v.as_i64())
            .or_else(|| cfg.get("level").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()))
            .unwrap_or(1),
    );
    json!({
        "payout_id": cfg_str(&cfg, "payout_id"),
        "has_key": !cfg_str(&cfg, "publisher_key").is_empty(),
        "level": level,
        "disabled": cfg_bool(&cfg, "disabled"),
        "mock": cfg_bool(&cfg, "mock"),
        "api": api_base(&cfg),
        "cli_path": detect_cli_path(&cfg),
        "installed": statusline_installed(&settings),
        "config_path": config_path().to_string_lossy(),
        "settings_path": settings_path().to_string_lossy(),
        // The user's own pre-existing statusLine command we chain under, if any
        // (empty = not chaining). Lets the Status tab reflect + pre-check the
        // "keep my existing status line" toggle.
        "chain": cfg_str(&cfg, "chain"),
        "share": SHARE,
    })
}

pub fn levels_json() -> Value {
    let arr: Vec<Value> = levels().iter().map(|l| json!({
        "id": l.id, "key": l.key, "label": l.label, "lines": l.lines,
        "cpm": l.cpm, "desc": l.desc,
        "per_impression": (per_impression(l.id) * 1e6).round() / 1e6,
        // Illustrative ceiling: server caps 500 viewable impressions / session / day.
        "max_daily": ((per_impression(l.id) * 500.0) * 100.0).round() / 100.0,
    })).collect();
    json!({ "share": SHARE, "levels": arr, "daily_cap": 500 })
}

// Merge a JSON patch into config and write it back owner-only.
pub fn save_config(patch: Value) -> Result<Value, String> {
    let mut cfg = read_json(&config_path());
    if !cfg.is_object() { cfg = json!({}); }
    if let (Some(obj), Some(p)) = (cfg.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    let s = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())? + "\n";
    secure_write(&config_path(), &s).map_err(|e| e.to_string())?;
    Ok(state())
}

// ---- statusLine install / uninstall (patches ~/.claude/settings.json) ----
// `chain` mirrors the CLI's `npx cogwait --chain`: when the user already has a
// custom statusLine, remember its command in config (`chain`) so bin/statusline.js
// runs it first and prints the sponsor line beneath it — instead of refusing.
pub fn install(cli_path: Option<String>, chain: bool) -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let path = cli_path.filter(|p| !p.is_empty()).unwrap_or_else(|| detect_cli_path(&cfg));
    if path.is_empty() {
        return Err("Could not find bin/statusline.js. Set the Cogwait CLI path in Setup.".into());
    }
    if !PathBuf::from(&path).exists() {
        return Err(format!("No file at {path}"));
    }
    let mut settings = read_json(&settings_path());
    if !settings.is_object() { settings = json!({}); }
    // The user already has a non-Cogwait statusLine: chain under it, or refuse —
    // never silently clobber it.
    if let Some(existing) = settings.get("statusLine").and_then(|s| s.get("command")).and_then(|c| c.as_str()) {
        if !existing.contains("statusline.js") {
            if chain {
                // Persist the user's own command exactly as-is. This is the same
                // value bin/setup.js writes to config.chain under `--chain`, so
                // the resulting settings.json + config.json are byte-equivalent
                // to the CLI's chained install.
                let existing_cmd = existing.to_string();
                save_config(json!({ "chain": existing_cmd }))?;
            } else {
                return Err("You already have a custom statusLine. Turn on \"Keep my existing status line\" to chain it, or remove it first.".into());
            }
        }
    }
    // Back up the user's pristine settings ONCE before we touch it. Never clobbered.
    backup_settings();
    settings["statusLine"] = json!({
        "type": "command",
        "command": format!("node \"{}\"", path),
        "refreshInterval": 5,
        "padding": 0
    });
    let s = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
    if let Some(dir) = settings_path().parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(settings_path(), s).map_err(|e| e.to_string())?;
    // Remember the working path for next time.
    let _ = save_config(json!({ "cli_path": path }));
    Ok(state())
}

pub fn uninstall() -> Result<Value, String> {
    let mut settings = read_json(&settings_path());
    let is_ours = statusline_installed(&settings);
    if is_ours {
        // If we chained under the user's own statusLine, hand it back rather than
        // just deleting ours — otherwise the user loses a statusLine they had
        // before Cogwait. A non-chained install simply drops the key.
        let cfg = read_json(&config_path());
        let chained = cfg_str(&cfg, "chain");
        if let Some(obj) = settings.as_object_mut() {
            if !chained.is_empty() {
                obj.insert(
                    "statusLine".to_string(),
                    json!({ "type": "command", "command": chained }),
                );
            } else {
                obj.remove("statusLine");
            }
        }
        let s = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
        std::fs::write(settings_path(), s).map_err(|e| e.to_string())?;
        // Nothing left to chain once we're uninstalled — clear the saved command
        // so a later reinstall starts clean.
        if !chained.is_empty() {
            let _ = save_config(json!({ "chain": "" }));
        }
    }
    Ok(state())
}

// ---- backend API calls (key stays here, sent only to the configured base) ----
fn auth_header(cfg: &Value) -> Option<String> {
    let id = cfg_str(cfg, "payout_id");
    let key = cfg_str(cfg, "publisher_key");
    if id.is_empty() || key.is_empty() { None } else { Some(format!("Publisher {id}:{key}")) }
}

pub async fn register() -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let id = cfg_str(&cfg, "payout_id");
    if id.is_empty() {
        return Err("Set your payout id first.".into());
    }
    if !cfg_str(&cfg, "publisher_key").is_empty() {
        return Err("Already registered — a publisher key is present.".into());
    }
    let url = format!("{}/session/init", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client.post(&url).json(&json!({ "publisher_id": id })).send().await
        .map_err(|e| format!("Cannot reach backend: {e}"))?;
    let code = resp.status();
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if code.is_success() {
        if let Some(secret) = body.get("secret").and_then(|v| v.as_str()) {
            save_config(json!({ "publisher_key": secret, "payout_id": id }))?;
            return Ok(state());
        }
        return Err("Backend did not return a secret.".into());
    }
    if code.as_u16() == 401 {
        return Err("This publisher id is already registered elsewhere. Recover the key from that machine.".into());
    }
    Err(format!("Registration failed ({code}): {}", body.get("error").and_then(|v| v.as_str()).unwrap_or("")))
}

pub async fn earnings() -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let auth = auth_header(&cfg).ok_or("Register first (need payout id + key).")?;
    let url = format!("{}/earnings", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client.get(&url).header("authorization", auth).send().await
        .map_err(|e| format!("Cannot reach backend: {e}"))?;
    if resp.status().as_u16() == 401 {
        return Err("Unauthorized — check your payout id and key.".into());
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn payout() -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let auth = auth_header(&cfg).ok_or("Register first (need payout id + key).")?;
    let url = format!("{}/payout", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client.post(&url).header("authorization", auth)
        .header("content-type", "application/json").body("{}").send().await
        .map_err(|e| format!("Cannot reach backend: {e}"))?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

// Choose the cash-out rail: 'stripe' (bank/card via Connect) or 'paypal' (to an
// email). Mirrors lib/client.js's setPayoutMethod → POST /payout/method; the
// server validates the method + email and clamps what it stores, so the client
// can't aim money at a fat-fingered target. Graceful degradation, like the
// Fund-OSS panel: an older backend without this endpoint (404) returns a
// structured `{ ok:false, error:"unavailable" }` instead of a hard failure.
pub async fn set_payout_method(method: String, paypal_email: Option<String>) -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let auth = auth_header(&cfg).ok_or("Register first (need payout id + key).")?;
    let mut body = json!({ "method": method });
    if let Some(email) = paypal_email.as_ref().map(|e| e.trim()).filter(|e| !e.is_empty()) {
        body["paypal_email"] = json!(email);
    }
    let url = format!("{}/payout/method", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("authorization", auth)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Cannot reach backend: {e}"))?;
    if resp.status().as_u16() == 404 {
        return Ok(json!({ "ok": false, "error": "unavailable" }));
    }
    // Return the body verbatim (ok / payout_method / masked paypal_email, or an
    // error field) so the UI can mirror the web dashboard's handling exactly.
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

// Fetch the real ad the backend would currently serve, so the Status preview is
// genuinely live (campaign-or-house fill) rather than a canned client rotation.
// No auth needed — /ad/next is public. Tag by payout id so the preview mirrors
// what this publisher is actually served.
pub async fn ad_preview() -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let pid = cfg_str(&cfg, "payout_id");
    let tag = if pid.is_empty() { "preview".to_string() } else { pid };
    let url = format!("{}/ad/next", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client.get(&url).query(&[("tag", tag.as_str())]).send().await
        .map_err(|e| format!("Cannot reach backend: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Ad fetch failed ({})", resp.status()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

pub async fn connect_onboard() -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let auth = auth_header(&cfg).ok_or("Register first (need payout id + key).")?;
    let url = format!("{}/connect/onboard", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client.post(&url).header("authorization", auth)
        .header("content-type", "application/json").body("{}").send().await
        .map_err(|e| format!("Cannot reach backend: {e}"))?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

// ---- Fund-OSS: donate_pct get/set + local dependency scan ----
// Mirrors lib/client.js's DONATE_PCT precedence + lib/oss.js's scan/weight/
// receipt pipeline (server/index.js POST /donate/config, GET /earnings). The
// scan itself is pure filesystem I/O — nothing dependency-related ever
// crosses the network; only the resulting dollar TOTAL does (see bin/oss.js).
fn clamp_pct(n: f64) -> i64 {
    let r = n.round() as i64;
    r.max(0).min(100)
}

fn receipt_path() -> PathBuf {
    home().join(".cogwait").join("oss-receipt.json")
}

// Read the give-back % + funded-to-date from the live backend when
// registered; fall back to the local config value only (marked `synced:false`)
// when unauthenticated, offline, or the backend predates Phase 8 (no
// `donate_pct` in the /earnings response) — never a broken page, per the
// ui-redo DESIGN.md graceful-degradation call.
pub async fn oss_config() -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let local_pct = cfg
        .get("donate_pct")
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64)))
        .unwrap_or(20);
    let local_pct = clamp_pct(local_pct as f64);

    let auth = match auth_header(&cfg) {
        Some(a) => a,
        None => return Ok(json!({ "donate_pct": local_pct, "available": false, "synced": false, "funded_usd": 0.0, "balance_usd": 0.0, "donations": [] })),
    };
    let url = format!("{}/earnings", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = match client.get(&url).header("authorization", auth).send().await {
        Ok(r) => r,
        Err(_) => return Ok(json!({ "donate_pct": local_pct, "available": false, "synced": false, "funded_usd": 0.0, "balance_usd": 0.0, "donations": [] })),
    };
    if !resp.status().is_success() {
        return Ok(json!({ "donate_pct": local_pct, "available": false, "synced": false, "funded_usd": 0.0, "balance_usd": 0.0, "donations": [] }));
    }
    let body: Value = resp.json().await.unwrap_or_else(|_| json!({}));
    if body.get("donate_pct").is_none() {
        // Backend reachable but predates Phase 8 — no donate_pct field at all.
        return Ok(json!({ "donate_pct": local_pct, "available": false, "synced": false, "funded_usd": 0.0, "balance_usd": body.get("balance_usd").cloned().unwrap_or(json!(0.0)), "donations": [] }));
    }
    let remote_pct = body.get("donate_pct").and_then(|v| v.as_f64()).unwrap_or(local_pct as f64);
    let donations: Vec<Value> = body.get("donations").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let funded: f64 = donations.iter().map(|p| p.get("amount_usd").and_then(|v| v.as_f64()).unwrap_or(0.0)).sum();
    Ok(json!({
        "donate_pct": clamp_pct(remote_pct),
        "available": true,
        "synced": true,
        "funded_usd": (funded * 100.0).round() / 100.0,
        "balance_usd": body.get("balance_usd").cloned().unwrap_or(json!(0.0)),
        "donations": donations,
    }))
}

// Save locally first (source of truth for display, like `level`), then try to
// sync to the server (the server clamps + enforces — the client can't be
// trusted to move money, DESIGN.md §2/§9). A sync failure degrades to a
// "not synced" note rather than an error — the local value still took effect.
pub async fn set_donate_pct(pct: f64) -> Result<Value, String> {
    let clamped = clamp_pct(pct);
    save_config(json!({ "donate_pct": clamped }))?;

    let cfg = read_json(&config_path());
    let auth = match auth_header(&cfg) {
        Some(a) => a,
        None => return Ok(json!({ "donate_pct": clamped, "synced": false, "note": "Register first to sync your give-back % to the backend." })),
    };
    let url = format!("{}/donate/config", api_base(&cfg));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("authorization", auth)
        .header("content-type", "application/json")
        .json(&json!({ "donate_pct": clamped }))
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => {
            let body: Value = r.json().await.unwrap_or_else(|_| json!({}));
            let synced_pct = body.get("donate_pct").and_then(|v| v.as_i64()).unwrap_or(clamped);
            Ok(json!({ "donate_pct": synced_pct, "synced": true }))
        }
        _ => Ok(json!({ "donate_pct": clamped, "synced": false, "note": "Saved locally — could not reach the backend to sync." })),
    }
}

fn safe_read_json(path: &PathBuf, max_bytes: u64) -> Option<Value> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > max_bytes {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

const MAX_PACKAGES: usize = 5000;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_LOCKFILE_BYTES: u64 = 8 * 1024 * 1024;

// npm v2/v3 lockfile `packages` map keys look like "node_modules/foo",
// "node_modules/@scope/foo", or nested paths — extract the installed name.
fn name_from_packages_key(key: &str) -> Option<String> {
    let idx = key.rfind("node_modules/")?;
    let rest = &key[idx + "node_modules/".len()..];
    if rest.is_empty() {
        return None;
    }
    let mut segs = rest.split('/');
    let first = segs.next()?;
    if first.starts_with('@') {
        if let Some(second) = segs.next() {
            return Some(format!("{first}/{second}"));
        }
    }
    Some(first.to_string())
}

fn dep_names_from_lockfile(cwd: &std::path::Path) -> Option<Vec<String>> {
    let lock = safe_read_json(&cwd.join("package-lock.json"), MAX_LOCKFILE_BYTES)?;
    let packages = lock.get("packages")?.as_object()?;
    let mut seen = std::collections::HashSet::new();
    for key in packages.keys() {
        if key.is_empty() {
            continue;
        }
        if let Some(name) = name_from_packages_key(key) {
            seen.insert(name);
        }
    }
    if seen.is_empty() { None } else { Some(seen.into_iter().collect()) }
}

fn dep_names_from_package_json(cwd: &std::path::Path) -> Vec<String> {
    let pkg = match safe_read_json(&cwd.join("package.json"), MAX_FILE_BYTES) {
        Some(v) => v,
        None => return vec![],
    };
    let mut seen = std::collections::HashSet::new();
    for field in ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] {
        if let Some(obj) = pkg.get(field).and_then(|v| v.as_object()) {
            for k in obj.keys() {
                seen.insert(k.clone());
            }
        }
    }
    seen.into_iter().collect()
}

struct ScanResult {
    deps: Vec<(String, Option<Value>)>, // (name, funding field)
    source: &'static str,
    scanned: usize,
    skipped: usize,
    truncated: bool,
}

// Scan `cwd`'s dependency tree for `funding` fields. Guard rails mirror
// lib/oss.js exactly: bounded reads, a hard cap on packages scanned, and no
// symlink escape outside node_modules.
fn scan_deps(cwd: &std::path::Path) -> ScanResult {
    let nm_root = cwd.join("node_modules");
    let real_root = std::fs::canonicalize(&nm_root).ok();

    let (names, source) = match dep_names_from_lockfile(cwd) {
        Some(n) => (n, "lockfile"),
        None => (dep_names_from_package_json(cwd), "package.json"),
    };

    let mut deps = Vec::new();
    let mut scanned = 0usize;
    let mut skipped = 0usize;
    let mut truncated = false;

    for name in names {
        if scanned >= MAX_PACKAGES {
            truncated = true;
            break;
        }
        scanned += 1;
        let real_root = match &real_root {
            Some(r) => r,
            None => { skipped += 1; continue; }
        };
        let manifest_dir = nm_root.join(&name);
        let real_manifest_dir = match std::fs::canonicalize(&manifest_dir) {
            Ok(p) => p,
            Err(_) => { skipped += 1; continue; }
        };
        // Refuse a symlinked package resolving outside node_modules.
        if real_manifest_dir != *real_root && !real_manifest_dir.starts_with(real_root) {
            skipped += 1;
            continue;
        }
        let manifest = safe_read_json(&manifest_dir.join("package.json"), MAX_FILE_BYTES);
        match manifest {
            Some(m) => deps.push((name, m.get("funding").cloned())),
            None => skipped += 1,
        }
    }

    ScanResult { deps, source, scanned, skipped, truncated }
}

// npm's `funding` field is a string, a {type,url} object, or an array of
// either. Normalize to a de-duped list of URLs.
fn normalize_funding(field: &Option<Value>) -> Vec<String> {
    let mut urls = Vec::new();
    let mut add = |v: &Value| {
        if let Some(s) = v.as_str() {
            if !s.trim().is_empty() { urls.push(s.trim().to_string()); }
        } else if let Some(u) = v.get("url").and_then(|u| u.as_str()) {
            if !u.trim().is_empty() { urls.push(u.trim().to_string()); }
        }
    };
    if let Some(f) = field {
        if let Some(arr) = f.as_array() {
            for v in arr { add(v); }
        } else {
            add(f);
        }
    }
    let mut seen = std::collections::HashSet::new();
    urls.retain(|u| seen.insert(u.clone()));
    urls
}

struct WeightedItem {
    url: String,
    packages: Vec<String>,
    shares: f64,
    pct: f64,
}
struct Weighted {
    items: Vec<WeightedItem>,
    coverage: f64,
}

// Each package contributes 1 share, split evenly across its funding URLs.
// `coverage` is the honest (often low) fraction of deps declaring ANY target.
fn weight_funding(deps: &[(String, Option<Value>)]) -> Weighted {
    let mut totals: std::collections::HashMap<String, (f64, std::collections::BTreeSet<String>)> = std::collections::HashMap::new();
    let mut deps_with_funding = 0usize;

    for (name, funding) in deps {
        let urls = normalize_funding(funding);
        if urls.is_empty() { continue; }
        deps_with_funding += 1;
        let share = 1.0 / urls.len() as f64;
        for url in urls {
            let entry = totals.entry(url).or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
            entry.0 += share;
            entry.1.insert(name.clone());
        }
    }

    let total_shares: f64 = totals.values().map(|(s, _)| s).sum();
    let mut items: Vec<WeightedItem> = totals
        .into_iter()
        .map(|(url, (shares, packages))| WeightedItem {
            pct: if total_shares > 0.0 { (shares / total_shares) * 100.0 } else { 0.0 },
            url,
            packages: packages.into_iter().collect(),
            shares,
        })
        .collect();
    items.sort_by(|a, b| b.shares.partial_cmp(&a.shares).unwrap().then_with(|| a.url.cmp(&b.url)));

    let total_deps = deps.len();
    let coverage = if total_deps > 0 { deps_with_funding as f64 / total_deps as f64 } else { 0.0 };
    Weighted { items, coverage }
}

// Best-effort display name from a funding URL — last path segment, else host.
fn derive_name(url: &str) -> String {
    let without_scheme = url.splitn(2, "://").nth(1).unwrap_or(url);
    let (host, path) = without_scheme.split_once('/').unwrap_or((without_scheme, ""));
    let last_seg = path.split('/').filter(|s| !s.is_empty()).last();
    last_seg.map(|s| s.to_string()).unwrap_or_else(|| host.to_string())
}

// Allocate `donate_amount_usd` across the weighted funding URLs. Illustrative —
// a pooled-fund snapshot, not a per-maintainer payment guarantee (DESIGN.md §6).
fn build_receipt(weighted: &Weighted, donate_amount_usd: f64) -> Value {
    let total = donate_amount_usd.max(0.0);
    let mut allocated = 0.0f64;
    let mut maintainers: Vec<Value> = weighted
        .items
        .iter()
        .map(|it| {
            let usd = ((total * (it.pct / 100.0)) * 100.0).round() / 100.0;
            allocated = ((allocated + usd) * 100.0).round() / 100.0;
            json!({ "url": it.url, "name": derive_name(&it.url), "pct": it.pct, "usd": usd, "packages": it.packages })
        })
        .collect();

    let drift = ((total - allocated) * 100.0).round() / 100.0;
    if !maintainers.is_empty() && drift.abs() >= 0.01 {
        if let Some(first) = maintainers.get_mut(0) {
            let cur = first.get("usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
            first["usd"] = json!(((cur + drift) * 100.0).round() / 100.0);
        }
    }

    json!({ "totalUsd": total, "maintainers": maintainers, "coverage": weighted.coverage })
}

// Run the local scan against the Tauri process's current working directory
// (same cwd-scoping caveat as `lib/oss.js` / `npx cogwait --oss`), pull the
// live give-back % + balance for dollar figures when reachable, and persist
// the receipt to ~/.cogwait/oss-receipt.json — the same file the CLI writes,
// so the web dashboard's local file-picker can load either.
pub async fn run_oss_scan() -> Result<Value, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let scan = scan_deps(&cwd);
    let weighted = weight_funding(&scan.deps);

    let oss = oss_config().await.unwrap_or_else(|_| json!({}));
    let donate_pct = oss.get("donate_pct").and_then(|v| v.as_i64()).unwrap_or(20);
    let balance = oss.get("balance_usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let donate_usd = (balance * donate_pct as f64 / 100.0 * 1e6).round() / 1e6;

    let receipt = build_receipt(&weighted, donate_usd);
    let out = json!({
        "generated": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0),
        "donate_pct": donate_pct,
        "source": scan.source,
        "scanned": scan.scanned,
        "skipped": scan.skipped,
        "truncated": scan.truncated,
        "totalUsd": receipt.get("totalUsd").cloned().unwrap_or(json!(0.0)),
        "coverage": receipt.get("coverage").cloned().unwrap_or(json!(0.0)),
        "maintainers": receipt.get("maintainers").cloned().unwrap_or(json!([])),
    });
    let s = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())? + "\n";
    // Best-effort persist — the caller still gets the receipt even if the
    // write fails (e.g. read-only home dir in some sandboxed environments).
    let _ = secure_write(&receipt_path(), &s);
    Ok(out)
}

// A lightweight "doctor": the same checks bin/doctor.js reports, as structured rows.
// Async because the last two checks are the ones that actually answer "is this
// working right now" — a live backend ping and the client's network-backoff
// state. Without them the card could report "all good" while the backend was
// unreachable, which is precisely what a doctor exists to catch.
pub async fn doctor() -> Value {
    let st = state();
    let mut checks: Vec<Value> = vec![];
    let mut push = |ok: bool, warn: bool, msg: String| {
        checks.push(json!({ "status": if ok { "ok" } else if warn { "warn" } else { "bad" }, "msg": msg }));
    };
    let installed = st["installed"].as_bool().unwrap_or(false);
    push(installed, false, if installed { "statusLine configured in settings.json".into() }
        else { "statusLine not configured — click Install".into() });
    let pid = st["payout_id"].as_str().unwrap_or("");
    let mock = st["mock"].as_bool().unwrap_or(false);
    if !pid.is_empty() { push(true, false, format!("payout id set ({pid})")); }
    else if mock { push(false, true, "no payout id, but MOCK mode is on (demo only)".into()); }
    else { push(false, false, "no payout id — set it in Setup".into()); }
    let has_key = st["has_key"].as_bool().unwrap_or(false);
    if has_key { push(true, false, "registered — publisher key present".into()); }
    else if !mock { push(false, true, "not registered — click Register to earn".into()); }
    let level = st["level"].as_u64().unwrap_or(1);
    if level == 0 { push(false, true, "ad level 0 (Off) — nothing renders, nothing earns".into()); }
    else { push(true, false, format!("ad level {level} active")); }
    if st["disabled"].as_bool().unwrap_or(false) { push(false, true, "ads paused (disabled)".into()); }

    // Network backoff: bin/refresh-ad.js records repeated fetch failures in
    // ~/.cogwait/refresh.fail ({count, ts}); >= 3 within the 60s window means
    // the client has throttled itself and ads have stopped refreshing.
    let fail = read_json(&home().join(".cogwait").join("refresh.fail"));
    let count = fail.get("count").and_then(|v| v.as_i64()).unwrap_or(0);
    let ts = fail.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64).unwrap_or(0);
    if count >= 3 && now_ms.saturating_sub(ts) < 60_000 {
        push(false, true, "in network backoff — recent ad fetches failed".into());
    } else {
        push(true, false, "no active backoff".into());
    }

    // Live backend reachability. Skipped in mock mode, which is local-only by
    // definition and would always report unreachable.
    let cfg = read_json(&config_path());
    let base = api_base(&cfg);
    if mock {
        push(false, true, "mock mode — skipping the live backend check".into());
    } else {
        let url = format!("{base}/health");
        // 3s ceiling — the Status tab must never hang on a dead backend.
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => push(true, false, format!("backend reachable ({base})")),
            Ok(resp) => push(false, false, format!("backend returned HTTP {} ({base})", resp.status().as_u16())),
            Err(e) if e.is_timeout() => push(false, false, format!("backend timed out after 3s ({base})")),
            Err(e) => push(false, false, format!("backend unreachable ({base}): {e}")),
        }
    }
    json!({ "checks": checks })
}
