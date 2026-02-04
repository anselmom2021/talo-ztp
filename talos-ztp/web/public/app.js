async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function statusLabel(status) {
  const map = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    installing: "Installing",
    installed: "Installed",
    configured: "Configured",
    verified: "Verified"
  };
  return map[status] || status;
}

function statusPill(status) {
  return `<span class="pill">${statusLabel(status)}</span>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function nodeCard(node) {
  const patchInfo = [];
  if (node.machinePatchPath) patchInfo.push(`machine: ${node.machinePatchPath}`);
  if (node.controlplanePatchPath) patchInfo.push(`controlplane: ${node.controlplanePatchPath}`);
  if (node.clusterPatchYaml) patchInfo.push("cluster: inline YAML");

  const actions = [];
  if (node.status === "pending") {
    actions.push(
      `<button data-action="approve" data-id="${node.id}">Approve</button>`,
      `<button class="ghost" data-action="reject" data-id="${node.id}">Reject</button>`,
      `<button class="ghost" data-action="details" data-id="${node.id}">Details</button>`
    );
  }
  if (node.status === "approved") {
    actions.push(
      `<button data-action="apply" data-id="${node.id}">Apply Config</button>`,
      `<button class="ghost" data-action="install" data-id="${node.id}">Mark Installing</button>`,
      `<button class="ghost" data-action="details" data-id="${node.id}">Details</button>`
    );
  }
  if (node.status === "installing") {
    actions.push(
      `<button data-action="complete" data-id="${node.id}">Mark Installed</button>`,
      `<button class="ghost" data-action="details" data-id="${node.id}">Details</button>`
    );
  }
  if (node.status === "configured") {
    actions.push(
      `<button data-action="verify" data-id="${node.id}">Verify Applied</button>`,
      `<button class="ghost" data-action="details" data-id="${node.id}">Details</button>`
    );
  }

  const clusterYaml = node.clusterPatchYaml
    ? `<details><summary>Cluster YAML</summary><pre>${escapeHtml(node.clusterPatchYaml)}</pre></details>`
    : "";

  return `
    <div class="card">
      <div class="row">
        <strong>${node.name}</strong>
        ${statusPill(node.status)}
      </div>
      <div class="row">
        <span>${node.ip}</span>
        <span>${node.role}</span>
      </div>
      <div class="row">
        <small class="muted">Updated ${new Date(node.updatedAt).toLocaleString()}</small>
      </div>
      ${
        node.lastAppliedAt
          ? `<div class="row"><small class="muted">Applied ${new Date(node.lastAppliedAt).toLocaleString()}</small></div>`
          : ""
      }
      ${
        node.lastVerifiedAt
          ? `<div class="row"><small class="muted">Verified ${new Date(node.lastVerifiedAt).toLocaleString()}</small></div>`
          : ""
      }
      ${
        patchInfo.length
          ? `<div class="row"><small class="muted">Patches: ${patchInfo.join(", ")}</small></div>`
          : ""
      }
      ${clusterYaml}
      ${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}
    </div>
  `;
}

function approvalCard(item, node) {
  const patchInfo = [];
  if (node?.machinePatchPath) patchInfo.push(`machine: ${node.machinePatchPath}`);
  if (node?.controlplanePatchPath) patchInfo.push(`controlplane: ${node.controlplanePatchPath}`);
  if (node?.clusterPatchYaml) patchInfo.push("cluster: inline YAML");

  const clusterYaml = node?.clusterPatchYaml
    ? `<details><summary>Cluster YAML</summary><pre>${escapeHtml(node.clusterPatchYaml)}</pre></details>`
    : "";

  return `
    <div class="card">
      <div class="row">
        <strong>${node?.name || "Unknown node"}</strong>
        ${statusPill(item.status)}
      </div>
      <div class="row">
        <span>${node?.ip || "-"}</span>
        <span>Action: ${item.action}</span>
      </div>
      ${
        patchInfo.length
          ? `<div class="row"><small class="muted">Patches: ${patchInfo.join(", ")}</small></div>`
          : ""
      }
      ${clusterYaml}
      <div class="actions">
        <button data-action="approve" data-id="${item.nodeId}">Approve</button>
        <button class="ghost" data-action="reject" data-id="${item.nodeId}">Reject</button>
      </div>
    </div>
  `;
}

async function load() {
  const [nodes, approvals] = await Promise.all([
    fetchJson("/api/nodes"),
    fetchJson("/api/approvals")
  ]);

  const pending = nodes.filter((n) => n.status === "pending").length;
  const approved = nodes.filter((n) => n.status === "approved").length;
  const installing = nodes.filter((n) => n.status === "installing").length;
  const installed = nodes.filter((n) => n.status === "installed").length;
  const configured = nodes.filter((n) => n.status === "configured").length;
  const verified = nodes.filter((n) => n.status === "verified").length;

  document.getElementById("count-pending").textContent = pending;
  document.getElementById("count-approved").textContent = approved;
  document.getElementById("count-installing").textContent = installing;
  document.getElementById("count-installed").textContent = installed;
  if (document.getElementById("count-configured")) {
    document.getElementById("count-configured").textContent = configured;
  }
  if (document.getElementById("count-verified")) {
    document.getElementById("count-verified").textContent = verified;
  }

  const nodesEl = document.getElementById("nodes");
  nodesEl.innerHTML = nodes.map(nodeCard).join("") || "<p>No nodes yet.</p>";

  const detailsSelect = document.getElementById("details-node");
  if (detailsSelect) {
    detailsSelect.innerHTML = nodes
      .map((n) => `<option value="${n.id}">${n.name} (${n.ip})</option>`)
      .join("");
  }

  const approvalsEl = document.getElementById("approvals");
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  approvalsEl.innerHTML =
    pendingApprovals
      .map((item) => approvalCard(item, nodes.find((n) => n.id === item.nodeId)))
      .join("") || "<p>No approvals waiting.</p>";
}

document.getElementById("node-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const payload = {
    name: form.name.value.trim(),
    ip: form.ip.value.trim(),
    role: form.role.value,
    machinePatchPath: form.machinePatchPath.value.trim(),
    controlplanePatchPath: form.controlplanePatchPath.value.trim(),
    clusterPatchYaml: form.clusterPatchYaml.value.trim()
  };
  await fetchJson("/api/nodes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  form.reset();
  await load();
});

document.getElementById("discover-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const status = document.getElementById("discover-status");
  status.textContent = "Scanning…";
  const payload = {
    networks: form.networks.value.trim(),
    role: form.role.value,
    machinePatchPath: form.machinePatchPath.value.trim(),
    controlplanePatchPath: form.controlplanePatchPath.value.trim(),
    clusterPatchYaml: form.clusterPatchYaml.value.trim()
  };
  try {
    const result = await fetchJson("/api/discover", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    status.textContent = `Found ${result.totalFound}. Added ${result.added.length}.`;
    await load();
  } catch (err) {
    status.textContent = err.message;
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "details") {
    const select = document.getElementById("details-node");
    if (select) {
      select.value = id;
    }
    return;
  }
  await fetchJson(`/api/nodes/${id}/${action}`, { method: "POST" });
  await load();
});

async function detailAction(endpoint) {
  const nodeId = document.getElementById("details-node")?.value;
  const output = document.getElementById("details-output");
  if (!nodeId) return;
  output.textContent = "Loading...";
  try {
    const data = await fetchJson(endpoint(nodeId));
    output.textContent = data.output || "No output.";
  } catch (err) {
    output.textContent = err.message;
  }
}

document.getElementById("details-disks")?.addEventListener("click", () =>
  detailAction((id) => `/api/nodes/${id}/disks`)
);
document.getElementById("details-services")?.addEventListener("click", () =>
  detailAction((id) => `/api/nodes/${id}/services`)
);
document.getElementById("details-logs")?.addEventListener("click", () =>
  detailAction((id) => `/api/nodes/${id}/logs?service=machined`)
);

load().catch((err) => {
  console.error(err);
  alert(err.message);
});
