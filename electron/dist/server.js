"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNextServer = startNextServer;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
/**
 * 启动 Next.js standalone server。
 * next build --output standalone 会在 .next/standalone/ 生成 server.js。
 * Electron 打包后，该文件位于 resources/standalone/server.js。
 */
function startNextServer(port) {
    return new Promise((resolve, reject) => {
        // 打包后 process.resourcesPath 指向 resources/
        const resourcesPath = process.resourcesPath;
        if (!resourcesPath) {
            reject(new Error('process.resourcesPath 不存在，仅支持打包后运行'));
            return;
        }
        const serverPath = path_1.default.join(resourcesPath, 'standalone', 'server.js');
        const child = (0, child_process_1.fork)(serverPath, [], {
            env: {
                ...process.env,
                PORT: String(port),
                HOSTNAME: '127.0.0.1',
                NODE_ENV: 'production',
            },
            cwd: path_1.default.join(resourcesPath, 'standalone'),
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let resolved = false;
        // 监听 stdout 等待 Ready
        child.stdout?.on('data', (data) => {
            const text = data.toString();
            if (!resolved && (text.includes('Ready') || text.includes('started'))) {
                resolved = true;
                resolve(child);
            }
        });
        child.stderr?.on('data', (data) => {
            console.error('[next-server]', data.toString());
        });
        child.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        });
        child.on('exit', (code) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Next.js server 异常退出，code=${code}`));
            }
        });
        // 超时兜底：5 秒后尝试 HTTP 探测
        setTimeout(() => {
            if (resolved)
                return;
            const req = http_1.default.get(`http://127.0.0.1:${port}`, (res) => {
                if (!resolved) {
                    resolved = true;
                    resolve(child);
                }
                res.resume();
            });
            req.on('error', () => {
                // 继续等待，10 秒后强制 resolve
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve(child);
                    }
                }, 5000);
            });
            req.end();
        }, 5000);
    });
}
//# sourceMappingURL=server.js.map