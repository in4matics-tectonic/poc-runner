#!/usr/bin/env bash
# Runs every 2 minutes on the VM (systemd timer). Rebuilds and restarts whatever changed on GitHub:
#   - poc-runner itself changed        → pull it and act on the files that changed (see needs())
#   - a project repo's main moved on   → rebuild only that service
# Builds use the exact commit that was checked, so what's recorded is what runs.
# Every restart reloads the panes of whoever has the showcase open, so nothing restarts that didn't change.
set -euo pipefail

ORG=https://github.com/in4matics-tectonic
declare -A REPO=([backend]=backend [mcp]=mcp [app]=mobile-app [backoffice]=backoffice)
declare -A SRC_VAR=([backend]=BACKEND_SRC [mcp]=MCP_SRC [app]=APP_SRC [backoffice]=BACKOFFICE_SRC)
# Services from this repo; on a full deploy they're brought up to date (recreated only if their config changed)
LOCAL_SERVICES=(chat gateway gate caddy)

# What a pulled change to one file of this repo needs: `build:<svc>`, `restart:<svc>`, `all`, or nothing.
# gateway/public and gate/ are mounted (gate runs with --watch), so they're live as soon as they're pulled.
# Anything not listed gets the full deploy, the safe default.
needs() {
  case "$1" in
    *.md | .gitignore | .env.example | run.sh | deploy/bootstrap.sh | deploy/autodeploy.sh | gateway/public/* | gate/*) ;;
    gateway/nginx.conf.template) echo restart:gateway ;;
    deploy/Caddyfile) echo restart:caddy ;;
    chat/*) echo build:chat ;;
    docker/mcp.Dockerfile) echo build:mcp ;;
    docker/backoffice.Dockerfile) echo build:backoffice ;;
    docker/mobile-app.Dockerfile) echo build:app ;;
    docker/spa.nginx.conf) echo build:app build:backoffice ;;
    *) echo all ;;
  esac
}

# Everything lives in main() so a `git reset` of this file mid-run can't change what bash executes
main() {
  cd "$(dirname "$0")/.."
  exec 9>/tmp/poc-autodeploy.lock
  flock -n 9 || { echo "another deploy is running"; exit 0; }

  local state=.deploy-state
  mkdir -p "$state"
  local compose=(docker compose -f docker-compose.yml -f docker-compose.vm.yml)
  local changed=() all=false pulled=false build=() restart=()

  git fetch -q origin main
  local last head files="" f word
  last=$(cat "$state/poc-runner" 2>/dev/null || true)
  head=$(git rev-parse origin/main)
  if [ "$last" != "$head" ]; then
    pulled=true
    # First deploy, or a recorded commit we can't diff against: do everything
    if [ -z "$last" ] || ! files=$(git diff --name-only "$last" "$head" 2>/dev/null); then all=true; fi
    git reset -q --hard "$head"
    for word in $(while read -r f; do [ -z "$f" ] || needs "$f"; done <<<"$files"); do
      case "$word" in
        all) all=true ;;
        build:*) build+=("${word#build:}") ;;
        restart:*) restart+=("${word#restart:}") ;;
      esac
    done
    echo "poc-runner ${last:0:7} → ${head:0:7}: $($all && echo "full deploy" || echo "build: ${build[*]:-none}, restart: ${restart[*]:-none}")"
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
    if $all || [[ " ${build[*]} " == *" $svc "* ]] || [ "$sha" != "$(cat "$state/$svc" 2>/dev/null)" ]; then changed+=("$svc"); fi
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
  # chat is the only image built from this repo
  if $all || [[ " ${build[*]} " == *" chat "* ]]; then
    if "${compose[@]}" build chat; then up+=(chat); else echo "BUILD FAILED: chat, keeping the running version"; fi
  fi
  $all && up+=(gateway gate caddy)

  if [ ${#up[@]} -gt 0 ]; then
    echo "starting: ${up[*]}"
    # Backend before mcp (shared network namespace)
    local ordered=()
    for svc in backend mcp app backoffice "${LOCAL_SERVICES[@]}"; do
      [[ " ${up[*]} " == *" $svc "* ]] && ordered+=("$svc")
    done
    # Only recreates containers whose image or config changed
    "${compose[@]}" up -d --no-deps --no-build "${ordered[@]}"
  fi
  # Mounted config that's only read at start (the gateway's nginx template, the Caddyfile)
  if [ ${#restart[@]} -gt 0 ]; then
    mapfile -t restart < <(printf '%s\n' "${restart[@]}" | sort -u)
    echo "restarting: ${restart[*]}"
    "${compose[@]}" restart "${restart[@]}"
  fi

  for svc in "${up[@]}"; do
    [ -n "${REPO[$svc]:-}" ] && echo "${!SRC_VAR[$svc]##*#}" >"$state/$svc"
  done
  $pulled && echo "$head" >"$state/poc-runner"
  if [ ${#up[@]} -gt 0 ]; then
    docker image prune -f >/dev/null
    echo "deployed: ${up[*]}"
  fi
}

main "$@"
