#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stack_dir="${repo_root}/infra/local-v1"
compose_file="${stack_dir}/compose.yaml"
env_file="${LOCAL_V1_ENV_FILE:-${stack_dir}/.env}"

# shellcheck source=scripts/lib/proof-server.sh
source "${repo_root}/scripts/lib/proof-server.sh"

if [[ ! -f "${env_file}" ]]; then
  env_file="${stack_dir}/.env.example"
fi

compose=(docker compose --env-file "${env_file}" -f "${compose_file}")

usage() {
  cat <<'EOF'
Usage: scripts/local-v1.sh <command> [service...]

Commands:
  config        Render and validate the Compose configuration
  pull          Pull the three pinned Midnight images
  up            Start the stack, wait for health, then run the smoke test
  down          Stop the stack without deleting its named data volumes
  ps            Show stack service state
  logs          Follow logs, optionally for named services
  smoke         Verify node runtime, indexer GraphQL, and proof-server version
EOF
}

command="${1:-}"
if [[ -n "${command}" ]]; then
  shift
fi

case "${command}" in
  config)
    "${compose[@]}" config
    ;;
  pull)
    "${compose[@]}" pull
    ;;
  up)
    stop_other_managed_proof_servers local-v1
    assert_proof_server_port_available local-v1
    "${compose[@]}" up -d --wait
    LOCAL_V1_ENV_FILE="${env_file}" "${repo_root}/scripts/smoke-local-v1.sh"
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
    LOCAL_V1_ENV_FILE="${env_file}" "${repo_root}/scripts/smoke-local-v1.sh"
    ;;
  *)
    usage
    exit 2
    ;;
esac
