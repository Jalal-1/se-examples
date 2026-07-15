#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repo_root}/infra/hosted/compose.yaml"
profile="${1:-}"
command="${2:-}"

usage() {
  cat <<'EOF'
Usage: scripts/hosted-network.sh <preview|preprod|stagenet> <command>

Commands:
  config       Render and validate the profile's proof-server configuration
  preflight    Verify the remote node runtime and indexer GraphQL endpoint
  pull         Pull the profile's pinned proof-server image
  up           Preflight, switch the managed local prover, and verify all endpoints
  down         Remove this profile's local proof-server container
  ps           Show this profile's local proof-server state
  logs         Follow this profile's proof-server logs
  smoke        Verify remote services and the running local proof server
EOF
}

case "${profile}" in
  preview | preprod | stagenet) ;;
  *)
    usage
    exit 2
    ;;
esac

if [[ -z "${command}" ]]; then
  usage
  exit 2
fi

for dependency in docker jq; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    echo "Missing required command: ${dependency}" >&2
    exit 1
  fi
done

profile_file="${repo_root}/network-profiles/${profile}/network.json"
if [[ "$(jq -er '.mode' "${profile_file}")" != "hosted" ]]; then
  echo "${profile} is not a hosted profile" >&2
  exit 1
fi

proof_server_image="$(jq -er '.components.proofServer.image' "${profile_file}")"
project_name="se-examples-${profile}"

# shellcheck source=scripts/lib/proof-server.sh
source "${repo_root}/scripts/lib/proof-server.sh"

compose() {
  COMPOSE_PROJECT_NAME="${project_name}" \
    MIDNIGHT_PROFILE="${profile}" \
    MIDNIGHT_PROOF_SERVER_IMAGE="${proof_server_image}" \
    docker compose -f "${compose_file}" "$@"
}

case "${command}" in
  config)
    compose config
    ;;
  preflight)
    "${repo_root}/scripts/preflight-network.sh" "${profile}"
    ;;
  pull)
    compose pull
    ;;
  up)
    "${repo_root}/scripts/preflight-network.sh" "${profile}"
    stop_other_managed_proof_servers "${profile}"
    assert_proof_server_port_available "${profile}"
    compose up -d --wait
    "${repo_root}/scripts/preflight-network.sh" "${profile}" --proof
    ;;
  down)
    compose down
    ;;
  ps)
    compose ps
    ;;
  logs)
    compose logs --tail=200 --follow
    ;;
  smoke)
    "${repo_root}/scripts/preflight-network.sh" "${profile}" --proof
    ;;
  *)
    usage
    exit 2
    ;;
esac
