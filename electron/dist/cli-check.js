"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCliHealth = checkCliHealth;
const electron_1 = require("electron");
const http_1 = __importDefault(require("http"));
/**
 * 服务器启动后，调用 health API 检测 Claude CLI 是否可用。
 * 如果不可用，弹出原生对话框引导用户安装。
 */
function checkCliHealth(port) {
    return new Promise((resolve) => {
        const req = http_1.default.get(`http://127.0.0.1:${port}/api/settings/health`, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk.toString(); });
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.cli?.ok) {
                        resolve(true);
                    }
                    else {
                        showCliMissingDialog(data.cli?.diagnostic);
                        resolve(false);
                    }
                }
                catch {
                    // 解析失败，不阻塞用户
                    resolve(true);
                }
            });
        });
        req.on('error', () => {
            // health API 请求失败，不阻塞
            resolve(true);
        });
        req.end();
    });
}
function showCliMissingDialog(diagnostic) {
    const result = electron_1.dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Claude CLI 未安装',
        message: 'ProjectPilot 需要 Claude Code CLI 才能使用 AI 功能。',
        detail: diagnostic
            ? `诊断信息：${diagnostic}\n\n安装命令：npm install -g @anthropic-ai/claude-code`
            : '请先安装 Claude Code CLI：\nnpm install -g @anthropic-ai/claude-code\n\n安装后重启 ProjectPilot 即可使用 AI 功能。',
        buttons: ['查看安装指南', '稍后安装'],
        defaultId: 0,
    });
    if (result === 0) {
        electron_1.shell.openExternal('https://docs.anthropic.com/en/docs/claude-code/getting-started');
    }
}
//# sourceMappingURL=cli-check.js.map