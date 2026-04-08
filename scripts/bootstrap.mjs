/**
 * 首次/干净安装：为 Electron 预编译包设置国内镜像后再执行 npm install。
 * 不依赖 node_modules（避免 chicken-and-egg）。
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mirror = "https://npmmirror.com/mirrors/electron/";

const r = spawnSync("npm", ["install", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_MIRROR: mirror },
  shell: process.platform === "win32",
});

process.exit(r.status ?? 1);
