import http from "http";
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, "..", "talos", "generated");
const DEFAULT_TALOSCONFIG = path.join(DATA_DIR, "talosconfig");
const TALOSCONFIG = process.env.TALOSCONFIG || "";
const TALOS_INSECURE = process.env.TALOS_INSECURE === "true";

const defaultDb = {
  nodes: [],
  approvals: []
};

async function ensureDb() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
  if (!existsSync(DB_PATH)) {
    await writeFile(DB_PATH, JSON.stringify(defaultDb, null, 2));
  }
}

async function loadDb() {
  await ensureDb();
  const raw = await readFile(DB_PATH, "utf8");
  return JSON.parse(raw);
}

async function saveDb(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function serveFile(res, filePath) {
  readFile(filePath)
    .then((buf) => {
      const ext = path.extname(filePath);
      const type =
        ext === ".html"
          ? "text/html"
          : ext === ".css"
          ? "text/css"
          : ext === ".js"
          ? "text/javascript"
          : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(buf);
    })
    .catch(() => notFound(res));
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureCommand(cmd) {
  try {
    await runCommand("command", ["-v", cmd]);
  } catch {
    throw new Error(`${cmd} not found in PATH`);
  }
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `${cmd} exited with ${code}`));
      }
      resolve(stdout);
    });
  });
}

function talosctlArgs(baseArgs) {
  const args = [];
  if (shouldUseTalosconfig()) {
    args.push(`--talosconfig=${TALOSCONFIG || DEFAULT_TALOSCONFIG}`);
  }
  if (shouldUseInsecure()) {
    args.push("--insecure");
  }
  return args.concat(baseArgs);
}

function talosconfigPath() {
  return TALOSCONFIG || DEFAULT_TALOSCONFIG;
}

function isTalosconfigEmpty() {
  const cfg = talosconfigPath();
  if (!existsSync(cfg)) return true;
  try {
    return statSync(cfg).size === 0;
  } catch {
    return true;
  }
}

function shouldUseInsecure() {
  return TALOS_INSECURE || isTalosconfigEmpty();
}

function shouldUseTalosconfig() {
  if (isTalosconfigEmpty()) return false;
  return true;
}

async function ensureTalosconfig() {
  if (shouldUseInsecure() && !TALOSCONFIG) {
    return;
  }
  const configPath = talosconfigPath();
  try {
    const info = await stat(configPath);
    if (info.size > 0) return;
  } catch {
    // continue to create
  }
  await ensureCommand("talosctl");
  await runCommand("talosctl", ["config", "new", `--talosconfig=${configPath}`]);
}

function nodeArgs(ip) {
  return ["-e", ip, "-n", ip];
}

async function discoverNodes(networks) {
  await ensureCommand("nmap");
  await ensureTalosconfig();
  const nmapOut = await runCommand("nmap", ["-Pn", "-n", "-p", "50000", "-oG", "-", ...networks]);
  const candidates = [];
  nmapOut.split("\n").forEach((line) => {
    if (!line.startsWith("Host:")) return;
    const hostMatch = line.match(/Host:\s+([0-9.]+)/);
    const portMatch = line.match(/Ports:\s+.*50000\/open/);
    if (hostMatch && portMatch) {
      candidates.push(hostMatch[1]);
    }
  });
  return [...new Set(candidates)];
}

async function getHostname(ip) {
  try {
    await ensureCommand("talosctl");
    await ensureTalosconfig();
    const out = await runCommand("talosctl", talosctlArgs([
      ...nodeArgs(ip),
      "get",
      "hostname",
      "-o",
      "jsonpath={.spec.hostname}"
    ]));
    return out.trim();
  } catch {
    return "";
  }
}

