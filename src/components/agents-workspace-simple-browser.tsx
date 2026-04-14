'use client';

import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Maximize2, Minimize2, RotateCw } from 'lucide-react';
import { useTranslations } from '@/client/i18n/use-translations';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const SIMPLE_BROWSER_URL_KEY = 'pp.agentsRail.simpleBrowserUrl.v1';
const SIMPLE_BROWSER_SEARCH_ENGINE_KEY = 'pp.agentsRail.simpleBrowserSearchEngine.v1';
const WEBVIEW_PARTITION = 'persist:pp-agents-simple-browser';
const DEFAULT_WORKSPACE_FILL_HOST_ID = 'pp-agents-workspace-browser-fill';

type SimpleBrowserSearchEngineId = 'google' | 'bing' | 'duckduckgo' | 'baidu';

const SEARCH_ENGINE_IDS: SimpleBrowserSearchEngineId[] = ['google', 'bing', 'duckduckgo', 'baidu'];

const SEARCH_ENGINE_LABEL_KEY: Record<SimpleBrowserSearchEngineId, 'searchEngineGoogle' | 'searchEngineBing' | 'searchEngineDuckduckgo' | 'searchEngineBaidu'> = {
  google: 'searchEngineGoogle',
  bing: 'searchEngineBing',
  duckduckgo: 'searchEngineDuckduckgo',
  baidu: 'searchEngineBaidu',
};

function readStoredSearchEngine(): SimpleBrowserSearchEngineId {
  try {
    const raw = localStorage.getItem(SIMPLE_BROWSER_SEARCH_ENGINE_KEY)?.trim();
    if (raw && (SEARCH_ENGINE_IDS as string[]).includes(raw)) return raw as SimpleBrowserSearchEngineId;
  } catch {
    /* ignore */
  }
  return 'google';
}

function writeStoredSearchEngine(id: SimpleBrowserSearchEngineId) {
  try {
    localStorage.setItem(SIMPLE_BROWSER_SEARCH_ENGINE_KEY, id);
  } catch {
    /* ignore */
  }
}

function buildSearchUrl(engine: SimpleBrowserSearchEngineId, query: string): string {
  const q = encodeURIComponent(query);
  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${q}`;
    case 'bing':
      return `https://www.bing.com/search?q=${q}`;
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${q}`;
    case 'baidu':
      return `https://www.baidu.com/s?wd=${q}`;
    default:
      return `https://www.google.com/search?q=${q}`;
  }
}

