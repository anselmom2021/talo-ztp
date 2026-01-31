#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-config-disk.sh --machine-config ./talos/generated/controlplane.yaml [--output ./talos-config.img] [--size 16M]

Creates a small FAT disk image labeled "metal-iso" with config.yaml at the root.
Use this as a secondary disk in UTM if the config ISO is not detected.
USAGE
}

machine_config=""
output="./talos-config.img"
size="64M"

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
    --size)
      size="$2"
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

if command -v hdiutil >/dev/null 2>&1; then
  if ! hdiutil create -size "$size" -fs "MS-DOS" -volname "metal-iso" -ov "$output" >/dev/null; then
    if command -v truncate >/dev/null 2>&1; then
      truncate -s "$size" "$output"
    else
      dd if=/dev/zero of="$output" bs=1 count=0 seek="$size" >/dev/null 2>&1
    fi
    raw_dev="$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nomount "$output" 2>/dev/null | awk 'NR==1{print $1}')"
    if [[ -z "$raw_dev" ]]; then
      echo "Failed to attach raw disk image." >&2
      exit 1
    fi
    diskutil eraseVolume FAT32 metal-iso "$raw_dev" >/dev/null
  fi

  mount_point="$(hdiutil attach -nobrowse "$output" 2>/dev/null | awk '/\\/Volumes\\//{print $3; exit}')"
  if [[ -z "$mount_point" ]]; then
    echo "Failed to mount disk image." >&2
    exit 1
  fi
  cp "$machine_config" "$mount_point/config.yaml"
  sync
  hdiutil detach "$mount_point" >/dev/null
else
  if ! command -v mkfs.vfat >/dev/null 2>&1; then
    echo "mkfs.vfat is required on non-macOS systems." >&2
    exit 1
  fi
  if ! command -v mcopy >/dev/null 2>&1; then
    echo "mcopy (mtools) is required on non-macOS systems." >&2
    exit 1
  fi
  dd if=/dev/zero of="$output" bs=1 count=0 seek="$size" >/dev/null 2>&1
  mkfs.vfat -n "metal-iso" "$output" >/dev/null
  mcopy -i "$output" "$machine_config" ::config.yaml
fi

echo "Config disk image created at $output (label: metal-iso, file: config.yaml)."
