"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

/**
 * 开发态端口与 URL 的单一来源：config/dev-server.json
 *
 * 环境变量覆盖（可选）：
 * - PROJECT_PILOT_CLIENT_PORT — Vite / Electron 加载页端口
 * - PROJECT_PILOT_API_PORT — Hono 端口（优先于 PORT）
 * - PORT — 未设置 PROJECT_PILOT_API_PORT 时作为 API 端口（兼容常见宿主）
 *
 * 约定探测：
 * - 前端就绪：能对 clientProbeOrigin 发起 HTTP 并得到 <500 状态码
 * - API 就绪：能对 apiHealthUrl 发起 HTTP 并得到 <500（Hono /health 返回 JSON）
 */
function loadDevServerConfig(projectRoot) {
  const jsonPath = path.join(projectRoot, "config", "dev-server.json");
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const clientPort = parseInt(
    process.env.PROJECT_PILOT_CLIENT_PORT ?? String(raw.client.port),
    10,
  );
  const apiPort = parseInt(
    process.env.PROJECT_PILOT_API_PORT ??
      process.env.PORT ??
      String(raw.api.port),
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
  const cfg = loadDevServerConfig(projectRoot);
  if (!(await probeUrl(cfg.clientProbeOrigin))) {
    return false;
  }
  return probeUrl(cfg.apiHealthUrl);
}

module.exports = {
  loadDevServerConfig,
  isDevStackReady,
  probeUrl,
};
