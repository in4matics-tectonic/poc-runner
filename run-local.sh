#!/usr/bin/env sh
# The Kate Studio PoC without Docker: backend, MCP server and chat as plain Node processes (Node ≥ 22).
# Same ports as docker-compose.yml. Uses the sibling checkouts ../backend and ../mcp (your local work).
#
#   ./run-local.sh       → backend http://localhost:7004 (/docs), chat http://localhost:7003, MCP on 127.0.0.1:3001
#
# The mobile app and the backoffice run on their own dev servers (npx expo start, npm run dev).
# A phone on the same Wi-Fi reaches the backend and the chat on this machine's LAN IP (printed at start).
# Ctrl+C stops everything. State is in memory, as with Docker.
set -e
cd "$(dirname "$0")"

BACKEND_DIR=${BACKEND_DIR:-../backend}
MCP_DIR=${MCP_DIR:-../mcp}
BACKEND_PORT=${BACKEND_PORT:-7004}
CHAT_PORT=${CHAT_PORT:-7003}
MCP_PORT=${MCP_PORT:-3001}
# Browser origins that may call the backend directly (Expo web with EXPO_PUBLIC_API_URL, the backoffice dev server)
CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:8081,http://localhost:5173,http://localhost:8080}
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)

for dir in "$BACKEND_DIR" "$MCP_DIR"; do
  [ -d "$dir" ] || { echo "Missing $dir: clone it next to poc-runner, or set BACKEND_DIR / MCP_DIR."; exit 1; }
done

# First run: install dependencies (the chat has a package-lock; backend and mcp use pnpm locks, so no lockfile is written)
[ -d chat/node_modules ] || (cd chat && npm ci --no-audit --no-fund)
[ -d "$BACKEND_DIR/node_modules" ] || (cd "$BACKEND_DIR" && npm install --no-package-lock --no-audit --no-fund)
[ -d "$MCP_DIR/node_modules" ] || (cd "$MCP_DIR" && npm install --no-package-lock --no-audit --no-fund)

# Ctrl+C (or one process dying) stops the whole group
trap 'trap - INT TERM; kill 0' INT TERM
label() { while IFS= read -r line; do printf '%s %s\n' "$1" "$line"; done; }

(cd "$BACKEND_DIR" && PORT=$BACKEND_PORT HOST=0.0.0.0 DEMO_MODE=true CORS_ORIGINS=$CORS_ORIGINS \
  ./node_modules/.bin/tsx src/server.ts 2>&1 | label '[backend]') &

until curl -s -o /dev/null "http://127.0.0.1:$BACKEND_PORT/health"; do sleep 0.5; done

# Bound to localhost: only the chat talks to it, and it refuses plain http to anything but a local backend
(cd "$MCP_DIR" && MCP_TRANSPORT=http HOST=127.0.0.1 PORT=$MCP_PORT KBC_API_URL=http://127.0.0.1:$BACKEND_PORT \
  ./node_modules/.bin/tsx src/index.ts 2>&1 | label '[mcp]') &

# ANTHROPIC_API_KEY (and CHAT_MODEL / CHAT_EFFORT) come from this repo's .env; values set here win
(cd chat && PORT=$CHAT_PORT KBC_API_URL=http://127.0.0.1:$BACKEND_PORT MCP_URL=http://127.0.0.1:$MCP_PORT/mcp \
  node --env-file-if-exists=../.env server.js 2>&1 | label '[chat]') &

cat <<EOF

Kate Studio PoC (no Docker). Demo password for every user: in4matics-must-win
  backend  http://localhost:$BACKEND_PORT   (API docs: /docs)
  chat     http://localhost:$CHAT_PORT/?app=kate
${LAN_IP:+  phone    http://$LAN_IP:$BACKEND_PORT (API) and http://$LAN_IP:$CHAT_PORT/?app=kate (chat), same Wi-Fi}

EOF
wait
