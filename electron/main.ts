import { app, BrowserWindow, dialog, Menu, ipcMain, shell, Notification } from 'electron';
import type { NotificationConstructorOptions } from 'electron';
import { ChildProcess, execSync } from 'child_process';
import path from 'path';
import { findAvailablePort } from './port-finder';
import { startBackendServer } from './server';
import { checkCliHealth } from './cli-check';

const isDev = !!process.env.ELECTRON_DEV;
const APP_ENTRY_PATH = '/workspace/projects';
const DEFAULT_PORT = 4000;

/** develop-static 根目录（main 编译在 electron/dist 下） */
const projectRoot = path.join(__dirname, '..', '..');

function loadDevConfig(): { clientPort: number; clientLoadOrigin: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadDevServerConfig } = require(path.join(
      projectRoot,
      'config',
      'load-dev-server.cjs',
    )) as { loadDevServerConfig: (root: string) => { clientPort: number; clientLoadOrigin: string } };
    return loadDevServerConfig(projectRoot);
  } catch {
    return { clientPort: DEFAULT_PORT, clientLoadOrigin: `http://127.0.0.1:${DEFAULT_PORT}` };
  }
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let backendShutdownDone = false;
let serverPort = DEFAULT_PORT;
let windowLoadOrigin = `http://127.0.0.1:${DEFAULT_PORT}`;

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

// ── IPC: 打开文件夹选择对话框 ──
ipcMain.handle('open-folder-dialog', async () => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
  const options = { properties: ['openDirectory' as const], title: '选择文件夹' };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── IPC: 用系统默认应用打开文件 ──
ipcMain.handle('open-file', async (_event, filePath: string) => {
  if (!filePath || typeof filePath !== 'string') return { error: 'Invalid path' };
  try {
    const err = await shell.openPath(filePath);
    return err ? { error: err } : { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

// ── IPC: 显示系统通知 ──
ipcMain.handle(
  'show-notification',
  async (
    event,
    options: {
      title: string;
      body: string;
      icon?: string;
      tag?: string;
      sessionId?: string;
      requireInteraction?: boolean;
      focusAppOnClick?: boolean;
    }
  ) => {
    try {
      const notificationOptions: NotificationConstructorOptions & {
        requireInteraction?: boolean;
      } = {
        title: options.title,
        body: options.body,
        icon: options.icon,
        requireInteraction: options.requireInteraction ?? true,
      };

      const notification = new Notification(notificationOptions);

      notification.on('click', () => {
        if (options.focusAppOnClick !== false && mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }

        if (options.sessionId) {
          event.sender.send('notification-clicked', {
            sessionId: options.sessionId,
            timestamp: Date.now(),
          });
        }
      });

      notification.on('close', () => {
        console.debug(`[Notification] 用户关闭通知: ${options.title}`);
      });

      notification.show();
      return true;
    } catch (error) {
      console.error('[Notification] 显示失败:', error);
      return false;
    }
  }
);

// ── 创建主窗�?────────────────────────────────────────
function createMainWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ProjectPilot',
    show: isDev, // 开发模式立即显示，避免 5s 加载期间用户误以为未启动
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // 开发态加载 Vite：需允许 eval/inline，否则脚本不执行 → 白屏（生产仍为 true）
      webSecurity: !isDev,
    },
  });
  mainWindow.removeMenu();

  if (isDev) {
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
      console.error('[electron] did-fail-load', code, desc, validatedURL);
    });
  }

  mainWindow.loadURL(`${windowLoadOrigin}${APP_ENTRY_PATH}`);

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (!isDev) mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── 启动流程 ──────────────────────────────────────────
app.whenReady().then(async () => {
  if (isDev) {
    const devCfg = loadDevConfig();
    serverPort = devCfg.clientPort;
    windowLoadOrigin = devCfg.clientLoadOrigin;
    createMainWindow();
    return;
  }

  let splash: BrowserWindow | null = null;

  try {
    splash = new BrowserWindow({
      width: 400,
      height: 300,
      frame: false,
      transparent: false,
      resizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    splash.loadFile(path.join(__dirname, '..', 'splash.html'));

    serverPort = await findAvailablePort(DEFAULT_PORT);

    serverProcess = await startBackendServer(serverPort);

    splash.close();
    splash = null;
    windowLoadOrigin = `http://127.0.0.1:${serverPort}`;
    createMainWindow();

    setTimeout(() => {
      checkCliHealth(serverPort).catch(() => {});
    }, 3000);

  } catch (err) {
    if (splash) splash.close();
    dialog.showErrorBox(
      '启动失败',
      `Hono 后端服务器启动失败：\n${err instanceof Error ? err.message : String(err)}\n\n请尝试重新安装或联系开发者。`
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

/**
 * 结束内嵌 Hono 进程；Windows 上 child.kill 常杀不干净子进程，用 taskkill /T /F 清进程树。
 */
function killChildProcessTree(child: ChildProcess | null): void {
  if (!child?.pid) return;
  const pid = child.pid;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
}

function gracefulShutdown() {
  if (backendShutdownDone) return;
  backendShutdownDone = true;
  if (serverProcess) {
    killChildProcessTree(serverProcess);
    serverProcess = null;
  }
}

