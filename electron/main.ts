import { app, BrowserWindow, dialog, Menu, ipcMain, shell, Notification } from 'electron';
import type { NotificationConstructorOptions } from 'electron';
import { ChildProcess, execSync } from 'child_process';
import path from 'path';
import { findAvailablePort } from './port-finder';
import { startBackendServer } from './server';

/** 部分 Windows 显卡驱动下 Chromium 白屏；设环境变量 `PROJECT_PILOT_DISABLE_GPU=1` 后重启 Electron 可验证 */
if (process.env.PROJECT_PILOT_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

const isDev = !!process.env.ELECTRON_DEV;
const APP_ENTRY_PATH = '/workspace/projects';
/** 本地 `npm run dev` / `electron-dev` 与 `config/dev-server.json` 一致；`loadDevConfig` 失败时的回退 */
const DEV_CLIENT_FALLBACK_PORT = 4000;
/** 打包后内嵌 Hono 首选端口（与生产 bundle 约定一致；占用时由 `port-finder` 回退） */
const PACKAGED_EMBEDDED_PORT = 4287;

/** 开发态 Vite 偶发未就绪或连接被重置时首屏白屏；限次自动重载 */
let devMainLoadAttempts = 0;
const DEV_MAIN_LOAD_MAX = 30;

/** 仓库根目录（main 编译在 electron/dist 下） */
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
    return {
      clientPort: DEV_CLIENT_FALLBACK_PORT,
      clientLoadOrigin: `http://127.0.0.1:${DEV_CLIENT_FALLBACK_PORT}`,
    };
  }
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let backendShutdownDone = false;
let serverPort = PACKAGED_EMBEDDED_PORT;
let windowLoadOrigin = `http://127.0.0.1:${PACKAGED_EMBEDDED_PORT}`;

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

// ── 单实例锁（仅生产 / 打包）─────────────────────────────
// 开发与安装版共用 `appId`（package.json `build.appId`），若此处对 `electron-dev` 也加锁，
// 则安装版已运行时 `npm run electron:dev` 会拿不到锁并立刻退出，用户误以为「没启动」。
if (!isDev) {
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
}

if (process.platform === 'darwin') {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (OAUTH_RETURN_PROTOCOL.test(url)) {
      bringMainWindowFromBrowserOAuth();
    }
  });
}

// ── 内嵌 Hono 子进程（生产）与优雅退出 ─────────────────────

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

/** Chromium net::ERR_CONNECTION_REFUSED */
const CHROME_ERR_CONNECTION_REFUSED = -102;

/** 生产：内嵌后端崩溃后用户点「Reload」会连不上本机端口；限次自动拉起 Hono 并重载当前 URL */
let prodMainLoadRecoveryAttempts = 0;
const PROD_MAIN_LOAD_RECOVERY_MAX = 8;
let prodBackendRecoveryInFlight = false;

function wireBackendProcessExit(proc: ChildProcess) {
  proc.once('exit', (code, signal) => {
    console.error('[electron] embedded Hono process exited', { code, signal });
    if (serverProcess === proc) {
      serverProcess = null;
    }
  });
}

function failedUrlLoopbackPortMatchesServer(failedUrl: string): boolean {
  try {
    const u = new URL(failedUrl);
    const h = u.hostname.toLowerCase();
    if (h !== '127.0.0.1' && h !== 'localhost' && h !== '[::1]') {
      return false;
    }
    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    return port === serverPort;
  } catch {
    return false;
  }
}

async function recoverProdEmbeddedBackendAndReload(targetUrl: string): Promise<void> {
  killChildProcessTree(serverProcess);
  serverProcess = null;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 400);
  });
  const proc = await startBackendServer(serverPort);
  serverProcess = proc;
  wireBackendProcessExit(proc);
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(targetUrl);
  }
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
/**
 * Win/Linux 无边框顶栏高度（与 preload `titleBarOverlay.height`、renderer
 * `TITLE_BAR_OVERLAY_HEIGHT_PX` 同步）。
 * macOS 不启用 `titleBarOverlay`，顶栏为 `TopNav`，改此常量不会在 macOS 上生效。
 */
const TITLE_BAR_OVERLAY_PX = 36;

