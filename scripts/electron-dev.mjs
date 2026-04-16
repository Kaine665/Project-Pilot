import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const { loadDevServerConfig, isDevStackReady, allocateDevStackPorts } = require(
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

/**
 * Cursor 等环境可能注入 ELECTRON_RUN_AS_NODE=1，子进程会以 Node 模式跑、无 `app`。
 * 必须注入与当前 dev 栈一致的 client/api 端口：父 shell 若残留旧的 PROJECT_PILOT_CLIENT_PORT / PORT，
 * 会与 `.pp-dev-ports.json` 及 Vite 实际监听错位 → Electron 连错端口、整页白屏或 API 永久挂起。
 */
function envForElectronChild(cfg) {
  const env = { ...process.env, ELECTRON_DEV: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PROJECT_PILOT_CLIENT_PORT = String(cfg.clientPort);
  env.PROJECT_PILOT_API_PORT = String(cfg.apiPort);
  env.PORT = String(cfg.apiPort);
  return env;
}

/** 保证 preload/main 与 electron/*.ts 同步，否则改 preload 后未编译会一直加载旧的 dist（选文件夹等 IPC 会失效）。 */
function compileElectronMain() {
  try {
    const tscBin = path.join(root, "node_modules", ".bin", "tsc");
    execSync(`"${tscBin}" -p electron/tsconfig.json`, {
      cwd: root,
      stdio: "inherit",
      shell: true,
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
async function startDevStackWithElectron(cfg) {
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

  const server = spawn("bun", [path.join(root, "src", "server", "index.ts")], {
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
    // 须同时就绪：仅 Vite 时 Electron 首屏可能已渲染但 /api 代理仍失败；长时间挂起 fetch 会导致「假白屏」
    await waitOn({
      resources: [cfg.clientProbeOrigin, cfg.apiHealthUrl],
      timeout: 120_000,
      interval: 250,
    });
  } catch (e) {
    console.error(
      `[electron-dev] 等待开发栈就绪 (Vite: ${cfg.clientProbeOrigin} + API: ${cfg.apiHealthUrl}) 超时或失败:`,
      e?.message ?? e,
    );
    killChildren();
    process.exit(1);
  }

  const electron = spawn(electronExe, ["."], {
    cwd: root,
    stdio: "inherit",
    env: envForElectronChild(cfg),
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
  const cfg = loadDevServerConfig(root);
  console.log(
    `[electron-dev] Reusing existing dev stack (${cfg.clientProbeOrigin} + ${cfg.apiHealthUrl})`,
  );
  const child = spawn(electronExe, ["."], {
    cwd: root,
    stdio: "inherit",
    env: envForElectronChild(cfg),
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
  await allocateDevStackPorts(root);
  const cfg = loadDevServerConfig(root);
  console.log(
    `[electron-dev] Allocated dev ports → ${cfg.clientProbeOrigin} + ${cfg.apiHealthUrl} (see .pp-dev-ports.json); starting Vite + Hono and Electron`,
  );
  await startDevStackWithElectron(cfg);
}
