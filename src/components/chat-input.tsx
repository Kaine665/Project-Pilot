'use client';

import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Send, Square, X, Paperclip, UserPlus } from 'lucide-react';
import type { Agent } from '@/types';

/** 将 token 数格式化为易读字符串，如 "3.2k"、"120k" */
function formatTokens(n: number): string {
  if (n <= 0) return '0';
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/** 上下文窗口圆环（Cursor 风格），颜色随用量变化：绿 → 黄 → 橙 → 红 */
function TokenRing({ used, total, size = 16 }: { used: number; total: number; size?: number }) {
  const r = (size - 2.5) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  const dashOffset = circumference * (1 - pct);
  const color =
    pct < 0.7  ? '#22c55e'
    : pct < 0.85 ? '#f59e0b'
    : pct < 0.95 ? '#f97316'
    : '#ef4444';
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth="2"
        className="stroke-zinc-200 dark:stroke-zinc-700" />
      {pct > 0 && (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="2"
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease' }}
        />
      )}
    </svg>
  );
}

interface SkillItem {
  name: string;
  description: string;
}

interface ChatInputProps {
  onSubmit: (text: string, images: string[], files: Array<{ name: string; content: string }>) => void;
  onAbort: () => void;
  isStreaming: boolean;
  placeholder: string;
  /** Textarea min-height style */
  minHeight?: string;
  /** Whether to show the full-width textarea (butler mode) vs inline with send button */
  fullWidth?: boolean;
  /** Guest agent picker */
  guestAgents?: Agent[];
  showGuestPicker?: boolean;
  onSelectGuest?: (agent: Agent) => void;
  /** Key for persisting draft text in localStorage (e.g. sessionId). If omitted, no draft persistence. */
  draftKey?: string;
  /** Optional model selector for agent chat */
  modelProviderLabel?: string;
  providerOptions?: Array<{ value: string; label: string }>;
  providerValue?: string;
  onProviderChange?: (provider: string) => void;
  modelOptions?: Array<{ value: string; label: string }>;
  modelValue?: string;
  onModelChange?: (model: string) => void;
  effortOptions?: Array<{ value: string; label: string }>;
  effortValue?: string;
  onEffortChange?: (effort: string) => void;
  effortLabel?: string;
  /** 是否启用 / 命令（skill 选择器） */
  enableSlashCommands?: boolean;
  /** Token 用量信息（用于工具栏圆环指示器） */
  tokenInfo?: {
    promptEstimate: number;   // 系统提示词 token 估算
    inputTokens: number;      // 实际输入 token（含提示词，0 表示对话尚未开始）
    outputTokens: number;     // 实际输出 token
    contextWindow: number;    // 模型上下文窗口上限
  };
}

