'use strict';
// Cogwait Fund-OSS local dependency scan — pure, dependency-free, no network.
// Reads only the current project's package-lock.json + node_modules/*/package.json
// `funding` fields to build a weighted maintainer "receipt." Nothing this module
// touches ever leaves the machine — the CLI only ever sends the resulting dollar
// TOTAL (never a name, URL, or path) to the backend. See bin/oss.js.

const fs = require('fs');
const path = require('path');

// Guard rails: bounded reads, hard cap on packages scanned, no symlink escape
// outside node_modules. A malicious/huge node_modules must never block or OOM
// the CLI.
const MAX_PACKAGES = 5000;
const MAX_FILE_BYTES = 256 * 1024;       // per-manifest read cap
const MAX_LOCKFILE_BYTES = 8 * 1024 * 1024; // lockfiles are bigger than manifests

function safeReadJSON(file, maxBytes) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return null; }
  if (!st.isFile() || st.size > maxBytes) return null;
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// npm v2/v3 lockfile `packages` map keys look like "node_modules/foo",
// "node_modules/@scope/foo", or nested "node_modules/foo/node_modules/bar".
// Extract the installed package name (last segment, scope-aware).
function nameFromPackagesKey(key) {
  const idx = key.lastIndexOf('node_modules/');
  if (idx === -1) return null;
  const rest = key.slice(idx + 'node_modules/'.length);
  if (!rest) return null;
  const segs = rest.split('/');
  if (segs[0] && segs[0].startsWith('@') && segs[1]) return `${segs[0]}/${segs[1]}`;
  return segs[0] || null;
}

function depNamesFromLockfile(cwd) {
  const lock = safeReadJSON(path.join(cwd, 'package-lock.json'), MAX_LOCKFILE_BYTES);
  if (!lock || typeof lock.packages !== 'object' || lock.packages === null) return null;
  const names = new Set();
  for (const key of Object.keys(lock.packages)) {
    if (key === '') continue; // root package entry
    const name = nameFromPackagesKey(key);
    if (name) names.add(name);
  }
  return names.size ? Array.from(names) : null;
}

// Fallback when there's no lockfile (or it's unreadable/pre-v2): the direct
// dependency names declared in package.json. Less precise (no transitive
// deps), but still local-only and honest about what it covers.
function depNamesFromPackageJson(cwd) {
  const pkg = safeReadJSON(path.join(cwd, 'package.json'), MAX_FILE_BYTES);
  if (!pkg) return [];
  const names = new Set();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkg[field] && typeof pkg[field] === 'object') {
      for (const n of Object.keys(pkg[field])) names.add(n);
    }
  }
  return Array.from(names);
}

// Scan `cwd`'s dependency tree for `funding` fields. Returns
// { deps:[{name, funding}], source:'lockfile'|'package.json', scanned, skipped, truncated }.
function scanDeps(cwd) {
  cwd = cwd || process.cwd();
  const nmRoot = path.join(cwd, 'node_modules');
  let realRoot = null;
  try { realRoot = fs.realpathSync(nmRoot); } catch (_) { /* no node_modules at all */ }

  let names = depNamesFromLockfile(cwd);
  let source = 'lockfile';
  if (!names) { names = depNamesFromPackageJson(cwd); source = 'package.json'; }

  const deps = [];
  let scanned = 0, skipped = 0, truncated = false;

  for (const name of names) {
    if (scanned >= MAX_PACKAGES) { truncated = true; break; }
    scanned++;
    if (!realRoot) { skipped++; continue; }

    const manifestDir = path.join(nmRoot, name);
    let realManifestDir;
    try { realManifestDir = fs.realpathSync(manifestDir); }
    catch (_) { skipped++; continue; } // not actually installed

    // Refuse a symlinked package that resolves outside node_modules — no
    // traversal to arbitrary filesystem locations via a crafted symlink.
    if (!(realManifestDir === realRoot || realManifestDir.startsWith(realRoot + path.sep))) {
      skipped++; continue;
    }

    const manifest = safeReadJSON(path.join(manifestDir, 'package.json'), MAX_FILE_BYTES);
    if (!manifest) { skipped++; continue; }
    deps.push({ name, funding: manifest.funding });
  }

  return { deps, source, scanned, skipped, truncated };
}

