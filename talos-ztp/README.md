Talos Linux zero-touch provisioning (ZTP) for a 3-node bare-metal AMD64 cluster with day-0 USB deployment and day-1 GitOps using Rancher Fleet. The design minimizes external dependencies by bundling required assets on a USB stick and keeping post-install automation within a GitOps repository.

## Goals

- **USB-deployable** Talos Linux for three bare-metal nodes (control-plane + worker).
- **Minimal internet dependency** by preloading images and manifests on the USB stick.
- **Dedicated OS and data disks** (data disk for Longhorn). 
- **Internal L3 VIP** (kube-vip) for the Kubernetes control plane.
- **Longhorn**, **KubeVirt**, **CDI**, and **Multus** managed via Rancher Fleet.
- **GitOps-first** day-1 configuration and application delivery.

## Repository Layout

```
.
├── docs/
│   └── architecture.md
├── scripts/
│   ├── build-usb.sh
│   └── generate-config.sh
├── talos/
│   └── patches/
│       ├── controlplane.yaml
│       ├── machine.yaml
│       └── worker.yaml
├── manifests/
│   ├── cdi/
│   ├── kube-vip/
│   ├── kubevirt/
│   ├── longhorn/
│   └── multus/
└── rancher-fleet/
    └── bundles/
        ├── cdi/
        ├── core/
        ├── kubevirt/
        ├── longhorn/
        └── multus/
```

## Day-0 (USB) Flow

1. Build a USB stick that contains:
   - Talos installer ISO or disk image.
   - Pre-generated Talos machine configuration (control plane + workers).
   - Preloaded container image bundle (optional, for air-gapped or constrained sites).
2. Boot each node from USB and install Talos to the OS disk.
3. Apply the Talos configs and bootstrap the control plane.
4. Verify the API VIP via kube-vip.

See `scripts/build-usb.sh` and `scripts/generate-config.sh` for the automation entry points and `docs/architecture.md` for the full workflow. 

## Day-1 (GitOps) Flow

Rancher Fleet watches this repository and deploys:

- kube-vip (VIP for Kubernetes API)
- Longhorn (storage; data disk only)
- KubeVirt + CDI (VM runtime and image import)
- Multus (additional networks for VM bridging)

Bundled manifests and Helm values are stored under `manifests/` and wrapped with Fleet bundles in `rancher-fleet/bundles/`.

## Quickstart (Example)

> The scripts include safety checks and stubbed variables. Replace the placeholders before running them in your environment.

```bash
# 1) Generate Talos configs (control-plane + worker)
./scripts/generate-config.sh \
  --cluster-name talo-ztp \
  --vip 10.0.0.10 \
  --endpoint https://10.0.0.10:6443 \
  --talos-version v1.7.6 \
  --k8s-version v1.30.2

# 2) Build the USB (ISO + configs + optional image bundle)
./scripts/build-usb.sh \
  --device /dev/sdX \
  --talos-installer talos-amd64.iso \
  --config-dir ./talos/generated
```

## Testing & Validation

- Validate YAML formatting with `yamllint`.
- Validate Fleet bundles with `fleet apply --dry-run` (if Fleet CLI is available).

## Notes

- This repository is intentionally structured to keep **day-0 automation** in scripts and **day-1 automation** in GitOps manifests. 
- Replace all `CHANGEME` placeholders before deployment.
