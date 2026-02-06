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
    let env = process.env;
    if (cmd === "talosctl" && shouldUseInsecure()) {
      env = { ...process.env };
      delete env.TALOSCONFIG;
      delete env.TALOSCONFIG_FILE;
    }
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env });
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
  if (shouldUseInsecure()) {
    args.push("--insecure");
  }
  return args.concat(baseArgs);
}

function talosctlArgsForNode(_node, baseArgs, _talosconfigPath) {
  const args = [];
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
  return;
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
  const baseConfigPath = path.join(CONFIG_DIR, `${node.role}.yaml`);
  if (!node.baseConfigYaml && !existsSync(baseConfigPath)) {
    throw new Error(`base config not found: ${baseConfigPath}`);
  }
  await ensureCommand("talosctl");
  await ensureTalosconfig();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "talos-web-"));
  try {
    const inlinePatchPath = path.join(tempDir, "cluster-patch.yaml");
    const patchedConfigPath = path.join(tempDir, "patched.yaml");
    const baseConfigPathTemp = path.join(tempDir, "base.yaml");
    const talosconfigPath = path.join(tempDir, "talosconfig");
    if (node.baseConfigYaml) {
      await writeFile(baseConfigPathTemp, node.baseConfigYaml, "utf8");
    }
    if (node.talosconfigYaml) {
      await writeFile(talosconfigPath, node.talosconfigYaml, "utf8");
    }
    const baseConfig = node.baseConfigYaml ? baseConfigPathTemp : baseConfigPath;
    const patchArgs = [];
    if (node.patchMachineYaml) {
      const pathMachine = path.join(tempDir, "patch-machine.yaml");
      await writeFile(pathMachine, node.patchMachineYaml, "utf8");
      patchArgs.push("--patch", `@${pathMachine}`);
    } else if (node.machinePatchPath) {
      patchArgs.push("--patch", `@${node.machinePatchPath}`);
    }
    if (node.patchControlplaneYaml) {
      const pathControl = path.join(tempDir, "patch-controlplane.yaml");
      await writeFile(pathControl, node.patchControlplaneYaml, "utf8");
      patchArgs.push("--patch", `@${pathControl}`);
    } else if (node.controlplanePatchPath) {
      patchArgs.push("--patch", `@${node.controlplanePatchPath}`);
    }
    if (node.clusterPatchYaml) {
      await writeFile(inlinePatchPath, node.clusterPatchYaml, "utf8");
      patchArgs.push("--patch", `@${inlinePatchPath}`);
    }

    const patchCmd = talosctlArgsForNode(node, [
      "machineconfig",
      "patch",
      baseConfig,
      ...patchArgs
    ], node.talosconfigYaml ? talosconfigPath : "");
    const patchedYaml = await runCommand("talosctl", patchCmd);
    await writeFile(patchedConfigPath, patchedYaml, "utf8");

    await runCommand(
      "talosctl",
      talosctlArgsForNode(
        node,
        ["apply-config", ...nodeArgs(node.ip), "-f", patchedConfigPath],
        node.talosconfigYaml ? talosconfigPath : ""
      )
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

  const nodeGenMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/gen-config$/);
  if (req.method === "POST" && nodeGenMatch) {
    const [, nodeId] = nodeGenMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node) return notFound(res);
    try {
      const body = await parseBody(req);
      const clusterName = body.clusterName || node.clusterName || "";
      const clusterIp = body.clusterIp || node.clusterIp || "";
      if (!clusterName || !clusterIp) {
        return badRequest(res, "clusterName and clusterIp are required");
      }
      await ensureCommand("talosctl");
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "talos-gen-"));
      try {
        const endpoint = `https://${clusterIp}:6443`;
        await runCommand("talosctl", [
          "gen",
          "config",
          clusterName,
          endpoint,
          "--output-dir",
          tempDir,
          "--force",
          "--with-docs=false"
        ]);
        const roleFile = path.join(tempDir, `${node.role}.yaml`);
        const cfg = await readFile(roleFile, "utf8");
        node.clusterName = clusterName;
        node.clusterIp = clusterIp;
        node.baseConfigYaml = cfg;
        node.generatedConfigAt = nowIso();
        node.updatedAt = nowIso();
        await saveDb(db);
        return json(res, 200, node);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      return badRequest(res, `gen-config failed: ${err.message}`);
    }
  }

  const nodeTalosconfigMatch = pathname.match(/^\/api\/nodes\/([^/]+)\/talosconfig$/);
  if (req.method === "GET" && nodeTalosconfigMatch) {
    const [, nodeId] = nodeTalosconfigMatch;
    const db = await loadDb();
    const node = db.nodes.find((n) => n.id === nodeId);
    if (!node || !node.talosconfigYaml) return notFound(res);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="talosconfig-${nodeId}"`
    });
    res.end(node.talosconfigYaml);
    return;
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
        clusterName: body.clusterName || "",
        clusterIp: body.clusterIp || "",
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
      const body = await parseBody(req);
      if (!body.baseConfigYaml && !node.baseConfigYaml) {
        return badRequest(res, "baseConfigYaml is required");
      }
      node.clusterName = body.clusterName || node.clusterName || "";
      node.clusterIp = body.clusterIp || node.clusterIp || "";
      if (body.baseConfigYaml) {
        node.baseConfigYaml = body.baseConfigYaml;
      }
      node.patchMachineYaml = body.patchMachineYaml || "";
      node.patchControlplaneYaml = body.patchControlplaneYaml || "";
      node.talosconfigYaml = body.talosconfigYaml || node.talosconfigYaml || "";
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
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "talos-web-"));
      const talosconfigPath = path.join(tempDir, "talosconfig");
      if (node.talosconfigYaml) {
        await writeFile(talosconfigPath, node.talosconfigYaml, "utf8");
      }
      await runCommand(
        "talosctl",
        talosctlArgsForNode(
          node,
          [...nodeArgs(node.ip), "get", "machineconfig"],
          node.talosconfigYaml ? talosconfigPath : ""
        )
      );
      await rm(tempDir, { recursive: true, force: true });
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
