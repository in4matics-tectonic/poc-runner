#!/usr/bin/env sh
# Starts the whole Kate Studio PoC. Extra args go to `docker compose up` (e.g. ./run.sh -d).
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  secret() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))" 2>/dev/null \
    || head -c "$1" /dev/urandom | base64 | tr -d '/+=\n'; }
  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$(secret 48)|" .env && rm -f .env.bak
  echo "Created .env with random secrets. Add ANTHROPIC_API_KEY to it to enable the chat."
fi

echo "Demo password (all users): in4matics-must-win"
echo "Open http://localhost:$(grep -E '^GATEWAY_PORT=' .env | cut -d= -f2- || true)" | sed 's|localhost:$|localhost:7000|'
exec docker compose up --build "$@"
