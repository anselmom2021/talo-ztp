#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-usb.sh --device /dev/sdX --talos-installer TALOS_ISO

This script writes a Talos installer ISO (with embedded config and optional image cache) to USB.
USAGE
}

device=""
talos_installer=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      device="$2"
      shift 2
      ;;
    --talos-installer)
      talos_installer="$2"
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

if [[ -z "$device" || -z "$talos_installer" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ ! -b "$device" ]]; then
  echo "Device $device not found or not a block device." >&2
  exit 1
fi

if [[ ! -f "$talos_installer" ]]; then
  echo "Talos installer image $talos_installer not found." >&2
  exit 1
fi

read -r -p "This will erase $device. Type 'ERASE' to continue: " confirm
if [[ "$confirm" != "ERASE" ]]; then
  echo "Aborted." >&2
  exit 1
fi

sudo dd if="$talos_installer" of="$device" bs=4M status=progress oflag=sync
sudo partprobe "$device"

sync

cat <<'NOTICE'
USB preparation complete.
- Boot each host from the USB stick.
- Install Talos to the OS disk.
NOTICE
