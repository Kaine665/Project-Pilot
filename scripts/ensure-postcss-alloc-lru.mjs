/**
 * Turbopack/PostCSS 在子进程里执行 @tailwindcss/postcss 的 require('@alloc/quick-lru') 时，
 * 有时无法解析到顶层 node_modules。把包复制到 postcss 包自己的 node_modules 下可稳定命中。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "@alloc", "quick-lru");
const dest = path.join(
  root,
  "node_modules",
  "@tailwindcss",
  "postcss",
  "node_modules",
  "@alloc",
  "quick-lru",
);

if (!fs.existsSync(path.join(src, "package.json"))) {
  console.error(
    "[ensure-postcss-alloc-lru] 未找到 @alloc/quick-lru，请先在本目录执行: npm install",
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true, force: true });
console.log("[ensure-postcss-alloc-lru] 已同步到 @tailwindcss/postcss/node_modules/@alloc/quick-lru");
