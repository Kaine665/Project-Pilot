import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const DEV_PORT = 4000;

function getCommand(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(
      url,
      {
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => resolve(false));
  });
}

async function hasReusableDevServer() {
  if (!(await probe(`http://127.0.0.1:${DEV_PORT}`))) {
    return false;
  }

  return probe(`http://127.0.0.1:${DEV_PORT}/api/settings/health`);
}

function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
    },
    // Windows 需要通过 shell 启动 .cmd 可执行脚本（如 npm.cmd / electron.cmd）。
    shell: process.platform === "win32",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("exit", (code, signal) => {
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

const reuseExisting = await hasReusableDevServer();

if (reuseExisting) {
  console.log(
    `[electron-dev] Reusing existing ProjectPilot dev server on http://127.0.0.1:${DEV_PORT}`,
  );
  run(getCommand("electron"), ["."], { ELECTRON_DEV: "1" });
} else {
  console.log(
    `[electron-dev] No reusable dev server detected on port ${DEV_PORT}, starting Next.js and Electron together`,
  );
  run(getCommand("npm"), ["run", "electron:dev:base"]);
}
