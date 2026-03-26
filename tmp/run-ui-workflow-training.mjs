/**
 * 顺序：baseline → workflow-a → workflow-b
 * 每轮在本机起 npm run dev，就绪后 Playwright 截图，再杀 4000 端口。
 */
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ds = join(__dirname, "..");
const root = join(ds, "..");
const captureJs = join(ds, "tmp", "ui-workflow-experiment-capture.mjs");
const pathSuffix = "/flows/agents";
const probeHosts = ["127.0.0.1", "localhost"];

const runs = [
  [join(root, "develop-static"), "baseline"],
  [join(root, "exp-ui-workflow-a-agents"), "workflow-a"],
  [join(root, "exp-ui-workflow-b-agents"), "workflow-b"],
];

function killPort4000() {
  if (process.platform !== "win32") {
    try {
      execSync("lsof -ti:4000 | xargs kill -9 2>/dev/null", { shell: true, stdio: "ignore" });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const out = execSync("netstat -ano", { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split("\n")) {
      if (!line.includes(":4000") || !line.includes("LISTENING")) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function httpOnce200(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      if (res.statusCode === 200) resolve();
      else reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("socket timeout"));
    });
  });
}

/** @returns {Promise<string>} host that worked */
async function waitReady(maxMs, getDevExited) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const exited = getDevExited();
    if (exited !== null) {
      throw new Error(`npm run dev exited early (code ${exited})`);
    }
    for (const host of probeHosts) {
      const url = `http://${host}:4000${pathSuffix}`;
      try {
        await httpOnce200(url);
        return host;
      } catch {
        /* try next host */
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timeout waiting for *:4000${pathSuffix}`);
}

async function runOne(workdir, label) {
  if (!existsSync(join(workdir, "package.json"))) {
    throw new Error(`Missing package.json: ${workdir}`);
  }
  console.log("\n===", label, "::", workdir, "===\n");
  killPort4000();
  await new Promise((r) => setTimeout(r, 2500));

  let devExited = null;
  const child = spawn("npm", ["run", "dev"], {
    cwd: workdir,
    shell: true,
    stdio: "inherit",
    env: { ...process.env },
  });
  child.on("exit", (code, sig) => {
    devExited = code ?? sig ?? 0;
  });

  let host;
  try {
    host = await waitReady(180000, () => devExited);
  } catch (e) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    killPort4000();
    throw e;
  }

  console.log("Probe OK via host:", host);
  execSync(`node "${captureJs}" 4000 ${label} ${pathSuffix}`, {
    cwd: ds,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PP_UI_CAPTURE_HOST: host },
  });

  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  killPort4000();
  await new Promise((r) => setTimeout(r, 3000));
}

for (const [cwd, label] of runs) {
  await runOne(cwd, label);
}
console.log("\nDone. PNG ->", join(ds, "tmp", "ui-workflow-experiment"));
