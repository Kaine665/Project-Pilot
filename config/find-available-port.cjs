"use strict";

const net = require("net");

/**
 * 检测本机 127.0.0.1:preferred 是否可监听；被占用则让 OS 分配随机端口。
 * 与 `electron/port-finder.ts` 行为一致，供 Node 脚本（dev-web / electron-dev）复用。
 */
function findAvailablePort(preferred) {
  const p = typeof preferred === "number" && Number.isFinite(preferred) ? preferred : 4287;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(p, "127.0.0.1", () => {
      server.close(() => resolve(p));
    });
    server.on("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const addr = fallback.address();
        fallback.close(() => resolve(addr.port));
      });
      fallback.on("error", reject);
    });
  });
}

module.exports = { findAvailablePort };
