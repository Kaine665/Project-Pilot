/**
 * 网页开发：同时启动 Vite + Hono（Bun 直跑 server 入口，与 electron-dev 一致；避免损坏的 tsx 包拖垮后端）。
 *
 * 启动前会检测端口占用并为本进程分配可用的 client/api 端口，写入环境变量与项目根 `.pp-dev-ports.json`，
 * 使 Vite 代理与 Hono 监听一致；若探测到已有 dev 栈在响应，则退出并提示先停旧进程。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const {
  allocateDevStackPorts,
  loadDevServerConfig,
  isDevStackReady,
} = require(path.join(root, "src", "config", "load-dev-server.cjs"));

const children = [];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c && !c.killed && c.pid) {
      try {
        c.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
  setTimeout(() => process.exit(code), 400);
}

function trackChild(c, name) {
  children.push(c);
  c.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      console.error(`[dev-web] ${name} exited (signal ${signal})`);
      shutdown(1);
      return;
    }
    if (code !== 0 && code !== null) {
      console.error(`[dev-web] ${name} exited with code ${code}`);
      shutdown(code);
    }
  });
  return c;
}

if (await isDevStackReady(root)) {
  const cfg = loadDevServerConfig(root);
  console.error(
    `[dev-web] 已有开发栈在响应（${cfg.clientProbeOrigin} + ${cfg.apiHealthUrl}）。请先停掉旧进程再执行 npm run dev，或使用其他 worktree。`,
  );
  process.exit(1);
}

await allocateDevStackPorts(root);
const cfg = loadDevServerConfig(root);
console.log(
  `[dev-web] Vite → ${cfg.clientLoadOrigin} | Hono → ${cfg.apiHealthUrl} | 代理 /api → ${cfg.viteProxyTarget}`,
);

const devChildEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "development",
};

trackChild(
  spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js")], {
    cwd: root,
    stdio: "inherit",
    env: devChildEnv,
  }),
  "Vite",
);

trackChild(
  spawn("bun", [path.join(root, "src", "server", "index.ts")], {
    cwd: root,
    stdio: "inherit",
    env: devChildEnv,
    shell: process.platform === "win32",
  }),
  "Hono (bun)",
);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
