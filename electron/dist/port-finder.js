"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAvailablePort = findAvailablePort;
const net_1 = __importDefault(require("net"));
/**
 * 查找可用端口。优先尝试 preferred，被占用则由 OS 分配随机端口。
 */
function findAvailablePort(preferred = 4000) {
    return new Promise((resolve, reject) => {
        const server = net_1.default.createServer();
        server.listen(preferred, '127.0.0.1', () => {
            server.close(() => resolve(preferred));
        });
        server.on('error', () => {
            // preferred 端口被占用，让 OS 分配
            const fallback = net_1.default.createServer();
            fallback.listen(0, '127.0.0.1', () => {
                const addr = fallback.address();
                fallback.close(() => resolve(addr.port));
            });
            fallback.on('error', reject);
        });
    });
}
//# sourceMappingURL=port-finder.js.map