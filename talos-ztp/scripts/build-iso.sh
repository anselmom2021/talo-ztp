#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-iso.sh --machine-config ./talos/generated/controlplane.yaml [--image-cache ./image-cache.oci] [--talos-version v1.12.2] [--arch amd64] [--output ./talos-controlplane.iso]

Build a Talos installer ISO with embedded machine config and optional image cache.
USAGE
}

machine_config=""
image_cache=""
talos_version="v1.12.2"
arch="amd64"
output="./talos-boot.iso"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --machine-config)
      machine_config="$2"
      shift 2
      ;;
    --image-cache)
      image_cache="$2"
      shift 2
      ;;
    --talos-version)
      talos_version="$2"
      shift 2
      ;;
    --arch)
      arch="$2"
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

if [[ -n "$image_cache" && ! -d "$image_cache" ]]; then
  echo "Image cache $image_cache not found or not a directory." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run the Talos imager." >&2
  exit 1
fi

output_dir="$(dirname "$output")"
if [[ "$output_dir" != "." ]]; then
  mkdir -p "$output_dir"
fi

temp_out="$(mktemp -d)"
trap 'rm -rf "$temp_out"' EXIT

imager_image="ghcr.io/siderolabs/imager:${talos_version}"

docker_args=(
  run --rm -t
  -v "$temp_out":/out
)

cp "$machine_config" "$temp_out/machine-config.yaml"

imager_args=(iso --arch "$arch")

if [[ -n "$image_cache" ]]; then
  cache_dir="$(cd "$image_cache" && pwd)"
  docker_args+=(-v "$cache_dir":/image-cache:ro)
  imager_args+=(--image-cache /image-cache)
fi

docker "${docker_args[@]}" "$imager_image" "${imager_args[@]}"

iso_path="$(ls -t "$temp_out"/*.iso 2>/dev/null | head -n 1 || true)"
if [[ -z "$iso_path" ]]; then
  echo "No ISO produced by imager in $temp_out." >&2
  exit 1
fi

cp "$iso_path" "$output"

cat <<NOTICE
Bootable Talos ISO created at $output.
Use this ISO to boot the node directly (USB or VM).
NOTICE
