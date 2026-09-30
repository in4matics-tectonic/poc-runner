#!/usr/bin/env bash
# One-time setup of the PoC on a Debian/Ubuntu VM. Safe to run again (e.g. to change a secret).
#
#   curl -fsSL https://raw.githubusercontent.com/in4matics-tectonic/poc-runner/main/deploy/bootstrap.sh \
#     | sudo env SITE_PASSWORD='…' ANTHROPIC_API_KEY='…' bash
#
# Optional: POC_DOMAIN (default: <external-ip>.sslip.io), INSTALL_DIR (default: /opt/poc-runner).
set -euo pipefail

INSTALL_DIR=${INSTALL_DIR:-/opt/poc-runner}
REPO=https://github.com/in4matics-tectonic/poc-runner.git

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

# --- Docker ---------------------------------------------------------------------------------------
if ! docker compose version >/dev/null 2>&1; then
  echo "installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git; }
systemctl enable --now docker

# --- Code -----------------------------------------------------------------------------------------
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone -q "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
git fetch -q origin main && git reset -q --hard origin/main

# --- .env: keep existing values, fill what's missing, override with what was passed in -----------
touch .env && chmod 600 .env
set_env() { # key value (value may contain any character)
  sed -i "/^$1=/d" .env
  printf '%s=%s\n' "$1" "$2" >>.env
}
get_env() { grep "^$1=" .env | cut -d= -f2- || true; }
random() { head -c "$1" /dev/urandom | base64 | tr -d '/+=\n'; }

[ -n "$(get_env JWT_SECRET)" ] || set_env JWT_SECRET "$(random 48)"
[ -n "$(get_env DEMO_PASSWORD)" ] || set_env DEMO_PASSWORD "$(random 12)"
[ -n "$(get_env GATE_SECRET)" ] || set_env GATE_SECRET "$(random 48)"
[ -n "${SITE_PASSWORD:-}" ] && set_env SITE_PASSWORD "$SITE_PASSWORD"
[ -n "${ANTHROPIC_API_KEY:-}" ] && set_env ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
[ -n "$(get_env SITE_PASSWORD)" ] || { echo "SITE_PASSWORD is required on the first run"; exit 1; }

if [ -z "${POC_DOMAIN:-}" ]; then
  ip=$(curl -fsS -H 'Metadata-Flavor: Google' \
    http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null ||
    curl -fsS https://api.ipify.org)
  POC_DOMAIN="${ip//./-}.sslip.io"
fi
set_env POC_DOMAIN "$POC_DOMAIN"

# --- Auto-deploy timer ----------------------------------------------------------------------------
cat >/etc/systemd/system/poc-autodeploy.service <<EOF
[Unit]
Description=KBC Momentum PoC: deploy what changed on GitHub
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$INSTALL_DIR/deploy/autodeploy.sh
TimeoutStartSec=1800
EOF

cat >/etc/systemd/system/poc-autodeploy.timer <<'EOF'
[Unit]
Description=KBC Momentum PoC: check GitHub for changes every 2 minutes

[Timer]
OnBootSec=30s
OnUnitInactiveSec=2min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now poc-autodeploy.timer
# A changed .env needs recreated containers: forget the deployed state so the next run redeploys all
rm -f .deploy-state/poc-runner
echo "first deploy (building everything, this takes a few minutes)…"
systemctl start poc-autodeploy.service || true

echo
echo "  https://$POC_DOMAIN"
echo "  site password: the SITE_PASSWORD you set · demo users' password: $(get_env DEMO_PASSWORD)"
echo "  logs: journalctl -u poc-autodeploy -f"
