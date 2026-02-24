'use client';

import { memo } from 'react';
import { ListTodo, Circle, Loader2, CheckCircle2 } from 'lucide-react';
import type { ChatToolCall } from '@/types';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

interface TodoListCardProps {
  toolCall: ChatToolCall;
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
    case 'in_progress':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />;
    default:
      return <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />;
  }
};

/**
 * Specialized card for Claude Code's TodoWrite tool.
 * Shows a task list with progress indicators.
 */
export const TodoListCard = memo(function TodoListCard({ toolCall }: TodoListCardProps) {
  // Parse the input JSON
  let todos: TodoItem[] = [];
  try {
    const input = JSON.parse(toolCall.input);
    todos = input.todos || [];
  } catch {
    return null;
  }

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.filter((t) => t.status === 'in_progress').length;
  const total = todos.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="my-1.5 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <ListTodo className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
          任务清单
        </span>
        <span className="ml-auto text-[10px] text-amber-500">
          {completed}/{total}
          {inProgress > 0 && ` · ${inProgress} 进行中`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mx-3 mb-2 h-1 rounded-full bg-amber-200/50 dark:bg-amber-900/30">
        <div
          className="h-full rounded-full bg-amber-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo items */}
      <div className="space-y-0.5 px-3 pb-3">
        {todos.map((todo, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
              todo.status === 'completed'
                ? 'text-zinc-400 dark:text-zinc-500'
                : todo.status === 'in_progress'
                  ? 'bg-white/50 text-zinc-800 dark:bg-zinc-800/30 dark:text-zinc-200'
                  : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {statusIcon(todo.status)}
            <span className={todo.status === 'completed' ? 'line-through' : ''}>
              {todo.status === 'in_progress' ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
