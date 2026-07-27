# Contributing to Cogwait

Cogwait is MIT-licensed and developed in the open. Bug reports, fixes, platform
support, backend adapters, IDE surfaces, and doc corrections are all welcome.

**Security issues do not go here.** Report them privately per [SECURITY.md](SECURITY.md).

## Ground rules specific to this project

Cogwait puts an ad in a developer's terminal. That only stays acceptable if a few
invariants never bend, so a change that breaks one of these will be rejected no
matter how good the rest of it is:

1. **Never transmit user content.** No prompt text, code, file contents, env vars,
   or secrets leave the machine. Hook stdin is read only to extract the session
   id, then discarded. The raw session id itself never leaves — only a truncated
   SHA-256 tag.
2. **Never bill an unviewed impression.** An impression is reported only because
   the sponsor line was actually rendered, throttled per session.
3. **Never manufacture delay.** Nothing may slow the terminal or the model in
   order to serve more ads. All network calls stay detached with hard timeouts.
4. **Always labeled, always opt-in.** Paid placements render as `[sponsor]`. The
   unpaid AI-news fallback is never labeled `[sponsor]` and reports no impression.
5. **Zero runtime dependencies in the client.** `bin/` and `lib/` must run on a
   bare Node install. `pg` is optional and backend-only.

If you think one of these is wrong, open an issue and argue it — don't route
around it in a PR.

## Setup

```bash
git clone https://github.com/Cognifer-Labs/cogwait.git
cd cogwait
npm install        # installs nothing for the client; pulls optional `pg` for backend work
npm test
```

Node **>= 18**. CI runs the suite on 18, 20, and 22 — all three must pass.

## Running things locally

```bash
COGWAIT_MOCK=1 node bin/statusline.js   # render the ad surface with local demo ads, no network
./server/run-local.sh                   # local backend on :8787 with a generated admin token
COGWAIT_API=http://localhost:8787 node bin/statusline.js   # client against your local server
cd app && npm install && npm run tauri dev   # desktop control panel
```

### Never run `bin/*` against your real `$HOME`

The setup and register entry points write to `~/.claude/settings.json` and
`~/.cogwait/config.json`, and an unrecognized flag can fall through to the default
action. Isolate the home directory for any manual run:

```bash
HOME=$(mktemp -d) node bin/setup.js --whatever
```

Note that `COGWAIT_DATA_DIR` isolates *server* state only — client config always
resolves from the real `os.homedir()`.

## Tests

`npm test` runs the whole suite (`test/*.js`, plain `node`, no test framework):
smoke, client, CLI, backend, PayPal, adapter, store-interface parity, platforms,
OSS scan, news, and e2e. Add a test in the matching file for any behavior change;
the backend and client suites are the ones that encode the invariants above.

`test/store-interface.js` enforces parity between the JSON store and the Postgres
store — if you add a store method, it must land in both.

## Pull requests

- Branch off `main`, one logical change per PR.
- Keep the diff minimal and in the style of the surrounding code.
- Commit messages: `type: imperative summary` (`fix:`, `feature:`, `docs:`,
  `deploy:`, `planning:`), body explaining the *why*.
- Update the docs in the same PR when behavior changes — README flag tables,
  `docs/DEPLOY.md`, and the backend contract are part of the product.
- Say in the PR description how you verified it. "Tests pass" is the floor, not
  the proof, for anything touching rendering, billing, or payouts.

## Project layout

| Path | What lives there |
| --- | --- |
| `bin/` | CLI entry points and the status-line renderer |
| `lib/` | Client, render, OSS scan, payment rails — all outbound calls |
| `server/`, `api/` | Ad server, stores (JSON + Postgres), serverless adapter |
| `web/` | Landing page, publisher dashboard, advertiser self-serve |
| `app/` | Tauri desktop control panel (TypeScript + Rust) |
| `ide/` | VS Code and JetBrains extensions |
| `test/` | Test suite |
| `docs/` | Deploy, platforms, signing |

## License

By contributing you agree your contributions are licensed under the
[MIT License](LICENSE).
