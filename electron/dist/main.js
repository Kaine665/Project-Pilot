"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const port_finder_1 = require("./port-finder");
const server_1 = require("./server");
const cli_check_1 = require("./cli-check");
const isDev = !!process.env.ELECTRON_DEV;
const DEV_PORT = 4000;
let mainWindow = null;
let serverProcess = null;
let serverPort = DEV_PORT;
// ── 单实例锁 ──────────────────────────────────────────
const gotLock = electron_1.app.requestSingleInstanceLock();
if (!gotLock) {
    electron_1.app.quit();
    process.exit(0);
}
electron_1.app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.focus();
    }
});
// ── 创建主窗口 ────────────────────────────────────────
function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'ProjectPilot',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    else {
        // 生产环境不需要菜单栏
        electron_1.Menu.setApplicationMenu(null);
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// ── 启动流程 ──────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    if (isDev) {
        // Dev 模式：假设 Next.js dev server 已在外部运行
        serverPort = DEV_PORT;
        createMainWindow();
        return;
    }
    // 生产模式：启动内嵌 standalone server
    let splash = null;
    try {
        // 显示 splash
        splash = new electron_1.BrowserWindow({
            width: 400,
            height: 300,
            frame: false,
            transparent: false,
            resizable: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
        });
        splash.loadFile(path_1.default.join(__dirname, 'splash.html'));
        // 找端口
        serverPort = await (0, port_finder_1.findAvailablePort)(4000);
        // 启动 server
        serverProcess = await (0, server_1.startNextServer)(serverPort);
        // 关 splash，开主窗口
        splash.close();
        splash = null;
        createMainWindow();
        // 延迟检测 CLI
        setTimeout(() => {
            (0, cli_check_1.checkCliHealth)(serverPort).catch(() => { });
        }, 3000);
    }
    catch (err) {
        if (splash)
            splash.close();
        electron_1.dialog.showErrorBox('启动失败', `Next.js 服务器启动失败：\n${err instanceof Error ? err.message : String(err)}\n\n请尝试重新安装或联系开发者。`);
        electron_1.app.quit();
    }
});
// ── 生命周期 ──────────────────────────────────────────
electron_1.app.on('window-all-closed', () => {
    gracefulShutdown();
    electron_1.app.quit();
});
electron_1.app.on('before-quit', () => {
    gracefulShutdown();
});
function gracefulShutdown() {
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
}
//# sourceMappingURL=main.js.map