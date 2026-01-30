#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-images-bundle.sh --images-file ./scripts/images.txt --output ./image-cache.oci [--platform linux/amd64] [--layer-cache ./layer-cache]

Builds a Talos image cache (OCI layout) from the list of image references.
USAGE
}

images_file=""
output="image-cache.oci"
platform=""
layer_cache=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --images-file)
      images_file="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    --platform)
      platform="$2"
      shift 2
      ;;
    --layer-cache)
      layer_cache="$2"
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

if [[ -z "$images_file" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ ! -f "$images_file" ]]; then
  echo "Images file $images_file not found." >&2
  exit 1
fi

if ! command -v talosctl >/dev/null 2>&1; then
  echo "talosctl is required but not installed." >&2
  exit 1
fi

images=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  images+=("$line")
done < "$images_file"

if [[ "${#images[@]}" -eq 0 ]]; then
  echo "No images found in $images_file." >&2
  exit 1
fi

talosctl_args=(images cache-create --image-cache-path "$output" --images=-)

if [[ -n "$platform" ]]; then
  talosctl_args+=(--platform "$platform")
fi

if [[ -n "$layer_cache" ]]; then
  talosctl_args+=(--image-layer-cache-path "$layer_cache")
fi

printf "%s\n" "${images[@]}" | talosctl "${talosctl_args[@]}"

echo "Image cache written to $output."
