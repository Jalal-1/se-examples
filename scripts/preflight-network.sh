#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="${1:-}"
proof_check="${2:-}"
profile_file="${repo_root}/network-profiles/${profile}/network.json"

usage() {
  echo "Usage: scripts/preflight-network.sh <profile> [--proof]" >&2
}

if [[ -z "${profile}" || ! -f "${profile_file}" ]]; then
  usage
  exit 2
fi

if [[ -n "${proof_check}" && "${proof_check}" != "--proof" ]]; then
  usage
  exit 2
fi

for dependency in curl jq; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    echo "Missing required command: ${dependency}" >&2
    exit 1
  fi
done

node_url="$(jq -er '.endpoints.node' "${profile_file}")"
indexer_url="$(jq -er '.endpoints.indexer' "${profile_file}")"
expected_spec_name="$(jq -er '.runtime.specName' "${profile_file}")"
expected_spec_version="$(jq -er '.runtime.specVersion' "${profile_file}")"
expected_transaction_version="$(jq -er '.runtime.transactionVersion' "${profile_file}")"

curl_with_retry() {
  local description="$1"
  shift
  local attempt
  local response

  for ((attempt = 1; attempt <= 15; attempt += 1)); do
    if response="$(
      curl \
        --connect-timeout 10 \
        --max-time 30 \
        --fail \
        --silent \
        --show-error \
        "$@" 2>/dev/null
    )"; then
      printf '%s' "${response}"
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for ${description}" >&2
  return 1
}

rpc_call() {
  local description="$1"
  local body="$2"
  curl_with_retry "${description}" \
    --header 'content-type: application/json' \
    --data "${body}" \
    "${node_url}"
}

runtime_response="$(
  rpc_call \
    "${profile} runtime RPC" \
    '{"id":1,"jsonrpc":"2.0","method":"state_getRuntimeVersion","params":[]}'
)"
spec_name="$(jq -er '.result.specName' <<<"${runtime_response}")"
spec_version="$(jq -er '.result.specVersion' <<<"${runtime_response}")"
transaction_version="$(jq -er '.result.transactionVersion' <<<"${runtime_response}")"

if [[ "${spec_name}" != "${expected_spec_name}" ]]; then
  echo "${profile}: expected spec name ${expected_spec_name}, got ${spec_name}" >&2
  exit 1
fi
if [[ "${spec_version}" != "${expected_spec_version}" ]]; then
  echo "${profile}: expected spec version ${expected_spec_version}, got ${spec_version}" >&2
  exit 1
fi
if [[ "${transaction_version}" != "${expected_transaction_version}" ]]; then
  echo "${profile}: expected transaction version ${expected_transaction_version}, got ${transaction_version}" >&2
  exit 1
fi

node_version_response="$(
  rpc_call \
    "${profile} node version RPC" \
    '{"id":2,"jsonrpc":"2.0","method":"system_version","params":[]}'
)"
node_version="$(jq -er '.result' <<<"${node_version_response}")"

header_response="$(
  rpc_call \
    "${profile} latest block RPC" \
    '{"id":3,"jsonrpc":"2.0","method":"chain_getHeader","params":[]}'
)"
block_number="$(jq -er '.result.number' <<<"${header_response}")"

indexer_response="$(
  curl_with_retry "${profile} indexer GraphQL" \
    --header 'content-type: application/json' \
    --data '{"query":"query Preflight { __typename }"}' \
    "${indexer_url}"
)"
jq -e '.data.__typename and ((.errors // []) | length == 0)' >/dev/null <<<"${indexer_response}"

proof_summary=""
if [[ "${proof_check}" == "--proof" ]]; then
  proof_server_url="$(jq -er '.endpoints.proofServer' "${profile_file}")"
  expected_proof_version="$(jq -er '.components.proofServer.version' "${profile_file}")"
  expected_proof_version="${expected_proof_version%_experimental}"
  proof_version="$(
    curl_with_retry "${profile} proof server" "${proof_server_url}/version"
  )"
  if [[ "${proof_version}" != "${expected_proof_version}" ]]; then
    echo "${profile}: expected proof server ${expected_proof_version}, got ${proof_version}" >&2
    exit 1
  fi
  proof_summary=", proof-server=${proof_version}"
fi

printf '%s healthy: node=%s, block=%s, runtime=%s/%s, transaction=%s, indexer=v4%s\n' \
  "${profile}" \
  "${node_version}" \
  "${block_number}" \
  "${spec_name}" \
  "${spec_version}" \
  "${transaction_version}" \
  "${proof_summary}"
