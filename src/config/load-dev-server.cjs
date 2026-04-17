"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { findAvailablePort } = require("./find-available-port.cjs");

const DEV_PORTS_FILE = ".pp-dev-ports.json";
/** 超过该时间未更新的端口文件视为过期，避免指向已退出的旧 dev 进程 */
const DEV_PORTS_FILE_MAX_AGE_MS = 15 * 60 * 1000;

function devServerJsonPath(projectRoot) {
  return path.join(projectRoot, "src", "config", "dev-server.json");
}

/**
 * 开发态端口与 URL 的单一来源：src/config/dev-server.json
 *
 * 环境变量覆盖（可选；**默认**优先级最高）：
 * - PROJECT_PILOT_CLIENT_PORT — Vite / Electron 加载页端口
 * - PROJECT_PILOT_API_PORT — Hono 端口（优先于 PORT）
 * - PORT — 未设置 PROJECT_PILOT_API_PORT 时作为 API 端口（兼容常见宿主）
 *
 * **例外（仅开发、且不影响生产打包）**：`ELECTRON_DEV=1` 且存在未过期的 `.pp-dev-ports.json` 时，
 * client/api 端口**以该文件为准**，忽略上述环境变量。避免 Electron 主进程继承父 shell 里残留的
 * `PROJECT_PILOT_*` / `PORT` 与 `allocateDevStackPorts` 协商结果不一致 → 白屏。
 * 生产安装包不会设置 `ELECTRON_DEV`，也不会走本文件的该分支。
 *
 * 其次：项目根 `.pp-dev-ports.json`（由 `allocateDevStackPorts` 写入，便于第二终端 / Electron 发现实际端口）
 *
 * 约定探测：
 * - 前端就绪：能对 clientProbeOrigin 发起 HTTP 并得到 <500 状态码
 * - API 就绪：能对 apiHealthUrl 发起 HTTP 并得到 <500（Hono /health 返回 JSON）
 */
function readDevPortsFileSync(projectRoot) {
  try {
    const fp = path.join(projectRoot, DEV_PORTS_FILE);
    if (!fs.existsSync(fp)) return null;
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    const clientPort = data?.clientPort;
    const apiPort = data?.apiPort;
    const writtenAt = typeof data?.writtenAt === "number" ? data.writtenAt : 0;
    if (!Number.isFinite(clientPort) || !Number.isFinite(apiPort)) return null;
    if (Date.now() - writtenAt > DEV_PORTS_FILE_MAX_AGE_MS) return null;
    return { clientPort, apiPort, writtenAt };
  } catch {
    return null;
  }
}

function loadDevServerConfig(projectRoot) {
  const jsonPath = devServerJsonPath(projectRoot);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const fromFile = readDevPortsFileSync(projectRoot);
  /** Electron 开发主进程：端口文件由 dev-web / electron-dev 与 Vite+Hono 对齐，优先于易陈旧的 shell env */
  const electronDevPortsFileAuthoritative =
    process.env.ELECTRON_DEV === "1" && fromFile != null;

  const useFileClient =
    process.env.PROJECT_PILOT_CLIENT_PORT == null || process.env.PROJECT_PILOT_CLIENT_PORT === "";
  const useFileApi =
    (process.env.PROJECT_PILOT_API_PORT == null || process.env.PROJECT_PILOT_API_PORT === "") &&
    (process.env.PORT == null || process.env.PORT === "");

  const clientPort = parseInt(
    electronDevPortsFileAuthoritative
      ? String(fromFile.clientPort)
      : (process.env.PROJECT_PILOT_CLIENT_PORT ??
          (useFileClient && fromFile ? String(fromFile.clientPort) : String(raw.client.port))),
    10,
  );
  const apiPort = parseInt(
    electronDevPortsFileAuthoritative
      ? String(fromFile.apiPort)
      : (process.env.PROJECT_PILOT_API_PORT ??
          process.env.PORT ??
          (useFileApi && fromFile ? String(fromFile.apiPort) : String(raw.api.port))),
    10,
  );

  const clientHost = raw.client.host;
  const probeHost = raw.client.probeHost;
  const apiHost = raw.api.host;
  const healthPath = raw.api.healthPath ?? "/health";

  return {
    raw,
    clientPort,
    apiPort,
    clientBindHost: clientHost,
    clientLoadOrigin: `http://${clientHost}:${clientPort}`,
    clientProbeOrigin: `http://${probeHost}:${clientPort}`,
    apiHealthUrl: `http://${apiHost}:${apiPort}${healthPath}`,
    apiListenHost: apiHost,
    viteProxyTarget: `http://${apiHost}:${apiPort}`,
  };
}

function probeUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

/** 约定：Vite 前端 + Hono API 均已可响应 */
async function isDevStackReady(projectRoot) {
  const jsonPath = devServerJsonPath(projectRoot);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const fromFile = readDevPortsFileSync(projectRoot);

  if (fromFile) {
    const probeHost = raw.client.probeHost;
    const apiHost = raw.api.host;
    const hp = raw.api.healthPath ?? "/health";
    const clientProbe = `http://${probeHost}:${fromFile.clientPort}`;
    const apiHealth = `http://${apiHost}:${fromFile.apiPort}${hp}`;
    if ((await probeUrl(clientProbe)) && (await probeUrl(apiHealth))) {
      return true;
    }
  }
  const cfg = loadDevServerConfig(projectRoot);
  if (!(await probeUrl(cfg.clientProbeOrigin))) {
    return false;
  }
  return probeUrl(cfg.apiHealthUrl);
}

/**
 * 为本进程挑选可用的 client/api 端口，写入环境变量与 `.pp-dev-ports.json`，
 * 供 Vite / Hono / Electron 子进程及第二终端对齐。
 */
async function allocateDevStackPorts(projectRoot) {
  const jsonPath = devServerJsonPath(projectRoot);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const preferredClient = parseInt(
    process.env.PROJECT_PILOT_CLIENT_PORT ?? String(raw.client.port),
    10,
  );
  const preferredApi = parseInt(
    process.env.PROJECT_PILOT_API_PORT ?? process.env.PORT ?? String(raw.api.port),
    10,
  );

  let apiPort = await findAvailablePort(preferredApi);
  let clientPort = await findAvailablePort(preferredClient);
  let guard = 0;
  while (clientPort === apiPort && guard < 50) {
    clientPort = await findAvailablePort(clientPort + 1);
    guard += 1;
  }
  if (clientPort === apiPort) {
    throw new Error("[dev-ports] Could not allocate distinct client and API ports");
  }

  process.env.PROJECT_PILOT_API_PORT = String(apiPort);
  process.env.PORT = String(apiPort);
  process.env.PROJECT_PILOT_CLIENT_PORT = String(clientPort);

  const payload = {
    clientPort,
    apiPort,
    writtenAt: Date.now(),
    clientLoadOrigin: `http://${raw.client.host}:${clientPort}`,
    apiHealthUrl: `http://${raw.api.host}:${apiPort}${raw.api.healthPath ?? "/health"}`,
  };
  fs.writeFileSync(
    path.join(projectRoot, DEV_PORTS_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  return loadDevServerConfig(projectRoot);
}

module.exports = {
  loadDevServerConfig,
  isDevStackReady,
  probeUrl,
  allocateDevStackPorts,
  readDevPortsFileSync,
  DEV_PORTS_FILE,
};
