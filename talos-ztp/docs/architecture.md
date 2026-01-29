# Architecture and Workflow

## Target Platform

- **Hardware**: 3x bare-metal AMD64 hosts.
- **Role**: all nodes are control-plane + workers.
- **Storage**:
  - OS disk: dedicated for Talos.
  - Data disk: dedicated for Longhorn.

## Core Design Principles

1. **USB-first install**: All artifacts required for day-0 provisioning are stored on a USB stick.
2. **Minimal external dependency**: The cluster can come up with no or minimal internet access.
3. **GitOps for day-1**: Post-install services are applied using Rancher Fleet.

## Day-0 Workflow

1. **Generate Talos configs** using `scripts/generate-config.sh`.
2. **Create bootable USB** with `scripts/build-usb.sh`:
   - Talos installer ISO or disk image.
   - Generated machine configs.
   - Optional image cache bundle.
3. **Install Talos** on each host:
   - Boot from USB.
   - Install to OS disk.
   - Apply Talos configs.
4. **Bootstrap control-plane** and verify API VIP.

## Day-1 Workflow (GitOps)

Rancher Fleet monitors `rancher-fleet/` for bundles and applies:

- **kube-vip**: provides the Kubernetes API VIP for HA control plane.
- **Longhorn**: persistent storage on data disks with replication.
- **KubeVirt + CDI**: VM workloads and image import.
- **Multus**: secondary networks for VM traffic.

## Storage & Replication Strategy

- Longhorn uses only the **data disk**.
- Replication factor is defined in the Longhorn values (default 3).
- Talos disk configuration ensures the OS disk is separate.

## Networking

- **L3 VIP** provided by kube-vip on the control-plane nodes.
- **Multus** provides external network access for VM workloads using macvlan or bridge CNI.

## Security & Access

- Talos API and Kubernetes API endpoints are exposed via the internal VIP.
- Consider using sealed secrets or SOPS for sensitive configuration.

