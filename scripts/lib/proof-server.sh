#!/usr/bin/env bash

containers_publishing_host_port() {
  local host_port="$1"
  local container_id
  local published_ports

  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    published_ports="$(
      docker inspect \
        --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{println .HostPort}}{{end}}{{end}}' \
        "${container_id}"
    )"
    if grep -qx "${host_port}" <<<"${published_ports}"; then
      printf '%s\n' "${container_id}"
    fi
  done < <(docker ps --quiet)
}

stop_other_managed_proof_servers() {
  local desired_profile="$1"
  local host_port="${2:-6300}"
  local container_id
  local current_profile
  local container_name

  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    current_profile="$(
      docker inspect \
        --format '{{ index .Config.Labels "io.se-examples.network-profile" }}' \
        "${container_id}" 2>/dev/null || true
    )"
    if [[ -n "${current_profile}" && "${current_profile}" != "${desired_profile}" ]]; then
      container_name="$(docker inspect --format '{{.Name}}' "${container_id}")"
      echo "Stopping managed ${current_profile} proof server ${container_name#/}"
      docker stop "${container_id}" >/dev/null
    fi
  done < <(containers_publishing_host_port "${host_port}")
}

assert_proof_server_port_available() {
  local desired_profile="$1"
  local host_port="${2:-6300}"
  local container_id
  local current_profile
  local container_name

  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    current_profile="$(
      docker inspect \
        --format '{{ index .Config.Labels "io.se-examples.network-profile" }}' \
        "${container_id}" 2>/dev/null || true
    )"
    if [[ "${current_profile}" != "${desired_profile}" ]]; then
      container_name="$(docker inspect --format '{{.Name}}' "${container_id}")"
      echo "Host port ${host_port} is already owned by ${container_name#/}." >&2
      echo "Stop that container before starting the ${desired_profile} proof server." >&2
      return 1
    fi
  done < <(containers_publishing_host_port "${host_port}")
}
