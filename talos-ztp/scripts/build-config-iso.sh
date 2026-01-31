#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-config-iso.sh --machine-config ./talos/generated/controlplane.yaml [--output ./talos-config.iso]

Creates a "metal-iso" config ISO that Talos can read when booted with:
  talos.config=metal-iso
USAGE
}

machine_config=""
output="./talos-config.iso"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --machine-config)
      machine_config="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$machine_config" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ ! -f "$machine_config" ]]; then
  echo "Machine config $machine_config not found." >&2
  exit 1
fi

output_dir="$(dirname "$output")"
if [[ "$output_dir" != "." ]]; then
  mkdir -p "$output_dir"
fi

staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

cp "$machine_config" "$staging_dir/config.yaml"

if command -v xorriso >/dev/null 2>&1; then
  xorriso -as mkisofs -r -J -V "metal-iso" -o "$output" "$staging_dir"
elif command -v mkisofs >/dev/null 2>&1; then
  mkisofs -r -J -V "metal-iso" -o "$output" "$staging_dir"
elif command -v genisoimage >/dev/null 2>&1; then
  genisoimage -r -J -V "metal-iso" -o "$output" "$staging_dir"
elif command -v hdiutil >/dev/null 2>&1; then
  hdiutil makehybrid -iso -joliet -default-volume-name "metal-iso" -o "$output" "$staging_dir" >/dev/null
else
  echo "No ISO creation tool found (xorriso, mkisofs, genisoimage, or hdiutil)." >&2
  exit 1
fi

echo "Config ISO created at $output (label: metal-iso, file: config.yaml)."
