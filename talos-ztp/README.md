# talo-ztp

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
   - For local VM testing, you can create a seed ISO instead of a USB stick.
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
  --talos-version v1.12.2 \
  --k8s-version v1.33.7

# 2) Build the USB (ISO + configs + optional image bundle)
./scripts/build-usb.sh \
  --device /dev/sdX \
  --talos-installer talos-amd64.iso \
  --config-dir ./talos/generated

# 3) Build a local seed ISO for VM testing (attach as 2nd CD-ROM)
./scripts/build-iso.sh \
  --config-dir ./talos/generated \
  --output ./talos-seed.iso
```

## Testing & Validation

- Validate YAML formatting with `yamllint`.
- Validate Fleet bundles with `fleet apply --dry-run` (if Fleet CLI is available).

## Local VM Testing (Seed ISO)

Use `scripts/build-iso.sh` to generate a small ISO containing `/talos` configs (and optional `images.tar`).
Attach it as a secondary CD-ROM while booting from the Talos installer ISO in your VM manager.

## Populating Bundles and Image Archives

### Fleet bundles (manifests/Helm)

1. Add or update manifests under `manifests/<package>/` or Helm values files.
2. Add or update a corresponding bundle under `rancher-fleet/bundles/<package>/`:
   - `fleet.yaml` points to the Helm chart + version or a local kustomize directory.
   - Optional `kustomization.yaml` references manifests from `manifests/`.

### Image bundle (`images.tar`)

The optional `images.tar` should include all container images required by your Fleet bundles.
Use the provided template and helper script to generate it:

```bash
cp ./scripts/images.txt.template ./scripts/images.txt
$EDITOR ./scripts/images.txt

./scripts/build-images-bundle.sh \
  --images-file ./scripts/images.txt \
  --output ./images.tar
```

Place `images.tar` on the USB or seed ISO so it is available during day-0 or air-gapped installs.

## Notes

- This repository is intentionally structured to keep **day-0 automation** in scripts and **day-1 automation** in GitOps manifests. 
- Replace all `CHANGEME` placeholders before deployment.
