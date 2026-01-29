#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: generate-config.sh --cluster-name NAME --vip VIP --endpoint ENDPOINT --talos-version VERSION --k8s-version VERSION

Example:
  ./scripts/generate-config.sh \
    --cluster-name talo-ztp \
    --vip 10.0.0.10 \
    --endpoint https://10.0.0.10:6443 \
    --talos-version v1.7.6 \
    --k8s-version v1.30.2
USAGE
}

cluster_name=""
vip=""
endpoint=""
talos_version=""
k8s_version=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cluster-name)
      cluster_name="$2"
      shift 2
      ;;
    --vip)
      vip="$2"
      shift 2
      ;;
    --endpoint)
      endpoint="$2"
      shift 2
      ;;
    --talos-version)
      talos_version="$2"
      shift 2
      ;;
    --k8s-version)
      k8s_version="$2"
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

if [[ -z "$cluster_name" || -z "$vip" || -z "$endpoint" || -z "$talos_version" || -z "$k8s_version" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if ! command -v talosctl >/dev/null 2>&1; then
  echo "talosctl is required but not installed." >&2
  exit 1
fi

output_dir="./talos/generated"
mkdir -p "$output_dir"

# Generate base configs

talosctl gen config "$cluster_name" "$endpoint" \
  --output-dir "$output_dir" \
  --talos-version "$talos_version" \
  --kubernetes-version "$k8s_version"

# Apply patches for control-plane and worker nodes

for role in controlplane worker; do
  patch_file="./talos/patches/${role}.yaml"
  if [[ -f "$patch_file" ]]; then
    talosctl machineconfig patch "$output_dir/${role}.yaml" --patch "@${patch_file}" > "$output_dir/${role}.patched.yaml"
    mv "$output_dir/${role}.patched.yaml" "$output_dir/${role}.yaml"
  fi
  done

# Apply shared machine settings (VIP, disks)

talosctl machineconfig patch "$output_dir/controlplane.yaml" --patch "@./talos/patches/machine.yaml" > "$output_dir/controlplane.patched.yaml"

mv "$output_dir/controlplane.patched.yaml" "$output_dir/controlplane.yaml"

cat <<'NOTICE'
Generated Talos configs in ./talos/generated.
Reminder: update node-specific settings (IP addresses, disk selectors) before applying.
NOTICE
