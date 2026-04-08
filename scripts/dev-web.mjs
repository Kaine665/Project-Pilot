/**
 * 网页开发：同时启动 Vite + Hono（Bun 直跑 server 入口，与 electron-dev 一致；避免损坏的 tsx 包拖垮后端）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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
