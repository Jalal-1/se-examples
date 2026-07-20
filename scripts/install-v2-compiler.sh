#!/usr/bin/env bash
set -euo pipefail

version="0.33.0-rc.2"
release="compactc-v${version}"
repository="https://github.com/LFDT-Minokawa/compact"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    target="x86_64-unknown-linux-musl"
    checksum="3055ab92bbc8d5bb0d6282b661b83761d2a0de2ee37e21cf7107e25aaf2a9aad"
    ;;
  Linux:aarch64 | Linux:arm64)
    target="aarch64-unknown-linux-musl"
    checksum="3aa23812b0b086dbce07da3931a40dcb01bec9676b1ceed7f2d0be370ab2dc46"
    ;;
  Darwin:x86_64)
    target="x86_64-darwin"
    checksum="dce1a57d82ce06208fcc5d9de5343f18c48654a5ff3acf6bafabe3d17bf1ef18"
    ;;
  Darwin:arm64)
    target="aarch64-darwin"
    checksum="35a28009c9a57d20902e4fcfd12f0ca9ea94338208954cf8bcd335652e24f382"
    ;;
  *)
    echo "Unsupported Compact compiler platform: $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

for dependency in compact curl unzip; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    echo "Missing required command: ${dependency}" >&2
    exit 1
  fi
done

compact_directory="${COMPACT_DIRECTORY:-${HOME}/.compact}"
install_directory="${compact_directory}/versions/${version}/${target}"
archive_name="compactc_v${version}_${target}.zip"
url="${repository}/releases/download/${release}/${archive_name}"

if compact compile "+${version}" --version >/dev/null 2>&1; then
  echo "Compact ${version} is already installed for ${target}."
  exit 0
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT
archive="${temporary_directory}/${archive_name}"

echo "Downloading ${release} for ${target}"
curl --fail --location --silent --show-error "${url}" --output "${archive}"

if command -v sha256sum >/dev/null 2>&1; then
  printf '%s  %s\n' "${checksum}" "${archive}" | sha256sum --check --status
else
  actual_checksum="$(shasum -a 256 "${archive}" | awk '{print $1}')"
  if [[ "${actual_checksum}" != "${checksum}" ]]; then
    echo "Compact compiler checksum mismatch." >&2
    exit 1
  fi
fi

mkdir -p "${install_directory}"
cp "${archive}" "${install_directory}/artifact.zip"
unzip -oq "${archive}" -d "${install_directory}"
chmod +x "${install_directory}/compactc" \
  "${install_directory}/compactc.bin" \
  "${install_directory}/fixup-compact" \
  "${install_directory}/format-compact" \
  "${install_directory}/zkir" \
  "${install_directory}/zkir-v3"

reported_version="$(compact compile "+${version}" --version)"
if [[ "${reported_version}" != "0.33.0" && "${reported_version}" != "${version}" ]]; then
  echo "Compact ${version} installation failed (reported ${reported_version})." >&2
  exit 1
fi

echo "Installed Compact ${version} for ${target}."
