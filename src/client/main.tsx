import '@fontsource-variable/inter';
import { i18nInitPromise } from './i18n/config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../app/globals.css';

/* 全局兜底：任何未捕获的错误都写进 #root，而非白屏 */
function showFatalOverlay(label: string, err: unknown) {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err);
  console.error(`[FATAL ${label}]`, err);
  const el = document.getElementById('root');
  if (el) {
    el.innerHTML = `<div style="padding:32px;font-family:monospace;font-size:13px;line-height:1.6;color:#dc2626;background:#fef2f2;min-height:100vh;overflow:auto">
      <h1 style="font-size:18px;font-weight:700;margin-bottom:12px">ProjectPilot – ${label}</h1>
      <pre style="white-space:pre-wrap;word-break:break-all">${msg.replace(/</g, '&lt;')}</pre>
      <button onclick="location.reload()" style="margin-top:20px;padding:8px 20px;border:1px solid #dc2626;border-radius:6px;cursor:pointer;background:#fff;color:#dc2626;font-weight:600">Reload</button>
    </div>`;
  }
}
window.addEventListener('error', (e) => showFatalOverlay('Uncaught Error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showFatalOverlay('Unhandled Promise Rejection', e.reason));

const rootEl = document.getElementById('root');
if (!rootEl) {
  console.error('[app] #root missing');
} else {
  const root = createRoot(rootEl);
  root.render(
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>,
  );
  void i18nInitPromise
    .then(() => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    })
    .catch((e) => {
      console.error('[i18n] init failed', e);
      // 仍尝试挂载，避免整页空白；若 t() 异常请检查 messages JSON
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
}
