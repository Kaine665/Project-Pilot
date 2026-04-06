import {
  Terminal,
  FileText,
  Pencil,
  Search,
  Globe,
  MessageCircleQuestion,
  ListTodo,
  ClipboardList,
  Blocks,
  Plug,
} from 'lucide-react';
import type { ChatToolCall } from '@/types';

/**
 * 重复性工具：应该在固定 200px 面板中显示，而不是直接在气泡中列举
 * （避免 Read、Grep 等操作堆积导致气泡过长）
 */
export const REPETITIVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Bash',
  'Write',
  'Edit',
  'Glob',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'Task',
]);

/**
 * 特殊工具：即使在重复性工具中，也应该保留在气泡中显示
 * （这些工具需要用户交互或重要提示）
 */
export const SPECIAL_TOOLS = new Set([
  'AskUserQuestion',
  'TodoWrite',
  'EnterPlanMode',
  'ExitPlanMode',
  'Skill',
]);

/**
 * 判断工具是否应该显示在固定面板中
 */
export function isRepetitiveTool(toolName: string): boolean {
  // 如果是特殊工具，即使在重复性列表中也要返回 false
  if (SPECIAL_TOOLS.has(toolName)) return false;
  // 检查是否是重复性工具
  return REPETITIVE_TOOLS.has(toolName);
}

const toolIcons: Record<string, React.ReactNode> = {
  Bash: <Terminal className="h-3 w-3" />,
  Read: <FileText className="h-3 w-3" />,
  Edit: <Pencil className="h-3 w-3" />,
  Write: <Pencil className="h-3 w-3" />,
  Glob: <Search className="h-3 w-3" />,
  Grep: <Search className="h-3 w-3" />,
  WebFetch: <Globe className="h-3 w-3" />,
  WebSearch: <Globe className="h-3 w-3" />,
  NotebookEdit: <FileText className="h-3 w-3" />,
  Task: <Blocks className="h-3 w-3" />,
  AskUserQuestion: <MessageCircleQuestion className="h-3 w-3" />,
  TodoWrite: <ListTodo className="h-3 w-3" />,
  EnterPlanMode: <ClipboardList className="h-3 w-3" />,
  ExitPlanMode: <ClipboardList className="h-3 w-3" />,
};

/**
 * Get a human-readable display name for the tool.
 * MCP tools have format: mcp__serverName__toolName
 */
export function getToolDisplayName(toolName: string): { name: string; isMcp: boolean } {
  const mcpMatch = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpMatch) {
    return { name: `${mcpMatch[1]}/${mcpMatch[2]}`, isMcp: true };
  }
  return { name: toolName, isMcp: false };
}

/**
 * Get an icon for the tool, with fallback for MCP and unknown tools.
 */
export function getToolIcon(toolName: string): React.ReactNode {
  if (toolIcons[toolName]) return toolIcons[toolName];
  if (toolName.startsWith('mcp__')) return <Plug className="h-3 w-3" />;
  return <Terminal className="h-3 w-3" />;
}

/**
 * 安全解析工具输入 JSON
 */
function parseInput(input: string): Record<string, unknown> | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/**
 * 将工具调用压缩为一行摘要
 */
export function getToolOneLiner(tc: ChatToolCall): string {
  const parsed = typeof tc.input === 'string' ? parseInput(tc.input) : null;

  switch (tc.toolName) {
    case 'Read': {
      const fp = parsed?.file_path as string | undefined;
      return fp ? basename(fp) : 'Read';
    }
    case 'Grep': {
      const pattern = parsed?.pattern as string | undefined;
      const path = parsed?.path as string | undefined;
      return pattern
        ? `/${pattern}/${path ? ' in ' + basename(path) : ''}`
        : 'Grep';
    }
    case 'Glob': {
      const pattern = parsed?.pattern as string | undefined;
      return pattern ?? 'Glob';
    }
    case 'Bash': {
      const cmd = parsed?.command as string | undefined;
      return cmd ? cmd.slice(0, 80) : 'Bash';
    }
    case 'Edit': {
      const fp = parsed?.file_path as string | undefined;
      return fp ? basename(fp) : 'Edit';
    }
    case 'Write': {
      const fp = parsed?.file_path as string | undefined;
      return fp ? basename(fp) : 'Write';
    }
    case 'WebFetch': {
      const url = parsed?.url as string | undefined;
      return url ? url.slice(0, 60) : 'WebFetch';
    }
    case 'WebSearch': {
      const query = parsed?.query as string | undefined;
      return query ?? 'WebSearch';
    }
    case 'TodoWrite': {
      const todos = parsed?.todos as Array<{ content?: string; status?: string }> | undefined;
      if (Array.isArray(todos) && todos.length > 0) {
        const done = todos.filter((x) => x.status === 'completed').length;
        return `${done}/${todos.length} 项`;
      }
      return 'TodoWrite';
    }
    case 'Task': {
      const desc = parsed?.description as string | undefined;
      return desc ?? 'Task';
    }
    default: {
      const { name } = getToolDisplayName(tc.toolName);
      return name;
    }
  }
}

/**
 * 根据工具组合生成面板标题
 */
export function getToolGroupTitle(toolCalls: ChatToolCall[]): string {
  const names = new Set(toolCalls.map((tc) => tc.toolName));

  if (names.size === 1) {
    const name = names.values().next().value;
    switch (name) {
      case 'Read': return '阅读代码';
      case 'Grep': return '搜索代码';
      case 'Glob': return '查找文件';
      case 'Bash': return '执行命令';
      case 'Edit': return '编辑文件';
      case 'Write': return '写入文件';
      case 'WebFetch': return '获取网页';
      case 'WebSearch': return '搜索网络';
      case 'Task': return '子任务';
      default: return '工具执行';
    }
  }

  // 混合类型
  const hasRead = names.has('Read') || names.has('Grep') || names.has('Glob');
  const hasWrite = names.has('Edit') || names.has('Write');

  if (hasRead && hasWrite) return '查阅与修改代码';
  if (hasRead) return '查阅代码';
  if (hasWrite) return '修改代码';
  return '工具执行';
}

function basename(fp: string): string {
  return fp.replace(/\\/g, '/').split('/').pop() || fp;
}
