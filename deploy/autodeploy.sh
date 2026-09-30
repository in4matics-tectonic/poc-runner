#!/usr/bin/env bash
# Runs every 2 minutes on the VM (systemd timer). Rebuilds and restarts whatever changed on GitHub:
#   - poc-runner itself changed        → pull it and rebuild everything
#   - a project repo's main moved on   → rebuild only that service
# Builds use the exact commit that was checked, so what's recorded is what runs.
set -euo pipefail

ORG=https://github.com/in4matics-tectonic
declare -A REPO=([backend]=backend [mcp]=mcp [app]=mobile-app [backoffice]=backoffice)
declare -A SRC_VAR=([backend]=BACKEND_SRC [mcp]=MCP_SRC [app]=APP_SRC [backoffice]=BACKOFFICE_SRC)
# Services built from this repo; rebuilt when poc-runner changes
LOCAL_SERVICES=(chat gateway gate caddy)

# Everything lives in main() so a `git reset` of this file mid-run can't change what bash executes
main() {
  cd "$(dirname "$0")/.."
  exec 9>/tmp/poc-autodeploy.lock
  flock -n 9 || { echo "another deploy is running"; exit 0; }

  local state=.deploy-state
  mkdir -p "$state"
  local compose=(docker compose -f docker-compose.yml -f docker-compose.vm.yml)
  local changed=() all=false

  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] || [ ! -f "$state/poc-runner" ]; then
    git reset -q --hard origin/main
    all=true
  fi

  for svc in "${!REPO[@]}"; do
    local sha
    sha=$(git ls-remote "$ORG/${REPO[$svc]}.git" refs/heads/main | cut -f1) || true
    if [ -z "$sha" ]; then
      echo "skip $svc: no main branch on GitHub (yet)"
      continue
    fi
    # Pin the build to the commit we just saw
    export "${SRC_VAR[$svc]}=$ORG/${REPO[$svc]}.git#$sha"
    if $all || [ "$sha" != "$(cat "$state/$svc" 2>/dev/null)" ]; then changed+=("$svc"); fi
  done
  # mcp lives in the backend's network namespace: a new backend container needs a new mcp container
  if [[ " ${changed[*]} " == *" backend "* && " ${changed[*]} " != *" mcp "* ]]; then changed+=(mcp); fi

  local up=()
  for svc in "${changed[@]}"; do
    echo "building $svc (${!SRC_VAR[$svc]##*#})"
    if "${compose[@]}" build "$svc"; then
      up+=("$svc")
    else
      echo "BUILD FAILED: $svc, keeping the running version"
    fi
  done
  $all && up+=("${LOCAL_SERVICES[@]}") && "${compose[@]}" build chat

  if [ ${#up[@]} -eq 0 ]; then return 0; fi
  echo "starting: ${up[*]}"
  # Backend before mcp (shared network namespace)
  local ordered=()
  for svc in backend mcp app backoffice "${LOCAL_SERVICES[@]}"; do
    [[ " ${up[*]} " == *" $svc "* ]] && ordered+=("$svc")
  done
  "${compose[@]}" up -d --no-deps --no-build "${ordered[@]}"
  # The gateway's nginx config is a mounted template, rendered only at start: pick up changes to it
  if $all; then "${compose[@]}" restart gateway; fi

  for svc in "${up[@]}"; do
    [ -n "${REPO[$svc]:-}" ] && echo "${!SRC_VAR[$svc]##*#}" >"$state/$svc"
  done
  $all && git rev-parse HEAD >"$state/poc-runner"
  docker image prune -f >/dev/null
  echo "deployed: ${ordered[*]}"
}

main "$@"
