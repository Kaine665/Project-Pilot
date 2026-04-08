import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const { loadDevServerConfig, isDevStackReady } = require(
  path.join(root, "config", "load-dev-server.cjs"),
);

/**
 * 解析 Electron 可执行文件路径。
 * 1) PROJECT_PILOT_ELECTRON 或 ELECTRON_BINARY：指向本机二进制（macOS 常为 …/Electron.app/Contents/MacOS/Electron）
 * 2) 否则 require("electron")（正常 npm/bun 安装）
 * 3) 再否则 PATH 上的 `electron`（全局安装或 shim）
 *
 * 另：electron npm 包支持 ELECTRON_OVERRIDE_DIST_PATH 覆盖 dist 目录，见 node_modules/electron/index.js。
 */
function resolveElectronExecutable() {
  const explicit =
    process.env.PROJECT_PILOT_ELECTRON?.trim() ||
    process.env.ELECTRON_BINARY?.trim();
  if (explicit) {
    if (existsSync(explicit)) return explicit;
    console.error(
      `[electron-dev] PROJECT_PILOT_ELECTRON / ELECTRON_BINARY 指向的文件不存在: ${explicit}`,
    );
    process.exit(1);
  }

  try {
    const fromPkg = require("electron");
    if (typeof fromPkg === "string" && existsSync(fromPkg)) {
      return fromPkg;
    }
  } catch {
    /* 未安装或安装不完整 */
  }

  let fromPath = null;
  try {
    if (process.platform === "win32") {
      const out = execSync("where.exe electron", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: true,
      });
      fromPath = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
    } else {
      fromPath = execSync("command -v electron", {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
    }
  } catch {
    /* 无全局 electron */
  }

  if (fromPath && existsSync(fromPath)) {
    console.warn(`[electron-dev] node_modules/electron 不可用，改用 PATH 中的: ${fromPath}`);
    return fromPath;
  }

  console.error(
    [
      "[electron-dev] 找不到 Electron 可执行文件。可选：",
      "  • 在项目根执行 npm install / bun install",
      "  • 或 export PROJECT_PILOT_ELECTRON='/path/to/Electron.app/Contents/MacOS/Electron'",
      "  • 或安装全局 electron 并保证 `electron` 在 PATH 中",
    ].join("\n"),
  );
  process.exit(1);
}

/** 直接指向 Electron 可执行文件，避免 Windows 上依赖 .cmd / shell 拼接 */
const electronExe = resolveElectronExecutable();

const cfg = loadDevServerConfig(root);

/** 保证 preload/main 与 electron/*.ts 同步，否则改 preload 后未编译会一直加载旧的 dist（选文件夹等 IPC 会失效）。 */
function compileElectronMain() {
  try {
    execSync("npm run electron:compile", {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
  } catch {
    console.error("[electron-dev] electron:compile failed; fix errors above before starting Electron.");
    process.exit(1);
  }
}

/**
 * Windows 上 concurrently 里 `wait-on ... && cross-env ... electron .` 常无法可靠执行，
 * 导致只起了 Vite/Hono、Electron 从未启动。这里用 Node 直接拉起子进程并等待端口。
 */
async function startDevStackWithElectron() {
  const { default: waitOn } = await import("wait-on");

  const viteScript = path.join(root, "node_modules", "vite", "bin", "vite.js");
  const devChildEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "development",
  };

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
    env: devChildEnv,
  });

  const server = spawn("bun", ["./src/server/index.ts"], {
    cwd: root,
    stdio: "inherit",
    env: devChildEnv,
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

  const killChildren = () => {
    shuttingDown = true;
    for (const c of children) {
      if (c && c.pid) {
        killPidTree(c.pid);
      }
    }
  };

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

compileElectronMain();

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
    `[electron-dev] No reusable dev stack (${cfg.clientProbeOrigin} + ${cfg.apiHealthUrl}), starting Vite + Hono and Electron together`,
  );
  await startDevStackWithElectron();
}
