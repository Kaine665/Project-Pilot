import { app, BrowserWindow, dialog, Menu } from 'electron';
import { ChildProcess } from 'child_process';
import path from 'path';
import { findAvailablePort } from './port-finder';
import { startNextServer } from './server';
import { checkCliHealth } from './cli-check';

const isDev = !!process.env.ELECTRON_DEV;
const DEV_PORT = 4000;

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort: number = DEV_PORT;

// ── 单实例锁 ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── 创建主窗口 ────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
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
  } else {
    // 生产环境不需要菜单栏
    Menu.setApplicationMenu(null);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 启动流程 ──────────────────────────────────────────
app.whenReady().then(async () => {
  if (isDev) {
    // Dev 模式：假设 Next.js dev server 已在外部运行
    serverPort = DEV_PORT;
    createMainWindow();
    return;
  }

  // 生产模式：启动内嵌 standalone server
  let splash: BrowserWindow | null = null;

  try {
    // 显示 splash
    splash = new BrowserWindow({
      width: 400,
      height: 300,
      frame: false,
      transparent: false,
      resizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    splash.loadFile(path.join(__dirname, 'splash.html'));

    // 找端口
    serverPort = await findAvailablePort(4000);

    // 启动 server
    serverProcess = await startNextServer(serverPort);

    // 关 splash，开主窗口
    splash.close();
    splash = null;
    createMainWindow();

    // 延迟检测 CLI
    setTimeout(() => {
      checkCliHealth(serverPort).catch(() => {});
    }, 3000);

  } catch (err) {
    if (splash) splash.close();
    dialog.showErrorBox(
      '启动失败',
      `Next.js 服务器启动失败：\n${err instanceof Error ? err.message : String(err)}\n\n请尝试重新安装或联系开发者。`
    );
    app.quit();
  }
});

// ── 生命周期 ──────────────────────────────────────────
app.on('window-all-closed', () => {
  gracefulShutdown();
  app.quit();
});

app.on('before-quit', () => {
  gracefulShutdown();
});

function gracefulShutdown() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}
