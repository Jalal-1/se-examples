#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${LOCAL_V1_ENV_FILE:-${repo_root}/infra/local-v1/.env}"

if [[ ! -f "${env_file}" ]]; then
  env_file="${repo_root}/infra/local-v1/.env.example"
fi

set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

for dependency in curl jq; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    echo "Missing required command: ${dependency}" >&2
    exit 1
  fi
done

node_url="http://127.0.0.1:${MIDNIGHT_NODE_PORT:-9944}"
indexer_url="http://127.0.0.1:${MIDNIGHT_INDEXER_PORT:-8088}/api/v4/graphql"
proof_server_url="http://127.0.0.1:${MIDNIGHT_PROOF_SERVER_PORT:-6300}"

curl_with_retry() {
  local description="$1"
  shift
  local attempt
  local response

  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if response="$(curl --fail --silent --show-error "$@" 2>/dev/null)"; then
      printf '%s' "${response}"
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for ${description}" >&2
  return 1
}

runtime_response="$(
  curl_with_retry "local-v1 node RPC" \
    --header 'content-type: application/json' \
    --data '{"id":1,"jsonrpc":"2.0","method":"state_getRuntimeVersion","params":[]}' \
    "${node_url}"
)"

spec_version="$(jq -er '.result.specVersion' <<<"${runtime_response}")"
transaction_version="$(jq -er '.result.transactionVersion' <<<"${runtime_response}")"

if [[ "${spec_version}" != "${MIDNIGHT_EXPECTED_SPEC_VERSION:-1000000}" ]]; then
  echo "Unexpected runtime spec version: ${spec_version}" >&2
  exit 1
fi

if [[ "${transaction_version}" != "${MIDNIGHT_EXPECTED_TRANSACTION_VERSION:-3}" ]]; then
  echo "Unexpected transaction version: ${transaction_version}" >&2
  exit 1
fi

block_response="$(
  curl_with_retry "local-v1 block production" \
    --header 'content-type: application/json' \
    --data '{"id":2,"jsonrpc":"2.0","method":"chain_getBlockHash","params":[1]}' \
    "${node_url}"
)"
jq -e '.result | type == "string" and startswith("0x")' >/dev/null <<<"${block_response}"

indexer_response="$(
  curl_with_retry "local-v1 indexer GraphQL" \
    --header 'content-type: application/json' \
    --data '{"query":"query Smoke { __typename }"}' \
    "${indexer_url}"
)"
jq -e '.data.__typename and ((.errors // []) | length == 0)' >/dev/null <<<"${indexer_response}"

proof_server_version="$(curl_with_retry "local-v1 proof server" "${proof_server_url}/version")"
if [[ "${proof_server_version}" != "${MIDNIGHT_EXPECTED_PROOF_SERVER_VERSION:-8.1.0}" ]]; then
  echo "Unexpected proof-server version: ${proof_server_version}" >&2
  exit 1
fi

printf 'local-v1 healthy: runtime spec=%s transaction=%s, blocks=producing, indexer=v4, proof-server=%s\n' \
  "${spec_version}" \
  "${transaction_version}" \
  "${proof_server_version}"
