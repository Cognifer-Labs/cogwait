#!/usr/bin/env bash
# Run the Cogwait backend locally, the way a developer actually wants it:
# persistent data under ~/.cogwait/server, a stable admin token generated once
# and kept owner-only, and CORS open to localhost so web/dashboard.html works.
#
#   ./server/run-local.sh            # foreground, Ctrl-C to stop
#   PORT=9000 ./server/run-local.sh  # different port
#
# Point the client at it with:  npx cogwait --status  (api should read this URL)
set -euo pipefail

DATA_DIR="${COGWAIT_DATA_DIR:-$HOME/.cogwait/server}"
PORT="${PORT:-8787}"
TOKEN_FILE="$DATA_DIR/admin-token"

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"

# The server refuses to boot on the default admin token, so mint a strong one
# once and reuse it. It gates campaign creation and moderation only.
if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 16 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "• Generated a new admin token at $TOKEN_FILE"
fi

echo "• Data dir:  $DATA_DIR"
echo "• Listening: http://localhost:$PORT"
echo "• Admin token: $TOKEN_FILE (needed for /campaign and /campaign/status)"

exec env \
  COGWAIT_DATA_DIR="$DATA_DIR" \
  PORT="$PORT" \
  COGWAIT_ADMIN_TOKEN="$(cat "$TOKEN_FILE")" \
  `# Local dev only: the dashboard gets opened from file://, from a random` \
  `# static-server port, or from the desktop app, and CORS cannot wildcard a` \
  `# port. A production deploy MUST set a real allowlist instead — the API` \
  `# authenticates by header, never by cookie, so no credentialed wildcard is` \
  `# possible, but an explicit list is still the right posture off localhost.` \
  COGWAIT_ALLOWED_ORIGINS="${COGWAIT_ALLOWED_ORIGINS:-*}" \
  node "$(dirname "$0")/index.js"
