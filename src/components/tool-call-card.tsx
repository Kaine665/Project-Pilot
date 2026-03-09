'use client';

import { useState, memo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  ClipboardList,
} from 'lucide-react';
import { AskUserQuestionCard } from '@/components/ask-user-question-card';
import { TodoListCard } from '@/components/todo-list-card';
import { SubagentCard } from '@/components/subagent-card';
import type { ChatToolCall } from '@/types';
import { getToolIcon, getToolDisplayName } from '@/lib/tool-utils';

const statusIcons: Record<ChatToolCall['status'], React.ReactNode> = {
  running: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
  completed: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  failed: <XCircle className="h-3 w-3 text-red-500" />,
};

interface ToolCallCardProps {
  toolCall: ChatToolCall;
}

/** 安全解析工具输入 JSON */
function parseToolInput(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** 从路径中提取简短显示名（如 src/foo.tsx） */
function shortPath(path: string, maxLen = 50): string {
  const normalized = path.split('\\').join('/');
  if (normalized.length <= maxLen) return normalized;
  const parts = normalized.split('/');
  if (parts.length <= 2) return normalized.slice(-maxLen);
  return '.../' + parts.slice(-2).join('/');
}

/** Cursor 风格：内容优先的解析结果 */
type ParsedTool = {
  filePath?: string;     // 文件路径，用于标签栏
  headerLabel?: string;  // 标签栏替代文案（如 Bash 的命令）
  summary: string;
  contentLabel?: string;  // "文件内容" | "搜索结果" | "写入内容" 等
  preview?: string;
  fullContent?: string;
};

function parseToolForDisplay(
  toolName: string,
  input: string,
  output?: string,
): ParsedTool {
  const parsed = parseToolInput(input);
  if (!parsed) {
    return { summary: input.length > 80 ? input.slice(0, 80) + '...' : input };
  }

  const fp = typeof parsed.file_path === 'string' ? parsed.file_path : '';
  const path = typeof parsed.path === 'string' ? parsed.path : fp;
  const pattern = typeof parsed.pattern === 'string' ? parsed.pattern : '';
  const content = typeof parsed.content === 'string' ? parsed.content : '';

  switch (toolName) {
    case 'Read': {
      const p = path || fp || '(未知路径)';
      const summary = output ? `读取 ${shortPath(p)}（${output.split('\n').length} 行）` : `读取 ${shortPath(p)}`;
      return {
        filePath: p,
        summary,
        contentLabel: '文件内容',
        preview: output ? output.split('\n').slice(0, 6).join('\n') : undefined,
        fullContent: output,
      };
    }
    case 'Grep': {
      const pat = pattern ? `"${pattern.length > 30 ? pattern.slice(0, 30) + '...' : pattern}"` : '';
      const where = path ? ` 于 ${shortPath(path, 35)}` : '';
      const summary = `搜索 ${pat}${where}`.trim();
      const matches = output ? output.split('\n').filter(Boolean) : [];
      return {
        filePath: path ? path.split('\\').join('/') : undefined,
        headerLabel: !path && pattern ? `grep "${pattern.slice(0, 50)}${pattern.length > 50 ? '...' : ''}"` : undefined,
        summary,
        contentLabel: '匹配结果',
        preview: matches.slice(0, 8).join('\n'),
        fullContent: output,
      };
    }
    case 'Write': {
      const p = path || fp || '(未知路径)';
      const body = content || output || '';
      const summary = `写入 ${shortPath(p)}`;
      return {
        filePath: p,
        summary,
        contentLabel: '写入内容',
        preview: body ? body.split('\n').slice(0, 6).join('\n') : undefined,
        fullContent: body,
      };
    }
    case 'Edit': {
      const p = path || fp || '(未知路径)';
      const summary = `编辑 ${shortPath(p)}`;
      return {
        filePath: p,
        summary,
        contentLabel: '修改结果',
        preview: output ? output.split('\n').slice(0, 6).join('\n') : undefined,
        fullContent: output,
      };
    }
    case 'Glob': {
      const glob = (typeof parsed.glob_pattern === 'string' ? parsed.glob_pattern : null)
        || (typeof parsed.pattern === 'string' ? parsed.pattern : null)
        || '(未知)';
      const summary = `匹配 ${glob.length > 40 ? glob.slice(0, 40) + '...' : glob}`;
      const files = output ? output.split('\n').filter(Boolean) : [];
      return {
        headerLabel: glob !== '(未知)' ? glob : undefined,
        summary,
        contentLabel: '匹配文件',
        preview: files.slice(0, 10).join('\n'),
        fullContent: output,
      };
    }
    case 'Bash': {
      const cmd = typeof parsed.command === 'string' ? parsed.command : '(未知命令)';
      const summary = output ? `命令执行完成` : (cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd);
      return {
        headerLabel: cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd,
        summary,
        contentLabel: '命令输出',
        preview: output ? output.split('\n').slice(0, 6).join('\n') : undefined,
        fullContent: output,
      };
    }
    default:
      return { summary: input.length > 80 ? input.slice(0, 80) + '...' : input };
  }
}

/** Cursor 风格代码块：圆角、等宽、IDE 感背景 */
const codeBlockClass = 'rounded-md bg-zinc-100 dark:bg-zinc-900/80 font-mono text-[11px] leading-relaxed overflow-auto whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300';

export const ToolCallCard = memo(function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRawParams, setShowRawParams] = useState(false);

  // Specialized rendering for interactive tools
  if (toolCall.toolName === 'AskUserQuestion') {
    return <AskUserQuestionCard toolCall={toolCall} />;
  }

  if (toolCall.toolName === 'TodoWrite') {
    return <TodoListCard toolCall={toolCall} />;
  }

  if (toolCall.toolName === 'Task') {
    return <SubagentCard toolCall={toolCall} />;
  }

  // Plan mode tools: compact inline display
  if (toolCall.toolName === 'EnterPlanMode' || toolCall.toolName === 'ExitPlanMode') {
    const isPlan = toolCall.toolName === 'EnterPlanMode';
    return (
      <div className="my-1 flex items-center gap-1.5 text-xs text-blue-500 dark:text-blue-400">
        {statusIcons[toolCall.status]}
        <ClipboardList className="h-3 w-3" />
        <span>{isPlan ? '进入规划模式' : '退出规划模式'}</span>
      </div>
    );
  }

  const { name: displayName, isMcp } = getToolDisplayName(toolCall.toolName);
  const icon = getToolIcon(toolCall.toolName);
  const parsed = parseToolForDisplay(
    toolCall.toolName,
    toolCall.input,
    toolCall.output,
  );

  const hasContent = !!(parsed.preview || parsed.fullContent);

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-zinc-200 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-900/50">
      {/* Cursor 风格：文件路径/命令作为标签栏 */}
      {(parsed.filePath || parsed.headerLabel) && (
        <div className="flex items-center gap-1.5 border-b border-zinc-200 bg-zinc-50/80 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800/60">
          <span className="text-zinc-400 shrink-0">{icon}</span>
          <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
            {parsed.filePath ? parsed.filePath.split('\\').join('/') : parsed.headerLabel}
          </span>
        </div>
      )}

      {/* 标题行：操作 + 摘要 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
      >
        {statusIcons[toolCall.status]}
        {!parsed.filePath && <span className="text-zinc-400">{icon}</span>}
        <span className="font-medium text-zinc-600 dark:text-zinc-300 shrink-0">
          {displayName}
        </span>
        {isMcp && (
          <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 shrink-0">
            MCP
          </span>
        )}
        <span className="flex-1 truncate text-zinc-500 dark:text-zinc-400 min-w-0 text-left">
          {parsed.summary}
        </span>
        {expanded
          ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}
      </button>

      {/* Cursor 风格：折叠时也显示内容预览（内容优先，非原始 JSON） */}
      {!expanded && hasContent && toolCall.status === 'completed' && (
        <div className="border-t border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
          {parsed.contentLabel && (
            <div className="mb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
              {parsed.contentLabel}
            </div>
          )}
          <pre className={`max-h-28 ${codeBlockClass} p-2`}>
            {parsed.preview}
          </pre>
        </div>
      )}

      {expanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700">
          {(parsed.fullContent || parsed.preview) && (
            <div className="px-2 py-1.5">
              {parsed.contentLabel && (
                <div className="mb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                  {parsed.contentLabel}
                </div>
              )}
              <pre className={`max-h-64 ${codeBlockClass} p-2`}>
                {parsed.fullContent ?? parsed.preview}
              </pre>
            </div>
          )}
          <div className="border-t border-zinc-200 px-2 py-1 dark:border-zinc-700">
            <button
              onClick={() => setShowRawParams(!showRawParams)}
              className="flex w-full items-center gap-1 text-left text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {showRawParams ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
              输入参数
            </button>
            {showRawParams && (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-200 px-2 py-1 text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                {toolCall.input}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
