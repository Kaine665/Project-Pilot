import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const { loadDevServerConfig, isDevStackReady } = require(
  path.join(root, "config", "load-dev-server.cjs"),
);
/** 直接指向 Electron 可执行文件，避免 Windows 上依赖 .cmd / shell 拼接 */
const electronExe = require("electron");

const cfg = loadDevServerConfig(root);

/**
 * Windows 上 concurrently 里 `wait-on ... && cross-env ... electron .` 常无法可靠执行，
 * 导致只起了 Vite/Hono、Electron 从未启动。这里用 Node 直接拉起子进程并等待端口。
 */
async function startDevStackWithElectron() {
  const { default: waitOn } = await import("wait-on");

  const viteScript = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const vite = spawn(process.execPath, [
    viteScript,
    "--port",
    String(cfg.clientPort),
    "--strictPort",
    "--host",
    cfg.clientBindHost,
  ], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  const server = spawn("bun", ["./src/server/index.ts"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  const children = [vite, server];
  let shuttingDown = false;

  /** Windows 上 c.kill 常杀不干净（尤其 bun/cmd 子树）；用 taskkill /T /F。 */
  function killPidTree(pid) {
    if (!pid) return;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${pid} /T /F`, {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* 已退出 */
        }
      }
    } catch {
      /* taskkill：进程已不存在 */
    }
  }

  return probe(`http://127.0.0.1:${DEV_PORT}/health`);
}

  const onUnexpectedChildExit = (name, code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      console.error(`[electron-dev] ${name} exited (signal ${signal})`);
    } else if (code !== 0 && code !== null) {
      console.error(`[electron-dev] ${name} exited with code ${code}`);
    } else {
      return;
    }
    killChildren();
    process.exit(code ?? 1);
  };

  vite.on("exit", (code, signal) => onUnexpectedChildExit("Vite", code, signal));
  server.on("exit", (code, signal) => onUnexpectedChildExit("Hono (bun)", code, signal));

  try {
    await waitOn({
      resources: [cfg.clientProbeOrigin],
      timeout: 120_000,
      interval: 250,
    });
  } catch (e) {
    console.error(
      `[electron-dev] 等待 Vite 就绪 (${cfg.clientProbeOrigin}) 超时或失败:`,
      e?.message ?? e,
    );
    killChildren();
    process.exit(1);
  }

  const electron = spawn(electronExe, ["."], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_DEV: "1",
    },
  });
  children.push(electron);

  electron.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    killChildren();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  const forwardSignal = () => {
    killChildren();
  };
  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);
}

const reuseExisting = await isDevStackReady(root);

if (reuseExisting) {
  console.log(
    `[electron-dev] Reusing existing dev stack (${cfg.clientProbeOrigin} + ${cfg.apiHealthUrl})`,
  );
  const child = spawn(electronExe, ["."], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_DEV: "1" },
  });
  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
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
} else {
  console.log(
    `[electron-dev] No reusable dev server detected on port ${DEV_PORT}, starting Vite + Hono and Electron together`,
  );
  run(getCommand("npx"), [
    "concurrently",
    "--kill-others",
    `"vite"`,
    `"bun run --tsconfig tsconfig.json src/server/index.ts"`,
    `"wait-on tcp:127.0.0.1:${DEV_PORT} && cross-env ELECTRON_DEV=1 electron ."`,
  ]);
}