async function applyConfigForNode(node) {
  const baseConfig = path.join(CONFIG_DIR, `${node.role}.yaml`);
  if (!existsSync(baseConfig)) {
    throw new Error(`base config not found: ${baseConfig}`);
  }
  await ensureCommand("talosctl");
  await ensureTalosconfig();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "talos-web-"));
  try {
    const inlinePatchPath = path.join(tempDir, "cluster-patch.yaml");
    const patchedConfigPath = path.join(tempDir, "patched.yaml");
    const patchArgs = [];
    if (node.machinePatchPath) patchArgs.push("--patch", `@${node.machinePatchPath}`);
    if (node.controlplanePatchPath) patchArgs.push("--patch", `@${node.controlplanePatchPath}`);
    if (node.clusterPatchYaml) {
      await writeFile(inlinePatchPath, node.clusterPatchYaml, "utf8");
      patchArgs.push("--patch", `@${inlinePatchPath}`);
    }

    const patchCmd = talosctlArgs([
      "machineconfig",
      "patch",
      baseConfig,
      ...patchArgs
    ]);
    const patchedYaml = await runCommand("talosctl", patchCmd);
    await writeFile(patchedConfigPath, patchedYaml, "utf8");

    await runCommand(
      "talosctl",
      talosctlArgs(["apply-config", ...nodeArgs(node.ip), "-f", patchedConfigPath])
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/") {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
  }
  if (req.method === "GET" && pathname.startsWith("/public/")) {
    return serveFile(res, path.join(__dirname, pathname));
  }
  if (req.method === "GET" && pathname === "/api/nodes") {
    const db = await loadDb();
    return json(res, 200, db.nodes);
  }
  if (req.method === "GET" && pathname === "/api/approvals") {
    const db = await loadDb();
    return json(res, 200, db.approvals);
  }
  if (req.method === "POST" && pathname === "/api/nodes") {
    try {
      const body = await parseBody(req);
      if (!body.name || !body.ip || !body.role) {
        return badRequest(res, "name, ip, and role are required");
      }
      const db = await loadDb();
      const node = {
        id: newId(),
        name: body.name,
        ip: body.ip,
        role: body.role,
        machinePatchPath: body.machinePatchPath || "",
        controlplanePatchPath: body.controlplanePatchPath || "",
        clusterPatchYaml: body.clusterPatchYaml || "",
        autoApply: body.autoApply === true,
        status: "pending",
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.nodes.push(node);
      db.approvals.push({
        id: newId(),
        nodeId: node.id,
        action: "install",
        status: "pending",
        createdAt: nowIso()
      });
      if (node.autoApply) {
        try {
          await applyConfigForNode(node);
          node.status = "configured";
          node.lastAppliedAt = nowIso();
          node.updatedAt = nowIso();
        } catch (err) {
          node.lastApplyError = err.message;
          node.updatedAt = nowIso();
        }
      }
      await saveDb(db);
      return json(res, 201, node);
    } catch {
      return badRequest(res, "invalid JSON body");
    }
  }

  if (req.method === "POST" && pathname === "/api/discover") {
    try {
      const body = await parseBody(req);
      const networks = (body.networks || "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      if (networks.length === 0) {
        return badRequest(res, "networks is required (comma-separated CIDRs)");
      }
      const role = body.role || "worker";
      const machinePatchPath = body.machinePatchPath || "";
      const controlplanePatchPath = body.controlplanePatchPath || "";
      const clusterPatchYaml = body.clusterPatchYaml || "";
      let candidates;
      try {
        await ensureCommand("talosctl");
        await ensureTalosconfig();
        candidates = await discoverNodes(networks);
      } catch (err) {
        return badRequest(res, `discovery failed: ${err.message}`);
      }

      const db = await loadDb();
      const existingIps = new Set(db.nodes.map((n) => n.ip));
      const added = [];
      for (const ip of candidates) {
        if (existingIps.has(ip)) continue;
        const hostname = await getHostname(ip);
        const node = {
          id: newId(),
          name: hostname || ip,
          ip,
          role,
          machinePatchPath,
          controlplanePatchPath,
          clusterPatchYaml,
          status: "pending",
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        db.nodes.push(node);
        db.approvals.push({
          id: newId(),
          nodeId: node.id,
          action: "install",
          status: "pending",
          createdAt: nowIso()
        });
        added.push(node);
      }
      await saveDb(db);
      return json(res, 200, { added, totalFound: candidates.length });
    } catch {
      return badRequest(res, "invalid JSON body");
    }
  }

  const nodeDisksMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/disks$/);
  if (req.method === "GET" && nodeDisksMatch) {
    const [, nodeId] = nodeDisksMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);
    try {
      await ensureTalosconfig();
      const out = await runCommand(
        "talosctl",
        talosctlArgs([...nodeArgs(node.ip), "get", "disks"])
      );
      return json(res, 200, { output: out });
    } catch (err) {
      return badRequest(res, `disks failed: ${err.message}`);
    }
  }

  const nodeServicesMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/services$/);
  if (req.method === "GET" && nodeServicesMatch) {
    const [, nodeId] = nodeServicesMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);
    try {
      await ensureTalosconfig();
      const out = await runCommand(
        "talosctl",
        talosctlArgs([...nodeArgs(node.ip), "service"])
      );
      return json(res, 200, { output: out });
    } catch (err) {
      return badRequest(res, `services failed: ${err.message}`);
    }
  }

  const nodeLogsMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/logs$/);
  if (req.method === "GET" && nodeLogsMatch) {
    const [, nodeId] = nodeLogsMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);
    const service = url.searchParams.get("service") || "machined";
    try {
      await ensureTalosconfig();
      const out = await runCommand(
        "talosctl",
        talosctlArgs([...nodeArgs(node.ip), "logs", service, "--tail", "200"])
      );
      return json(res, 200, { output: out });
    } catch (err) {
      return badRequest(res, `logs failed: ${err.message}`);
    }
  }

  const nodeApplyMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/apply$/);
  if (req.method === "POST" && nodeApplyMatch) {
    const [, nodeId] = nodeApplyMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);
    try {
      await applyConfigForNode(node);
      node.status = "configured";
      node.lastAppliedAt = nowIso();
      node.updatedAt = nowIso();
      await saveDb(db);
      return json(res, 200, node);
    } catch (err) {
      return badRequest(res, `apply failed: ${err.message}`);
    }
  }

  const nodeVerifyMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/verify$/);
  if (req.method === "POST" && nodeVerifyMatch) {
    const [, nodeId] = nodeVerifyMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);
    try {
      await ensureCommand("talosctl");
      await ensureTalosconfig();
      await runCommand("talosctl", talosctlArgs([...nodeArgs(node.ip), "get", "machineconfig"]));
      node.lastVerifiedAt = nowIso();
      node.status = node.status === "configured" ? "verified" : node.status;
      node.updatedAt = nowIso();
      await saveDb(db);
      return json(res, 200, node);
    } catch (err) {
      return badRequest(res, `verify failed: ${err.message}`);
    }
  }

  const nodeActionMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/(approve|reject|install|complete)$/);
  if (req.method === "POST" && nodeActionMatch) {
    const [, nodeId, action] = nodeActionMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);

    if (action === "approve") {
      node.status = "approved";
      db.approvals = db.approvals.map((a) =>
        a.nodeId === nodeId && a.status === "pending" ? { ...a, status: "approved" } : a
      );
    } else if (action === "reject") {
      node.status = "rejected";
      db.approvals = db.approvals.map((a) =>
        a.nodeId === nodeId && a.status === "pending" ? { ...a, status: "rejected" } : a
      );
    } else if (action === "install") {
      node.status = "installing";
    } else if (action === "complete") {
      node.status = "installed";
    }
    node.updatedAt = nowIso();
    await saveDb(db);
    return json(res, 200, node);
  }

  notFound(res);
});

const port = process.env.PORT || 4173;
server.listen(port, () => {
  console.log(`talos-fleet-web listening on http://localhost:${port}`);
});
