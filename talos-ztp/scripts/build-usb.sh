#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: build-usb.sh --device /dev/sdX --talos-installer TALOS_ISO --config-dir ./talos/generated [--image-bundle ./images.tar]

This script writes a Talos installer image to USB and stages Talos configs for day-0 bootstrap.
USAGE
}

device=""
talos_installer=""
config_dir=""
image_bundle=""

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
    --config-dir)
      config_dir="$2"
      shift 2
      ;;
    --image-bundle)
      image_bundle="$2"
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

if [[ -z "$device" || -z "$talos_installer" || -z "$config_dir" ]]; then
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

if [[ ! -d "$config_dir" ]]; then
  echo "Talos config dir $config_dir not found." >&2
  exit 1
fi

read -r -p "This will erase $device. Type 'ERASE' to continue: " confirm
if [[ "$confirm" != "ERASE" ]]; then
  echo "Aborted." >&2
  exit 1
fi

sudo dd if="$talos_installer" of="$device" bs=4M status=progress oflag=sync
sudo partprobe "$device"

fs_type="$(lsblk -no FSTYPE "${device}1" | head -n 1)"
if [[ -z "$fs_type" ]]; then
  echo "Unable to detect filesystem type on ${device}1 after imaging." >&2
  exit 1
fi
echo "Detected filesystem type on ${device}1: ${fs_type}"

# Mount the USB to copy configs (assumes partition 1 for staging)

mount_point=$(mktemp -d)
trap 'sudo umount "$mount_point"; rmdir "$mount_point"' EXIT

sudo mount "${device}1" "$mount_point"

sudo mkdir -p "$mount_point/talos"
sudo cp -a "$config_dir"/* "$mount_point/talos/"

if [[ -n "$image_bundle" ]]; then
  if [[ ! -f "$image_bundle" ]]; then
    echo "Image bundle $image_bundle not found." >&2
    exit 1
  fi
  sudo cp -a "$image_bundle" "$mount_point/talos/images.tar"
fi

sync

cat <<'NOTICE'
USB preparation complete.
- Boot each host from the USB stick.
- Install Talos to the OS disk.
- Apply the configs stored under /talos on the USB.
NOTICE
