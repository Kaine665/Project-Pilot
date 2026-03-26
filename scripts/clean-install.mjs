/**
 * 删除 node_modules 后重新 npm install（Windows/macOS/Linux 通用）。
 * 用法: node scripts/clean-install.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = path.join(root, "node_modules");

if (fs.existsSync(nm)) {
  console.log("[clean-install] 正在删除 node_modules …");
  fs.rmSync(nm, { recursive: true, force: true });
}

console.log("[clean-install] 正在 npm install …");
const r = spawnSync("npm", ["install"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
