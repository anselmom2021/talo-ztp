# Talos Fleet Web Console

This sub-project provides a local web UI to register Talos nodes, request approval, and track installation status. It does **not** run Talos commands or change nodes directly — it is a lightweight approval dashboard.

## Quick start

```bash
cd web
node server.js
```

Open `http://localhost:4173`.

## Features

- Register nodes (name, IP, role)
- Discover nodes on your network and pre-register them for approval
- Register nodes manually
- Apply configs with user-selected base/patch files (no CLI needed)
- Store per-node talosconfig and download it later
- Approval queue (approve/reject)
- Status tracking (pending → approved → installing → installed)
- Single-file JSON storage for easy backup

## Data storage

The state is stored in `web/data/db.json`.
Delete this file to reset the app.

## Configuration

- `PORT` env var (default `4173`)
- Discovery requires `nmap` and `talosctl` installed on the machine running the web server.
- `CONFIG_DIR` points to the base Talos configs (default `../talos/generated`)
- Apply/Verify always use `--insecure` to avoid TLS errors on fresh nodes.

Example:
```bash
PORT=8080 node server.js
```

## API

- `GET /api/nodes`
- `POST /api/nodes` `{ "name": "...", "ip": "...", "role": "controlplane|worker" }`
- Optional fields: `machinePatchPath`, `controlplanePatchPath`, `clusterPatchYaml`
- Optional field: `autoApply: true` to apply immediately after registration
- Optional fields: `clusterName`, `clusterIp`
- `GET /api/approvals`
- `POST /api/discover` `{ "networks": "192.168.1.0/24,10.0.0.0/24", "role": "worker" }`
- Optional fields: `machinePatchPath`, `controlplanePatchPath`, `clusterPatchYaml`
- `POST /api/nodes/:id/approve`
- `POST /api/nodes/:id/reject`
- `POST /api/nodes/:id/apply` (applies patches + config with talosctl)
- `POST /api/nodes/:id/verify` (checks `talosctl get machineconfig`)
- `POST /api/nodes/:id/install`
- `POST /api/nodes/:id/complete`
- `GET /api/nodes/:id/talosconfig` (downloads stored talosconfig)

UI behavior:
- File inputs + Apply Config appear only after Gen Config sets `genConfigReady`.

## Notes

This tool is intended as a local operator dashboard. It is not authenticated and should not be exposed publicly without adding auth.