export const ChatInput = memo(function ChatInput({
  onSubmit,
  onAbort,
  isStreaming,
  placeholder,
  minHeight = '40px',
  fullWidth = false,
  guestAgents,
  showGuestPicker = false,
  onSelectGuest,
  draftKey,
  modelProviderLabel,
  providerOptions,
  providerValue,
  onProviderChange,
  modelOptions,
  modelValue,
  onModelChange,
  effortOptions,
  effortValue,
  onEffortChange,
  effortLabel,
  enableSlashCommands = false,
  tokenInfo,
}: ChatInputProps) {
  const draftStorageKey = draftKey ? `pp:draft:${draftKey}` : null;
  const historyStorageKey = 'pp:input-history';
  const [input, setInput] = useState(() => {
    if (!draftStorageKey) return '';
    try { return localStorage.getItem(draftStorageKey) ?? ''; } catch { return ''; }
  });
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [guestPickerOpen, setGuestPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 输入历史导航（上下箭头键）
  const historyIndexRef = useRef(-1); // -1 = 不在历史浏览模式
  const savedInputRef = useRef(''); // 进入历史浏览前暂存当前输入

  // Slash 命令菜单状态
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const skillsCacheRef = useRef<SkillItem[] | null>(null);
  const [skillsLoaded, setSkillsLoaded] = useState(false);

  // Persist draft text to localStorage (debounced)
  useEffect(() => {
    if (!draftStorageKey) return;
    const timer = setTimeout(() => {
      try {
        if (input) localStorage.setItem(draftStorageKey, input);
        else localStorage.removeItem(draftStorageKey);
      } catch { /* quota exceeded — ignore */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [input, draftStorageKey]);

  // Restore draft when draftKey changes (e.g. switching sessions)
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      const saved = localStorage.getItem(draftStorageKey) ?? '';
      setInput(saved);
      // Restore textarea height for saved content
      if (saved && textareaRef.current && !fullWidth) {
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        });
      }
    } catch { /* ignore */ }
  }, [draftStorageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const getHistory = useCallback((): string[] => {
    try { return JSON.parse(localStorage.getItem(historyStorageKey) ?? '[]'); } catch { return []; }
  }, []);

  const pushHistory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const hist = getHistory().filter(h => h !== trimmed); // 去重
      hist.push(trimmed);
      if (hist.length > 50) hist.splice(0, hist.length - 50);
      localStorage.setItem(historyStorageKey, JSON.stringify(hist));
    } catch { /* quota exceeded — ignore */ }
  }, [getHistory]);

  // 懒加载 skills 列表（仅在 enableSlashCommands 时调用）
  const loadSkills = useCallback(async () => {
    if (skillsCacheRef.current !== null) return;
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      skillsCacheRef.current = Array.isArray(data) ? data : [];
    } catch {
      skillsCacheRef.current = [];
    }
    setSkillsLoaded(true);
  }, []);

  // 获取过滤后的 skills 列表
  const getFilteredSkills = useCallback((): SkillItem[] => {
    const skills = skillsCacheRef.current ?? [];
    if (!slashQuery) return skills;
    const q = slashQuery.toLowerCase();
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashQuery, skillsLoaded]);

  // 选中 skill：把 /name 填入输入框
  const handleSkillSelect = useCallback((skill: SkillItem) => {
    setSlashOpen(false);
    setInput(`/${skill.name} `);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      }
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // 用户手动输入时退出历史浏览模式
    historyIndexRef.current = -1;
    const val = e.target.value;
    setInput(val);
    const el = e.target;
    if (!fullWidth) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
    // Slash 命令检测：输入框以 / 开头时触发菜单
    if (enableSlashCommands) {
      if (val.startsWith('/') && !val.includes(' ')) {
        // 输入中，还没有空格（未完成选择）
        const query = val.slice(1);
        setSlashQuery(query);
        setSlashIndex(0);
        setSlashOpen(true);
        loadSkills();
      } else {
        setSlashOpen(false);
      }
    }
  };

  const handleSubmit = () => {
    const fileParts = pendingFiles.map(f => `📎 **${f.name}**\n\`\`\`\n${f.content}\n\`\`\``);
    const fullText = fileParts.length > 0
      ? (input.trim() ? `${input.trim()}\n\n---\n${fileParts.join('\n\n')}` : fileParts.join('\n\n'))
      : input;
    if (!fullText.trim() && pendingImages.length === 0) return;
    pushHistory(input.trim());
    historyIndexRef.current = -1;
    onSubmit(fullText, [...pendingImages], [...pendingFiles]);
    setInput('');
    if (draftStorageKey) try { localStorage.removeItem(draftStorageKey); } catch { /* ignore */ }
    setPendingImages([]);
    setPendingFiles([]);
    // Reset textarea height
    if (textareaRef.current && !fullWidth) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash 菜单键盘导航（优先于其他处理）
    if (slashOpen && enableSlashCommands) {
      const filtered = getFilteredSkills();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        handleSkillSelect(filtered[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    // 输入历史导航：输入框为空（或已在浏览模式）时按上下键切换历史
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const hist = getHistory();
      if (hist.length === 0) return;
      const isBrowsing = historyIndexRef.current >= 0;
      const isEmpty = !input.trim();
      if (!isEmpty && !isBrowsing) return; // 有内容且非浏览模式，保留默认行为
      e.preventDefault();
      if (e.key === 'ArrowUp') {
        if (!isBrowsing) {
          // 首次进入历史浏览，暂存当前输入
          savedInputRef.current = input;
          historyIndexRef.current = hist.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        }
        setInput(hist[historyIndexRef.current]);
      } else {
        // ArrowDown
        if (!isBrowsing) return;
        if (historyIndexRef.current < hist.length - 1) {
          historyIndexRef.current++;
          setInput(hist[historyIndexRef.current]);
        } else {
          // 已到最新，恢复暂存的输入
          historyIndexRef.current = -1;
          setInput(savedInputRef.current);
        }
      }
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setPendingImages(prev => prev.length >= 5 ? prev : [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = (ev.target?.result as string) ?? '';
        setPendingFiles(prev => [...prev, { name: file.name, content: text }]);
      };
      reader.readAsText(file);
    });
    e.target.value = '';
  };

  const hasContent = input.trim() || pendingImages.length > 0 || pendingFiles.length > 0;

  return (
    <>
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {/* Token 圆环指示器 */}
        {tokenInfo && tokenInfo.contextWindow > 0 && (() => {
          const hasActual = tokenInfo.inputTokens > 0;
          const usedTokens = hasActual
            ? tokenInfo.inputTokens + tokenInfo.outputTokens
            : tokenInfo.promptEstimate;
          if (usedTokens <= 0) return null;
          const line1 = `提示词：~${formatTokens(tokenInfo.promptEstimate)}`;
          const line2 = `已用/总（含提示词）：${hasActual ? '' : '~'}${formatTokens(usedTokens)}/${formatTokens(tokenInfo.contextWindow)}`;
          return (
            <div className="relative flex items-center group">
              <div className="flex h-[22px] w-[22px] items-center justify-center cursor-default">
                <TokenRing used={usedTokens} total={tokenInfo.contextWindow} size={16} />
              </div>
              {/* Hover tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 whitespace-nowrap">
                <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{line1}</p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{line2}</p>
                </div>
              </div>
            </div>
          );
        })()}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 transition-colors dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
        >
          <Paperclip className="h-2.5 w-2.5" />
          附加文件
        </button>
        {onProviderChange && providerOptions && providerOptions.length > 0 && (
          <label className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
            <span className="whitespace-nowrap font-medium">供应商</span>
            <select
              value={providerValue ?? ''}
              onChange={(e) => onProviderChange(e.target.value)}
              disabled={isStreaming}
              className="min-w-[110px] rounded-sm bg-transparent text-xs font-medium text-zinc-900 outline-none dark:text-zinc-100"
              title="选择供应商"
            >
              {providerOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {onModelChange && modelOptions && modelOptions.length > 0 && (
          <label className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
            <span className="whitespace-nowrap font-medium">{modelProviderLabel ? `模型·${modelProviderLabel}` : '模型'}</span>
            <select
              value={modelValue ?? ''}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={isStreaming}
              className="min-w-[120px] rounded-sm bg-transparent text-xs font-medium text-zinc-900 outline-none dark:text-zinc-100"
              title="选择模型"
            >
              {modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {onEffortChange && effortOptions && effortOptions.length > 0 && (
          <label className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
            <span className="whitespace-nowrap font-medium">{effortLabel || '推理档位'}</span>
            <select
              value={effortValue ?? ''}
              onChange={(e) => onEffortChange(e.target.value)}
              disabled={isStreaming}
              className="min-w-[96px] rounded-sm bg-transparent text-xs font-medium text-zinc-900 outline-none dark:text-zinc-100"
              title={effortLabel || '选择推理档位'}
            >
              {effortOptions.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {showGuestPicker && guestAgents && guestAgents.length > 0 && onSelectGuest && (
          <>
            <button
              onClick={() => setGuestPickerOpen(v => !v)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                guestPickerOpen
                  ? 'border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'border border-zinc-200 text-zinc-400 hover:border-amber-200 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-amber-800 dark:hover:text-amber-400'
              }`}
            >
              <UserPlus className="h-2.5 w-2.5" />
              召唤旁听
            </button>
            {guestPickerOpen && guestAgents.map(a => (
              <button
                key={a.id}
                onClick={() => { onSelectGuest(a); setGuestPickerOpen(false); }}
                className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/50 px-2 py-0.5 text-xs text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
              >
                {a.name}
              </button>
            ))}
          </>
        )}
        {pendingFiles.map((f, i) => (
          <span key={i} className="flex items-center gap-1 rounded-full bg-zinc-100 pl-2.5 pr-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {f.name}
            <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      {/* Pending images */}
      {pendingImages.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt="" className="h-16 w-16 rounded object-cover border border-zinc-200 dark:border-zinc-700" />
              <button
                onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Slash 命令菜单 */}
      {slashOpen && enableSlashCommands && (() => {
        const filtered = getFilteredSkills();
        return (
          <div className="relative mb-1">
            <div className="absolute bottom-0 left-0 right-0 z-50 max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-400 dark:text-zinc-500">
                  {skillsCacheRef.current === null ? '加载中...' : '没有匹配的 Skill'}
                </div>
              ) : (
                filtered.map((skill, i) => (
                  <button
                    key={skill.name}
                    className={`w-full text-left px-3 py-2 text-sm flex items-baseline gap-2 transition-colors ${
                      i === slashIndex
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                    }`}
                    onMouseDown={(e) => { e.preventDefault(); handleSkillSelect(skill); }}
                    onMouseEnter={() => setSlashIndex(i)}
                  >
                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100 shrink-0">/{skill.name}</span>
                    {skill.description && (
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate">{skill.description}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })()}
      {/* Textarea + send button */}
      {fullWidth ? (
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          style={{ minHeight }}
          className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm outline-none transition-colors focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
        />
      ) : (
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className="flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
            style={{ minHeight: '40px', maxHeight: '200px' }}
          />
          {isStreaming ? (
            <button
              onClick={onAbort}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="停止"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!hasContent}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              title="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </>
  );
});
