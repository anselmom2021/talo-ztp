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
│   ├── generate-config.sh
│   ├── images.txt
│   └── images.txt.template
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

## Day-0 (USB) Flow (Step-by-step, non-technical)

These steps are written for someone new to Talos. You will make a bootable ISO that already contains the node configuration, so the machine can boot with its config without any extra commands.

1. **Prepare the configs (one-time setup)**
   - Generate Talos configs using `talosctl`, then apply your patch files.
   - It creates the machine configuration files in `./talos/generated/`.
   - Example:
     ```bash
     talosctl gen config talo-ztp https://10.0.0.10:6443 -f --with-docs=false
     mkdir -p ./talos/generated
     mv controlplane.yaml worker.yaml talosconfig ./talos/generated/
     talosctl machineconfig patch ./talos/generated/controlplane.yaml \
       --patch @./talos/patches/machine.yaml \
       --patch @./talos/patches/controlplane.yaml \
       > ./talos/generated/controlplane.patched.yaml
     talosctl machineconfig patch ./talos/generated/worker.yaml \
       --patch @./talos/patches/machine.yaml \
       --patch @./talos/patches/worker.yaml \
       > ./talos/generated/worker.patched.yaml
     mv ./talos/generated/controlplane.patched.yaml ./talos/generated/controlplane.yaml
     mv ./talos/generated/worker.patched.yaml ./talos/generated/worker.yaml
     ```

2. **(Optional) Prepare the image cache for offline installs**
   - Copy the template list and fill in the container images you need.
   - Run `talosctl images cache-create` to create `image-cache.oci`.
   - This lets the cluster install add-ons without downloading images from the internet.
   - Example:
     ```bash
     cp ./scripts/images.txt.template ./scripts/images.txt
     cat ./scripts/images.txt | talosctl images cache-create --image-cache-path ./bundles/image-cache.oci --images=-
     ```

3. **Build the bootable ISO (per role)**
   - Use the control plane config to build a control-plane ISO.
   - Use the worker config to build a worker ISO.
   - The ISO already includes the config (and image cache, if you used it).
   - Example:
     ```bash
     mkdir -p ./_out
     cp ./talos/generated/controlplane.yaml ./_out/machine.yaml
     docker run --rm -t \
       -v "$PWD/_out":/out \
       -v "$PWD/bundles/image-cache.oci":/image-cache.oci:ro \
       ghcr.io/siderolabs/imager:v1.12.2 \
       iso --arch amd64 --image-cache /image-cache.oci
     mv ./_out/*.iso ./talos-controlplane.iso

     cp ./talos/generated/worker.yaml ./_out/machine.yaml
     docker run --rm -t \
       -v "$PWD/_out":/out \
       -v "$PWD/bundles/image-cache.oci":/image-cache.oci:ro \
       ghcr.io/siderolabs/imager:v1.12.2 \
       iso --arch amd64 --image-cache /image-cache.oci
     mv ./_out/*.iso ./talos-worker.iso
     ```

4. **Write the installer ISO to a USB stick (for bare metal)**
   - Insert a USB stick.
   - Run the USB script to write the ISO to it.
   - This will erase the USB stick.
   - Example (replace `/dev/sdX` with your USB device):
     ```bash
     ./scripts/build-usb.sh \
       --device /dev/sdX \
       --talos-installer ./talos-controlplane.iso
     ```

5. **Boot each machine**
   - Plug the USB into the server (or attach the ISO to a VM).
   - The machine boots with its config already applied.
   - Example: select the USB or ISO in your server/VM boot menu.

6. **Install Talos to the system disk**
   - From your workstation, run the install command once the node is up.
   - Repeat for each node.
   - Example (replace with the node IP and OS disk):
     ```bash
     talosctl -n 10.0.0.21 install --insecure --disk /dev/sda
     ```

7. **Verify the cluster is up**
   - Check that the API VIP responds.
   - Continue with the Day‑1 GitOps flow.
   - Example:
     ```bash
     talosctl -n 10.0.0.10 version
     ```

See `scripts/build-usb.sh` and `docs/architecture.md` for the full workflow. 
Embedded configs mean you do not need to run `talosctl apply-config` during day-0.

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
talosctl gen config talo-ztp https://<vip or node ip>:6443 -f --with-docs=false
mv controlplane.yaml worker.yaml talosconfig ./talos/generated/
talosctl machineconfig patch ./talos/generated/controlplane.yaml \
  --patch @./talos/patches/machine.yaml \
  --patch @./talos/patches/controlplane.yaml \
  > ./talos/generated/controlplane.patched.yaml
talosctl machineconfig patch ./talos/generated/worker.yaml \
  --patch @./talos/patches/machine.yaml \
  --patch @./talos/patches/worker.yaml \
  > ./talos/generated/worker.patched.yaml
mv ./talos/generated/controlplane.patched.yaml ./talos/generated/controlplane.yaml
mv ./talos/generated/worker.patched.yaml ./talos/generated/worker.yaml

# 2) Build image cache (optional, for offline/air-gapped)
cp ./scripts/images.txt.template ./scripts/images.txt
cat ./scripts/images.txt | talosctl images cache-create --image-cache-path ./bundles/image-cache.oci --images=-

# 3) Build embedded Talos ISO (per node role)
mkdir -p ./_out
cp ./talos/generated/controlplane.yaml ./_out/machine.yaml
docker run --rm -t \
  -v "$PWD/_out":/out \
  -v "$PWD/bundles/image-cache.oci":/image-cache.oci:ro \
  ghcr.io/siderolabs/imager:v1.12.2 \
  iso --arch amd64 --image-cache /image-cache.oci
mv ./_out/*.iso ./talos-controlplane.iso


# 4) Write ISO to USB (bare metal) or attach to a VM
./scripts/build-usb.sh \
  --device /dev/sdX \
  --talos-installer ./talos-controlplane.iso
```

## Testing & Validation

- Validate YAML formatting with `yamllint`.
- Validate Fleet bundles with `fleet apply --dry-run` (if Fleet CLI is available).

## Local VM Testing

Use the embedded Talos ISO generated above as the VM boot ISO.

## Populating Bundles and Image Cache

### Fleet bundles (manifests/Helm)

1. Add or update manifests under `manifests/<package>/` or Helm values files.
2. Add or update a corresponding bundle under `rancher-fleet/bundles/<package>/`:
   - `fleet.yaml` points to the Helm chart + version or a local kustomize directory.
   - Optional `kustomization.yaml` references manifests from `manifests/`.

### Image cache (`image-cache.oci`)

The optional `image-cache.oci` is an OCI *directory* (not a single file) that includes all container images required by your Fleet bundles.
Use the provided template and `talosctl` to generate it:

```bash
cp ./scripts/images.txt.template ./scripts/images.txt
$EDITOR ./scripts/images.txt

cat ./scripts/images.txt | talosctl images cache-create --image-cache-path ./bundles/image-cache.oci --images=-
```

Pass `--image-cache /image-cache.oci` to the imager command to embed the cache in the boot ISO.

## Notes

- This repository is intentionally structured to keep **day-0 automation** in scripts and **day-1 automation** in GitOps manifests. 
- Replace all `CHANGEME` placeholders before deployment.
- Building ISOs requires Docker (to run the Talos imager) and building the image cache requires `talosctl`.