function createMainWindow() {
  Menu.setApplicationMenu(null);
  const useWindowControlsOverlay = process.platform !== 'darwin';
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ProjectPilot',
    show: isDev, // 开发模式立即显示，避免 5s 加载期间用户误以为未启动
    autoHideMenuBar: true,
    ...(useWindowControlsOverlay
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#ffffff',
            symbolColor: '#52525b',
            height: TITLE_BAR_OVERLAY_PX,
          },
        }
      : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      /** Agents 工作区「简单浏览器」侧栏：`<webview>`（与 Cursor Simple Browser 同类） */
      webviewTag: true,
      // 开发态加载 Vite：需允许 eval/inline，否则脚本不执行 → 白屏（生产仍为 true）
      webSecurity: !isDev,
    },
  });
  mainWindow.removeMenu();

  // 与 PR #48 的 openExternalUrl 主路径互补：若回退到 window.open，Electron 会新开 BrowserWindow。
  // Google 域名 + 本机 /oauth/google/*（回调、Drive 桥接）一律用系统浏览器，便于走系统代理/VPN。
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url);
      const host = url.hostname.toLowerCase();
      if (host === 'accounts.google.com' || host === 'oauth2.googleapis.com') {
        void shell.openExternal(details.url);
        return { action: 'deny' };
      }
      const loopback =
        host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
      if (loopback && url.pathname.includes('/oauth/google/')) {
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

  mainWindow.webContents.on('did-finish-load', () => {
    devMainLoadAttempts = 0;
    prodMainLoadRecoveryAttempts = 0;
  });

  if (isDev) {
    const devEntryUrl = () => `${windowLoadOrigin}${APP_ENTRY_PATH}`;

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
  } else {
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (errorCode === -3) return;

        const canRecoverEmbedded =
          errorCode === CHROME_ERR_CONNECTION_REFUSED
          && !prodBackendRecoveryInFlight
          && failedUrlLoopbackPortMatchesServer(validatedURL)
          && prodMainLoadRecoveryAttempts < PROD_MAIN_LOAD_RECOVERY_MAX;

        if (canRecoverEmbedded) {
          prodBackendRecoveryInFlight = true;
          prodMainLoadRecoveryAttempts += 1;
          console.warn(
            `[electron] prod did-fail-load (${errorCode}), restarting embedded Hono (${prodMainLoadRecoveryAttempts}/${PROD_MAIN_LOAD_RECOVERY_MAX}) → ${validatedURL}`,
          );
          void (async () => {
            try {
              await recoverProdEmbeddedBackendAndReload(validatedURL);
            } catch (e) {
              console.error('[electron] embedded backend recovery failed:', e);
              dialog.showErrorBox(
                '页面加载失败',
                `无法恢复内嵌服务（已尝试重启 Hono）。\n\n${e instanceof Error ? e.message : String(e)}\n\n错误码: ${errorCode}\n${errorDescription}\n\nURL: ${validatedURL}\n\n若端口被其它程序占用，请关闭后再试；也可完全退出应用后重新启动。`,
              );
            } finally {
              prodBackendRecoveryInFlight = false;
            }
          })();
          return;
        }

        console.error('[electron] prod did-fail-load', errorCode, errorDescription, validatedURL);
        dialog.showErrorBox(
          '页面加载失败',
          `无法加载应用界面（主进程已收到 did-fail-load）。\n\n错误码: ${errorCode}\n${errorDescription}\n\nURL: ${validatedURL}\n\n请确认已执行完整构建（npm run build），或尝试关闭占用端口的其它程序后重试。\n若怀疑显卡兼容问题，可在启动前设置环境变量 PROJECT_PILOT_DISABLE_GPU=1。\n\n若此前界面曾正常使用，可能是内嵌服务已退出：应用会自动尝试重启（限 ${PROD_MAIN_LOAD_RECOVERY_MAX} 次）；仍失败时请完全退出后重启应用。`,
        );
      },
    );
  }

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] render-process-gone', details);
    if (!isDev && details.reason !== 'clean-exit') {
      dialog.showErrorBox(
        '渲染进程异常退出',
        `ProjectPilot 界面进程已退出，通常由页面脚本崩溃或内存不足引起。\n\n原因: ${details.reason}\n退出码: ${details.exitCode}\n\n请从终端重新启动应用；若持续出现，可设置 PROJECT_PILOT_DISABLE_GPU=1 排除显卡加速问题。`,
      );
    }
  });

  if (isDev && process.env.PROJECT_PILOT_ELECTRON_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
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

    serverPort = await findAvailablePort(PACKAGED_EMBEDDED_PORT);

    serverProcess = await startBackendServer(serverPort);
    wireBackendProcessExit(serverProcess);

    splash.close();
    splash = null;
    windowLoadOrigin = `http://127.0.0.1:${serverPort}`;
    createMainWindow();
    if (argvHasOAuthReturnProtocol(process.argv)) {
      setTimeout(() => bringMainWindowFromBrowserOAuth(), 600);
    }

    setTimeout(() => {
      void import('./cli-check')
        .then((m) => m.checkCliHealth(serverPort))
        .catch(() => {});
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