function readStoredUrl(): string {
  try {
    const raw = localStorage.getItem(SIMPLE_BROWSER_URL_KEY)?.trim();
    if (raw && /^https?:\/\//i.test(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'about:blank';
}

function writeStoredUrl(url: string) {
  try {
    if (url && url !== 'about:blank') localStorage.setItem(SIMPLE_BROWSER_URL_KEY, url);
  } catch {
    /* ignore */
  }
}

/** 仅允许 http(s)，与主进程 `open-external-url` 策略一致 */
export function normalizeSimpleBrowserUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || t === 'about:blank') return 'about:blank';
  if (/^javascript:/i.test(t) || /^data:/i.test(t) || /^file:/i.test(t) || /^vbscript:/i.test(t)) {
    return null;
  }
  if (/^https?:\/\//i.test(t)) {
    try {
      const u = new URL(t);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  }
  const candidate = t.includes('://') ? t : `https://${t}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isGoogleOAuthHost(host: string) {
  const h = host.toLowerCase();
  return h === 'accounts.google.com' || h === 'oauth2.googleapis.com';
}

/** 浏览器模式（非 Electron `<webview>`）下 iframe 跨域无法使用子 frame 的 history；由父页面维护会话栈 */
type IframeSessionNav = { stack: string[]; index: number };

type WebviewLike = HTMLElement & {
  getURL?: () => string;
  loadURL?: (url: string) => void;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
};

function readWillNavigateUrl(e: Event): string | undefined {
  const anyE = e as unknown as { url?: string };
  return typeof anyE.url === 'string' ? anyE.url : undefined;
}

export function AgentsWorkspaceSimpleBrowser({
  className,
  workspaceFill = false,
  onWorkspaceFillChange,
  workspaceFillHostId = DEFAULT_WORKSPACE_FILL_HOST_ID,
}: {
  className?: string;
  /** 铺满 Agents 页顶栏以下区域（Portal），非系统全屏 */
  workspaceFill?: boolean;
  onWorkspaceFillChange?: (expanded: boolean) => void;
  workspaceFillHostId?: string;
}) {
  const t = useTranslations('agentsWorkspace.simpleBrowser');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const webviewRef = useRef<WebviewLike | null>(null);
  /** 固定初始 `src`，后续仅用 `loadURL`，避免受控 `src` 与访客会话错位导致整页重载 */
  const webviewBootSrc = useMemo(() => readStoredUrl(), []);

  const hasElectron = typeof window !== 'undefined' && typeof window.electron?.openExternalUrl === 'function';
  const useWebview = hasElectron;

  const [iframeNav, setIframeNav] = useState<IframeSessionNav>(() => {
    const u = readStoredUrl();
    if (u === 'about:blank') return { stack: [], index: -1 };
    return { stack: [u], index: 0 };
  });
  const iframeSrc = iframeNav.index >= 0 ? iframeNav.stack[iframeNav.index] : undefined;
  const [addressInput, setAddressInput] = useState(() => {
    const u = readStoredUrl();
    return u === 'about:blank' ? '' : u;
  });
  const [hist, setHist] = useState({ back: false, fwd: false });
  const [searchEngine, setSearchEngine] = useState<SimpleBrowserSearchEngineId>(() => readStoredSearchEngine());
  const [fillPortalHost, setFillPortalHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!workspaceFill) {
      setFillPortalHost(null);
      return;
    }
    setFillPortalHost(document.getElementById(workspaceFillHostId));
  }, [workspaceFill, workspaceFillHostId]);

  useEffect(() => {
    if (!workspaceFill || !onWorkspaceFillChange) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onWorkspaceFillChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspaceFill, onWorkspaceFillChange]);

  const refreshHist = useCallback(() => {
    const w = webviewRef.current;
    if (!w?.canGoBack) return;
    setHist({ back: w.canGoBack(), fwd: w.canGoForward?.() ?? false });
  }, []);

  const syncAddressFromWebview = useCallback(() => {
    const w = webviewRef.current;
    const url = w?.getURL?.();
    if (url && /^https?:\/\//i.test(url)) {
      setAddressInput(url);
      writeStoredUrl(url);
    }
    refreshHist();
  }, [refreshHist]);

  useEffect(() => {
    const w = webviewRef.current;
    if (!w || !useWebview) return;

    const onWillNavigate = (e: Event) => {
      const url = readWillNavigateUrl(e);
      if (!url) return;
      try {
        const host = new URL(url).hostname;
        if (isGoogleOAuthHost(host)) {
          (e as unknown as { preventDefault?: () => void }).preventDefault?.();
          void window.electron?.openExternalUrl(url);
        }
      } catch {
        /* ignore */
      }
    };

    const bump = () => {
      syncAddressFromWebview();
    };

    w.addEventListener('will-navigate', onWillNavigate);
    w.addEventListener('did-navigate', bump);
    w.addEventListener('did-navigate-in-page', bump);
    w.addEventListener('dom-ready', bump);
    return () => {
      w.removeEventListener('will-navigate', onWillNavigate);
      w.removeEventListener('did-navigate', bump);
      w.removeEventListener('did-navigate-in-page', bump);
      w.removeEventListener('dom-ready', bump);
    };
  }, [useWebview, syncAddressFromWebview]);

  const applyUrl = useCallback(
    (nextRaw: string) => {
      const normalized = normalizeSimpleBrowserUrl(nextRaw);
      if (normalized == null) return false;
      setAddressInput(normalized === 'about:blank' ? '' : normalized);
      writeStoredUrl(normalized);
      if (useWebview) {
        queueMicrotask(() => {
          if (normalized === 'about:blank') webviewRef.current?.loadURL?.('about:blank');
          else webviewRef.current?.loadURL?.(normalized);
          refreshHist();
        });
      } else {
        setIframeNav((prev) => {
          if (normalized === 'about:blank') return { stack: [], index: -1 };
          if (prev.index >= 0 && prev.stack[prev.index] === normalized) return prev;
          const nextStack = prev.stack.slice(0, prev.index + 1);
          nextStack.push(normalized);
          return { stack: nextStack, index: nextStack.length - 1 };
        });
      }
      return true;
    },
    [useWebview, refreshHist],
  );

  const onSubmitAddress = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const raw = addressInput.trim();
      if (!raw) {
        applyUrl('about:blank');
        return;
      }
      const normalized = normalizeSimpleBrowserUrl(raw);
      if (normalized != null) {
        applyUrl(raw);
        return;
      }
      applyUrl(buildSearchUrl(searchEngine, raw));
    },
    [addressInput, applyUrl, searchEngine],
  );

  const onSearchEngineValueChange = useCallback((id: string) => {
    if (!(SEARCH_ENGINE_IDS as string[]).includes(id)) return;
    setSearchEngine(id as SimpleBrowserSearchEngineId);
    writeStoredSearchEngine(id as SimpleBrowserSearchEngineId);
  }, []);

  const goBack = () => {
    if (useWebview) {
      webviewRef.current?.goBack?.();
      queueMicrotask(refreshHist);
      return;
    }
    setIframeNav((prev) => {
      if (prev.index <= 0) return prev;
      const nextIndex = prev.index - 1;
      const url = prev.stack[nextIndex]!;
      queueMicrotask(() => {
        setAddressInput(url === 'about:blank' ? '' : url);
        writeStoredUrl(url === 'about:blank' ? 'about:blank' : url);
      });
      return { stack: prev.stack, index: nextIndex };
    });
  };
  const goForward = () => {
    if (useWebview) {
      webviewRef.current?.goForward?.();
      queueMicrotask(refreshHist);
      return;
    }
    setIframeNav((prev) => {
      if (prev.index < 0 || prev.index >= prev.stack.length - 1) return prev;
      const nextIndex = prev.index + 1;
      const url = prev.stack[nextIndex]!;
      queueMicrotask(() => {
        setAddressInput(url === 'about:blank' ? '' : url);
        writeStoredUrl(url === 'about:blank' ? 'about:blank' : url);
      });
      return { stack: prev.stack, index: nextIndex };
    });
  };
  const reload = () => {
    if (useWebview) {
      webviewRef.current?.reload?.();
      return;
    }
    const el = iframeRef.current;
    if (!el) return;
    // 跨域 iframe 不能读/调 contentWindow.location，会抛 SecurityError；由父文档改 src 触发等价重载
    const src = el.src || iframeSrc;
    if (src) el.src = src;
  };

  const openExternal = () => {
    const u = normalizeSimpleBrowserUrl(addressInput.trim() || readStoredUrl());
    if (u && u !== 'about:blank') void window.electron?.openExternalUrl(u);
  };

  const toggleWorkspaceFill = useCallback(() => {
    onWorkspaceFillChange?.(!workspaceFill);
  }, [onWorkspaceFillChange, workspaceFill]);

  const toolbarBtn =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted-foreground/15 hover:text-foreground disabled:pointer-events-none disabled:opacity-35';

  const webviewEl = useWebview
    ? createElement('webview', {
        ref: (node: WebviewLike | null) => {
          webviewRef.current = node;
        },
        className: 'relative z-0 min-h-0 w-full flex-1 border-0 bg-background',
        src: webviewBootSrc,
        partition: WEBVIEW_PARTITION,
        allowpopups: 'true',
        webpreferences: 'contextIsolation=yes,nodeIntegration=no',
        style: { minHeight: 0 },
      })
    : null;

  const canWorkspaceFill = typeof onWorkspaceFillChange === 'function';

  const panel = (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/20 dark:bg-muted/10',
        workspaceFill ? 'h-full w-full flex-1 bg-background' : 'flex-1',
        className,
      )}
      data-rail-panel-body="simple-browser"
    >
      {/* Electron `<webview>` 易叠在兄弟 DOM 之上，须提高工具栏 z-index */}
      <div className="relative z-30 flex shrink-0 flex-col gap-2 border-b border-border/60 bg-muted/30 px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-md border border-border/50 bg-background/50 p-0.5 shadow-sm dark:bg-background/20">
            <button
              type="button"
              className={toolbarBtn}
              title={t('back')}
              aria-label={t('back')}
              onClick={goBack}
              disabled={useWebview ? !hist.back : iframeNav.index <= 0}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              className={toolbarBtn}
              title={t('forward')}
              aria-label={t('forward')}
              onClick={goForward}
              disabled={useWebview ? !hist.fwd : iframeNav.index < 0 || iframeNav.index >= iframeNav.stack.length - 1}
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" className={toolbarBtn} title={t('reload')} aria-label={t('reload')} onClick={reload}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Select value={searchEngine} onValueChange={onSearchEngineValueChange}>
              <SelectTrigger
                title={t('searchEngineAria')}
                aria-label={t('searchEngineAria')}
                className={cn(
                  'h-7 min-h-7 w-[min(100%,7.75rem)] shrink-0 gap-1 rounded-md border-border/50 bg-background/50 px-2 py-0 font-sans text-[11px] font-medium leading-none shadow-sm transition-colors',
                  'text-muted-foreground hover:bg-background hover:text-foreground dark:bg-background/20',
                  'focus:ring-1 focus:ring-ring data-[placeholder]:text-muted-foreground [&>svg]:h-3 [&>svg]:w-3 [&>svg]:shrink-0 [&>svg]:opacity-60',
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                sideOffset={6}
                align="start"
                className="z-[200] max-h-[min(16rem,var(--radix-select-content-available-height))] rounded-lg border-border/70 bg-popover/95 p-1 shadow-lg backdrop-blur-sm dark:bg-popover"
              >
                {SEARCH_ENGINE_IDS.map((id) => (
                  <SelectItem
                    key={id}
                    value={id}
                    className="cursor-pointer rounded-md py-2 pl-2.5 pr-8 text-[13px] font-medium focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-accent/50"
                  >
                    {t(SEARCH_ENGINE_LABEL_KEY[id])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* flex：地址栏可收缩；按钮 shrink-0，避免被 webview 叠层盖住时误用 grid 视觉异常 */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <form
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-border/50 bg-background shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 dark:bg-background/50',
                  workspaceFill && 'max-w-[600px]',
                )}
                onSubmit={onSubmitAddress}
              >
                <div className="flex h-full pl-2.5 pr-1.5 items-center text-muted-foreground/50">
                  <Globe className="h-3.5 w-3.5" />
                </div>
                <input
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder={t('addressPlaceholder')}
                  spellCheck={false}
                  className={cn(
                    'h-7 w-full min-w-0 bg-transparent px-1 font-mono text-[11px] text-foreground outline-none',
                    workspaceFill && 'max-w-[600px]',
                  )}
                  aria-label={t('addressAria')}
                />
              </form>
              
              <div className="flex items-center gap-0.5 pl-1">
                {canWorkspaceFill ? (
                  <button
                    type="button"
                    className={cn(toolbarBtn, 'shrink-0')}
                    title={workspaceFill ? t('fullscreenExit') : t('fullscreenEnter')}
                    aria-label={workspaceFill ? t('fullscreenExit') : t('fullscreenEnter')}
                    aria-pressed={workspaceFill}
                    onClick={toggleWorkspaceFill}
                  >
                    {workspaceFill ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
                  </button>
                ) : null}
                {hasElectron ? (
                  <button type="button" className={toolbarBtn} title={t('openExternal')} aria-label={t('openExternal')} onClick={openExternal}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
            {workspaceFill ? <div className="w-[100px] shrink-0" aria-hidden /> : null}
          </div>
        </div>
      </div>
      <div className="relative z-0 min-h-0 flex-1 bg-background">
        {useWebview ? (
          webviewEl
        ) : (
          <iframe
            key={`${iframeNav.index}:${iframeSrc ?? 'blank'}`}
            ref={iframeRef}
            title={t('iframeTitle')}
            src={iframeSrc}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </div>
  );

  if (workspaceFill && fillPortalHost && canWorkspaceFill) {
    return createPortal(panel, fillPortalHost);
  }
  return panel;
}