// npm's `funding` field is a string, a {type,url} object, or an array of
// either. Normalize to a de-duped list of URLs.
function normalizeFunding(field) {
  const urls = [];
  const add = (v) => {
    if (typeof v === 'string' && v.trim()) urls.push(v.trim());
    else if (v && typeof v === 'object' && typeof v.url === 'string' && v.url.trim()) urls.push(v.url.trim());
  };
  if (Array.isArray(field)) field.forEach(add);
  else if (field) add(field);
  return Array.from(new Set(urls));
}

// Each package contributes 1 share, split evenly across its funding URLs (if
// it declares several). Shares accumulate per URL and normalize to a
// percentage — a maintainer funding many of your deps ranks higher.
// `coverage` is the honest (often low) fraction of deps that declare ANY
// funding target at all.
function weightFunding(deps) {
  deps = deps || [];
  const totals = new Map(); // url -> { shares, packages: Set }
  let depsWithFunding = 0;

  for (const dep of deps) {
    const urls = normalizeFunding(dep.funding);
    if (!urls.length) continue;
    depsWithFunding++;
    const share = 1 / urls.length;
    for (const url of urls) {
      let t = totals.get(url);
      if (!t) { t = { shares: 0, packages: new Set() }; totals.set(url, t); }
      t.shares += share;
      t.packages.add(dep.name);
    }
  }

  const totalShares = Array.from(totals.values()).reduce((s, t) => s + t.shares, 0);
  const items = Array.from(totals.entries())
    .map(([url, t]) => ({
      url,
      packages: Array.from(t.packages).sort(),
      shares: t.shares,
      pct: totalShares > 0 ? (t.shares / totalShares) * 100 : 0
    }))
    .sort((a, b) => b.shares - a.shares || a.url.localeCompare(b.url));

  const totalDeps = deps.length;
  return {
    items, totalShares, totalDeps, depsWithFunding,
    coverage: totalDeps > 0 ? depsWithFunding / totalDeps : 0
  };
}

// Best-effort display name from a funding URL (GitHub Sponsors / Open
// Collective / generic — last path segment, else the hostname).
function deriveName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return (parts.length ? parts[parts.length - 1] : u.hostname) || url;
  } catch (_) {
    return url;
  }
}

// Allocate `donateAmountUsd` across the weighted funding URLs. Illustrative —
// this is a pooled-fund snapshot, not a per-maintainer payment guarantee
// (DESIGN.md §6). Returns { totalUsd, maintainers:[{url,name,pct,usd,packages}], coverage }.
function buildReceipt(weighted, donateAmountUsd) {
  weighted = weighted || { items: [], coverage: 0 };
  const total = Math.max(0, Number(donateAmountUsd) || 0);
  const items = weighted.items || [];

  let allocated = 0;
  const maintainers = items.map((it) => {
    const usd = Math.round(total * (it.pct / 100) * 100) / 100;
    allocated = Math.round((allocated + usd) * 100) / 100;
    return { url: it.url, name: deriveName(it.url), pct: it.pct, usd, packages: it.packages };
  });

  // Rounding to cents can leave a few-cent drift; put it on the largest share
  // so the sum matches the total exactly.
  const drift = Math.round((total - allocated) * 100) / 100;
  if (maintainers.length && Math.abs(drift) >= 0.01) {
    maintainers[0].usd = Math.round((maintainers[0].usd + drift) * 100) / 100;
  }

  return { totalUsd: total, maintainers, coverage: weighted.coverage || 0 };
}

module.exports = {
  scanDeps, normalizeFunding, weightFunding, buildReceipt, deriveName,
  MAX_PACKAGES, MAX_FILE_BYTES, MAX_LOCKFILE_BYTES
};
