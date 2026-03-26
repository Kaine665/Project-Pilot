/**
 * 对 Agents 页截图，用于 UI 工作流程实验归档。
 * 用法：先在本 worktree 启动 npm run dev，再执行
 *   node tmp/ui-workflow-experiment-capture.mjs [port] [label]
 * 例：node tmp/ui-workflow-experiment-capture.mjs 4000 workflow-a
 * 第 4 参数可选：URL path（默认 /flows/agents；Next+intl 可用 /zh/flows/agents）
 */
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.argv[2] ?? "4000";
const label = process.argv[3] ?? "capture";
/** Vite SPA：/flows/agents；旧 Next + next-intl 常用 /zh/flows/agents */
const urlPath =
  process.argv[4] ?? process.env.PP_UI_CAPTURE_PATH ?? "/flows/agents";
const outDir = join(__dirname, "..", "tmp", "ui-workflow-experiment");
const url = `http://127.0.0.1:${port}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(2000);

const safe = String(label).replace(/[^a-zA-Z0-9_-]/g, "_");
const outFile = join(outDir, `${safe}.png`);
await page.screenshot({ path: outFile, fullPage: true });
console.log("Wrote", outFile);
await browser.close();
