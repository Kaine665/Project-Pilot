import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Pencil,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  Globe,
  MessageCircleQuestion,
  ListTodo,
  ClipboardList,
  Blocks,
  Plug,
} from 'lucide-react';

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
