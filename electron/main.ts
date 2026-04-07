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

/** 开发态 Vite 偶发未就绪或连接被重置时首屏白屏；限次自动重载 */
let devMainLoadAttempts = 0;
const DEV_MAIN_LOAD_MAX = 30;

/** develop-static 根目录（main 编译在 electron/dist 下） */
const projectRoot = path.join(__dirname, '..', '..');

/** 浏览器 OAuth 结束页可打开此 URL，将已运行的应用置前（须注册为协议客户端） */
const OAUTH_RETURN_PROTOCOL = /^projectpilot:\/\/oauth\//i;

/**
 * 须在 app ready 之前调用（Electron 要求）。
 * 开发态：electron . 时需把应用路径传给 Windows，否则 projectpilot:// 无法唤起本实例。
 */
function registerOAuthReturnProtocol(): void {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const entry = path.resolve(process.argv[1] ?? '.');
        app.setAsDefaultProtocolClient('projectpilot', process.execPath, [entry]);
      } else {
        app.setAsDefaultProtocolClient('projectpilot');
      }
    } else {
      app.setAsDefaultProtocolClient('projectpilot');
    }
  } catch (e) {
    console.warn('[electron] setAsDefaultProtocolClient(projectpilot) failed:', e);
  }
}

registerOAuthReturnProtocol();

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

function bringMainWindowFromBrowserOAuth(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setSkipTaskbar(false);
  try {
    mainWindow.moveTop();
  } catch {
    /* 部分系统不允许 */
  }
  mainWindow.focus();
  try {
    app.focus({ steal: true });
  } catch {
    /* 旧版 Electron */
  }
  if (process.platform === 'win32') {
    mainWindow.flashFrame(true);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false);
    }, 2200);
  }
}

function argvHasOAuthReturnProtocol(argv: string[]): boolean {
  return argv.some((a) => OAUTH_RETURN_PROTOCOL.test(a));
}

// ── 单实例锁 ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, commandLine) => {
  const argv = Array.isArray(commandLine)
    ? commandLine
    : String(commandLine)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
  if (argv.some((a) => OAUTH_RETURN_PROTOCOL.test(a))) {
    bringMainWindowFromBrowserOAuth();
    return;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (OAUTH_RETURN_PROTOCOL.test(url)) {
      bringMainWindowFromBrowserOAuth();
    }
  });
}

// ── IPC: 打开文件夹选择对话框 ──
// 必须用发起 IPC 的 BrowserWindow 作 parent；仅用 mainWindow / getFocusedWindow 在嵌套 UI 下常错配，导致对话框打不开或焦点异常。
ipcMain.handle('open-folder-dialog', async (event) => {
  const win =
    BrowserWindow.fromWebContents(event.sender) ??
    mainWindow ??
    BrowserWindow.getFocusedWindow() ??
    undefined;
  const options = { properties: ['openDirectory' as const], title: '选择文件夹' };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── IPC: OAuth 完成后聚焦主窗口（系统浏览器里点完 Google 返回应用）──
ipcMain.handle('focus-main-window', async () => {
  bringMainWindowFromBrowserOAuth();
});

// ── IPC: 在系统默认浏览器中打开 URL（Google OAuth 等，避免内嵌 WebView 被策略拦截）──
ipcMain.handle('open-external-url', async (_event, targetUrl: string) => {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return { error: 'Invalid url' };
  }
  const u = targetUrl.trim();
  if (!/^https?:\/\//i.test(u)) {
    return { error: 'Only http(s) URLs are allowed' };
  }
  try {
    await shell.openExternal(u);
    return { ok: true as const };
  } catch (e) {
    return { error: (e as Error).message };
  }
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

  // 与 PR #48 的 openExternalUrl 主路径互补：若 preload 未注入而回退到 window.open，
  // Electron 会新开 BrowserWindow；拦截 Google OAuth 域名并强制系统浏览器打开。
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const host = new URL(details.url).hostname.toLowerCase();
      if (host === 'accounts.google.com' || host === 'oauth2.googleapis.com') {
        void shell.openExternal(details.url);
        return { action: 'deny' };
      }
    } catch {
      /* ignore invalid URL */
    }
    return { action: 'allow' };
  });

  // Safety net: 若 window.location.href 被设为 Google OAuth URL（preload 未注入时的 fallback），
  // 拦截主帧导航并改为系统浏览器打开，防止 Google 页面在 Electron 内打开。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === 'accounts.google.com' || host === 'oauth2.googleapis.com') {
        event.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      /* ignore invalid URL */
    }
  });

  if (isDev) {
    const devEntryUrl = () => `${windowLoadOrigin}${APP_ENTRY_PATH}`;

    mainWindow.webContents.on('did-finish-load', () => {
      devMainLoadAttempts = 0;
    });

    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error('[electron] did-fail-load', errorCode, errorDescription, validatedURL);
        // ERR_ABORTED：被新导航取代等，勿重试
        if (errorCode === -3) return;
        if (devMainLoadAttempts >= DEV_MAIN_LOAD_MAX) return;
        devMainLoadAttempts += 1;
        const delay = Math.min(400 + devMainLoadAttempts * 200, 4000);
        const target = devEntryUrl();
        console.warn(
          `[electron] dev reload ${devMainLoadAttempts}/${DEV_MAIN_LOAD_MAX} in ${delay}ms → ${target}`,
        );
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            void mainWindow.loadURL(target);
          }
        }, delay);
      },
    );
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
    if (argvHasOAuthReturnProtocol(process.argv)) {
      setTimeout(() => bringMainWindowFromBrowserOAuth(), 600);
    }
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
    if (argvHasOAuthReturnProtocol(process.argv)) {
      setTimeout(() => bringMainWindowFromBrowserOAuth(), 600);
    }

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

