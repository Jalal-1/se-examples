#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stack_dir="${repo_root}/infra/local-v2"
compose_file="${stack_dir}/compose.yaml"
env_file="${LOCAL_V2_ENV_FILE:-${stack_dir}/.env}"

# shellcheck source=scripts/lib/proof-server.sh
source "${repo_root}/scripts/lib/proof-server.sh"

if [[ ! -f "${env_file}" ]]; then
  env_file="${stack_dir}/.env.example"
fi

compose=(docker compose --env-file "${env_file}" -f "${compose_file}")

usage() {
  cat <<'EOF'
Usage: scripts/local-v2.sh <command> [service...]

Commands:
  config        Render and validate the Compose configuration
  pull          Pull the three pinned Midnight v2 images
  up            Start the stack, wait for health, then run the smoke test
  down          Stop the stack without deleting its named data volumes
  ps            Show stack service state
  logs          Follow logs, optionally for named services
  smoke         Verify runtime v2, indexer GraphQL, and experimental prover
EOF
}

command="${1:-}"
if [[ -n "${command}" ]]; then shift; fi

case "${command}" in
  config)
    "${compose[@]}" config
    ;;
  pull)
    "${compose[@]}" pull
    ;;
  up)
    if [[ -n "$(docker ps --quiet --filter label=io.se-examples.network-profile=local-v1)" ]]; then
      echo "Stopping the local-v1 stack before switching shared ports to local-v2"
      "${repo_root}/scripts/local-v1.sh" down
    fi
    stop_other_managed_proof_servers local-v2
    assert_proof_server_port_available local-v2
    if ! "${compose[@]}" up -d --wait; then
      echo "Local v2 services are settling after genesis; retrying readiness once"
      "${compose[@]}" up -d --wait
    fi
    "${repo_root}/scripts/preflight-network.sh" local-v2 --proof
    ;;
  down)
    "${compose[@]}" down
    ;;
  ps)
    "${compose[@]}" ps
    ;;
  logs)
    "${compose[@]}" logs --tail=200 --follow "$@"
    ;;
  smoke)
    "${repo_root}/scripts/preflight-network.sh" local-v2 --proof
    ;;
  *)
    usage
    exit 2
    ;;
esac
