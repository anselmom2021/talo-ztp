#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-iso.sh --config-dir ./talos/generated [--image-bundle ./images.tar] [--output ./talos-seed.iso] [--label TALOS_ZTP]

This script creates a small "seed" ISO for local VMs that mirrors the USB layout:
- /talos contains the generated machine configs
- /talos/images.tar contains an optional image bundle

Attach the generated ISO as a secondary CD-ROM in your VM while booting from the Talos installer ISO.
USAGE
}

config_dir=""
image_bundle=""
output="./talos-seed.iso"
label="TALOS_ZTP"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-dir)
      config_dir="$2"
      shift 2
      ;;
    --image-bundle)
      image_bundle="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    --label)
      label="$2"
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

if [[ -z "$config_dir" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ ! -d "$config_dir" ]]; then
  echo "Talos config dir $config_dir not found." >&2
  exit 1
fi

if [[ -n "$image_bundle" && ! -f "$image_bundle" ]]; then
  echo "Image bundle $image_bundle not found." >&2
  exit 1
fi

output_dir="$(dirname "$output")"
if [[ "$output_dir" != "." ]]; then
  mkdir -p "$output_dir"
fi

staging_dir="$(mktemp -d)"
trap 'rm -rf "$staging_dir"' EXIT

mkdir -p "$staging_dir/talos"
cp -a "$config_dir"/. "$staging_dir/talos/"

if [[ -n "$image_bundle" ]]; then
  cp -a "$image_bundle" "$staging_dir/talos/images.tar"
fi

if command -v xorriso >/dev/null 2>&1; then
  xorriso -as mkisofs -r -J -V "$label" -o "$output" "$staging_dir"
elif command -v mkisofs >/dev/null 2>&1; then
  mkisofs -r -J -V "$label" -o "$output" "$staging_dir"
elif command -v genisoimage >/dev/null 2>&1; then
  genisoimage -r -J -V "$label" -o "$output" "$staging_dir"
elif command -v hdiutil >/dev/null 2>&1; then
  hdiutil makehybrid -iso -joliet -default-volume-name "$label" -o "$output" "$staging_dir" >/dev/null
else
  echo "No ISO creation tool found (xorriso, mkisofs, genisoimage, or hdiutil)." >&2
  exit 1
fi

cat <<NOTICE
Seed ISO created at $output.
Attach it as a secondary CD-ROM in your VM alongside the Talos installer ISO.
NOTICE
