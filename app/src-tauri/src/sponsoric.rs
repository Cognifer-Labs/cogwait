// Sponsoric desktop backend — native Rust reimplementation of the small pieces
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
    home().join(".sponsoric").join("config.json")
}
fn settings_path() -> PathBuf {
    home().join(".claude").join("settings.json")
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
        Level { id: 1, key: "minimal", label: "Minimal", lines: 1, cpm: env_cpm("SPONSORIC_CPM_L1", 8.0),
            desc: "One dim, single-line sponsor note. The default — barely there." },
        Level { id: 2, key: "standard", label: "Standard", lines: 1, cpm: env_cpm("SPONSORIC_CPM_L2", 18.0),
            desc: "A brighter, colored line with an icon and a call-to-action." },
        Level { id: 3, key: "boosted", label: "Boosted", lines: 2, cpm: env_cpm("SPONSORIC_CPM_L3", 35.0),
            desc: "A two-line boxed sponsor block. The most prominent, best-paid tier." },
    ]
}
fn clamp_level(n: i64) -> u8 {
    n.max(0).min(3) as u8
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
    // setting the API base in Setup (or SPONSORIC_API for the CLI) during dev.
    let a = cfg_str(cfg, "api");
    if a.is_empty() { "https://api.sponsoric.io".into() } else { a }
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
pub fn install(cli_path: Option<String>) -> Result<Value, String> {
    let cfg = read_json(&config_path());
    let path = cli_path.filter(|p| !p.is_empty()).unwrap_or_else(|| detect_cli_path(&cfg));
    if path.is_empty() {
        return Err("Could not find bin/statusline.js. Set the Sponsoric CLI path in Setup.".into());
    }
    if !PathBuf::from(&path).exists() {
        return Err(format!("No file at {path}"));
    }
    let mut settings = read_json(&settings_path());
    if !settings.is_object() { settings = json!({}); }
    // Don't clobber a non-Sponsoric statusLine the user already has.
    if let Some(existing) = settings.get("statusLine").and_then(|s| s.get("command")).and_then(|c| c.as_str()) {
        if !existing.contains("statusline.js") {
            return Err("You already have a custom statusLine. Remove it first, or use `npx sponsoric --chain` in a terminal.".into());
        }
    }
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
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("statusLine");
        }
        let s = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
        std::fs::write(settings_path(), s).map_err(|e| e.to_string())?;
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

// A lightweight "doctor": the same checks bin/doctor.js reports, as structured rows.
pub fn doctor() -> Value {
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
    json!({ "checks": checks })
}
