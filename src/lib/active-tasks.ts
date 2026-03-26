/**
 * 共享任务看板（Active Tasks Registry）
 *
 * 所有正在执行的 Agent 任务的共享注册表。
 * 每个 Agent 启动任务时注册，完成/失败时注销。
 * 其他 Agent 启动时读取看板，了解当前并行任务全貌，避免冲突。
 *
 * 路径由 getActiveTasksPath() 决定（默认在 DATA_DIR 下 tasks/active.json）；布局权威见本机 ~/.project-pilot/README.md 与 数据文件夹现状.md
 *
 * 使用方式（Agent 在 bash 中调用）：
 *   注册：npx tsx src/lib/active-tasks.ts register --title "任务标题" [选项]
 *   完成：npx tsx src/lib/active-tasks.ts complete <taskId>
 *   失败：npx tsx src/lib/active-tasks.ts fail <taskId>
 *   心跳：npx tsx src/lib/active-tasks.ts heartbeat <taskId>
 *   查看：npx tsx src/lib/active-tasks.ts list
 *   清理：npx tsx src/lib/active-tasks.ts prune
 */

import { getActiveTasksPath, readJsonFile, modifyJsonFile } from './file-store';
import { modifyTodosMerged } from '@/lib/todo-file-store';
import type { TodoLifecycle } from '@/types';

// ── 类型定义 ──

export type ActiveTaskAgentType =
  | 'self-dev'
  | 'task-worker'
  | 'agent-chat';

export type ActiveTaskStatus = 'running' | 'completed' | 'failed';

export interface ActiveTaskEntry {
  /** 唯一 ID，格式 at-{timestamp}-{random} */
  id: string;
  /** Agent 类型 */
  agentType: ActiveTaskAgentType;
  /** Agent ID（如 agent-builtin-self-dev） */
  agentId?: string;
  /** 关联项目 */
  projectKey?: string;
  /** 任务简述 */
  title: string;
  /** 涉及的模块/文件范围（帮助判断冲突） */
  scope?: string[];
  /** 关联的 git 分支 */
  branch?: string;
  /** 关联的 Agent 会话 ID（用于会话结束时自动清理） */
  sessionId?: string;
  /** 关联的 Todo ID（双向绑定，注册时通过 --todo-id 传入） */
  todoId?: string;
  /** 任务状态 */
  status: ActiveTaskStatus;
  /** 注册时间 */
  registeredAt: string;
  /** 最近心跳时间（用于过期检测） */
  heartbeatAt: string;
  /** 完成/失败时间 */
  finishedAt?: string;
}

export interface ActiveTasksData {
  tasks: ActiveTaskEntry[];
}

// ── 常量 ──

const DEFAULT_DATA: ActiveTasksData = { tasks: [] };

/** 超过此时间没有心跳的任务视为过期（小时） */
const STALE_HOURS = 6;

// ── ID 生成 ──

function generateId(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `at-${ts}-${rand}`;
}

// ── Todo 联动 ──

/**
 * 更新关联 Todo 的 lifecycle 和绑定字段。
 * 如果 todoId 为空则静默跳过。
 */
async function syncTodoLifecycle(
  todoId: string | undefined,
  lifecycle: TodoLifecycle,
  bind?: { activeTaskId?: string; claimedByBranch?: string },
): Promise<void> {
  if (!todoId) return;
  try {
    await modifyTodosMerged((data) => ({
      ...data,
      todos: data.todos.map((t) => {
        if (t.id !== todoId) return t;
        // 同步 status 字段（前端只看 status）
        const statusMap: Record<TodoLifecycle, typeof t.status> = {
          draft: 'pending',
          pending: 'pending',
          active: 'in_progress',
          stale: 'pending',
          done: 'done',
          archived: 'done',
        };
        return {
          ...t,
          lifecycle,
          status: statusMap[lifecycle],
          ...(bind?.activeTaskId !== undefined && { activeTaskId: bind.activeTaskId }),
          ...(bind?.claimedByBranch !== undefined && { claimedByBranch: bind.claimedByBranch }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  } catch {
    // Best-effort: todo 文件损坏或丢失不应阻塞 active task 操作
    console.error(`[active-tasks] Warning: failed to sync todo ${todoId} lifecycle to ${lifecycle}`);
  }
}

// ── 核心函数 ──

/** 读取所有任务 */
export async function listActiveTasks(): Promise<ActiveTaskEntry[]> {
  const data = await readJsonFile<ActiveTasksData>(getActiveTasksPath(), DEFAULT_DATA);
  return data.tasks;
}

/** 获取所有正在运行的任务（过滤掉已完成和已过期的） */
export async function listRunningTasks(): Promise<ActiveTaskEntry[]> {
  const tasks = await listActiveTasks();
  const now = Date.now();
  const staleMs = STALE_HOURS * 60 * 60 * 1000;
  return tasks.filter(t => {
    if (t.status !== 'running') return false;
    // 过期检测
    const heartbeat = new Date(t.heartbeatAt).getTime();
    if (now - heartbeat > staleMs) return false;
    return true;
  });
}

/** 注册一个新任务（自动清理过期/已完成记录，同一 branch 去重） */
export async function registerTask(
  params: Omit<ActiveTaskEntry, 'id' | 'status' | 'registeredAt' | 'heartbeatAt'>,
): Promise<ActiveTaskEntry> {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const staleMs = STALE_HOURS * 60 * 60 * 1000;
  const entry: ActiveTaskEntry = {
    id: generateId(),
    status: 'running',
    registeredAt: now,
    heartbeatAt: now,
    ...params,
  };

  await modifyJsonFile<ActiveTasksData>(
    getActiveTasksPath(),
    DEFAULT_DATA,
    (data) => {
      // Auto-prune: remove completed/failed/stale tasks
      data.tasks = data.tasks.filter(t => {
        if (t.status !== 'running') return false;
        const heartbeat = new Date(t.heartbeatAt).getTime();
        return nowMs - heartbeat <= staleMs;
      });

      // Dedup: if same branch already has a running task, mark it as failed
      if (entry.branch) {
        for (const t of data.tasks) {
          if (t.branch === entry.branch && t.status === 'running') {
            t.status = 'failed';
            t.finishedAt = now;
          }
        }
        // Remove the just-failed duplicates (they're stale anyway)
        data.tasks = data.tasks.filter(t => t.status === 'running');
      }

      data.tasks.push(entry);
      return data;
    },
  );

  // 联动：将关联的 Todo 标记为 active
  if (entry.todoId) {
    await syncTodoLifecycle(entry.todoId, 'active', {
      activeTaskId: entry.id,
      claimedByBranch: entry.branch,
    });
  }

  return entry;
}

/** 标记任务完成 */
export async function completeTask(taskId: string): Promise<boolean> {
  let found = false;
  let linkedTodoId: string | undefined;
  await modifyJsonFile<ActiveTasksData>(
    getActiveTasksPath(),
    DEFAULT_DATA,
    (data) => {
      const task = data.tasks.find(t => t.id === taskId);
      if (task && task.status === 'running') {
        task.status = 'completed';
        task.finishedAt = new Date().toISOString();
        found = true;
        linkedTodoId = task.todoId;
      }
      return data;
    },
  );
  // 联动：将关联的 Todo 标记为 done
  if (found && linkedTodoId) {
    await syncTodoLifecycle(linkedTodoId, 'done', { activeTaskId: undefined });
  }
  return found;
}

/** 标记任务失败 */
export async function failTask(taskId: string): Promise<boolean> {
  let found = false;
  let linkedTodoId: string | undefined;
  await modifyJsonFile<ActiveTasksData>(
    getActiveTasksPath(),
    DEFAULT_DATA,
    (data) => {
      const task = data.tasks.find(t => t.id === taskId);
      if (task && task.status === 'running') {
        task.status = 'failed';
        task.finishedAt = new Date().toISOString();
        found = true;
        linkedTodoId = task.todoId;
      }
      return data;
    },
  );
  // 联动：失败时 Todo 回到 pending，清除绑定
  if (found && linkedTodoId) {
    await syncTodoLifecycle(linkedTodoId, 'pending', {
      activeTaskId: undefined,
      claimedByBranch: undefined,
    });
  }
  return found;
}

/** 按 sessionId 批量完成/失败任务（供卫星任务调用） */
export async function finishTasksBySession(
  sessionId: string,
  status: 'completed' | 'failed',
): Promise<number> {
  let count = 0;
  const linkedTodoIds: string[] = [];
  const now = new Date().toISOString();
  await modifyJsonFile<ActiveTasksData>(
    getActiveTasksPath(),
    DEFAULT_DATA,
    (data) => {
      for (const t of data.tasks) {
        if (t.sessionId === sessionId && t.status === 'running') {
          t.status = status;
          t.finishedAt = now;
          count++;
          if (t.todoId) linkedTodoIds.push(t.todoId);
        }
      }
      return data;
    },
  );
  // 联动关联的 Todos
  const todoLifecycle: TodoLifecycle = status === 'completed' ? 'done' : 'pending';
  for (const todoId of linkedTodoIds) {
    await syncTodoLifecycle(todoId, todoLifecycle, {
      activeTaskId: undefined,
      claimedByBranch: undefined,
    });
  }
  return count;
}

/** 更新心跳 */
export async function heartbeatTask(taskId: string): Promise<boolean> {
  let found = false;
  await modifyJsonFile<ActiveTasksData>(
    getActiveTasksPath(),
    DEFAULT_DATA,
    (data) => {
      const task = data.tasks.find(t => t.id === taskId);
      if (task && task.status === 'running') {
        task.heartbeatAt = new Date().toISOString();
        found = true;
      }
      return data;
    },
  );
  return found;
}

/** 清理已完成/失败/过期的任务记录 */
export async function pruneTasks(): Promise<number> {
  const now = Date.now();
  const staleMs = STALE_HOURS * 60 * 60 * 1000;
  let removed = 0;

  await modifyJsonFile<ActiveTasksData>(
    getActiveTasksPath(),
    DEFAULT_DATA,
    (data) => {
      const before = data.tasks.length;
      data.tasks = data.tasks.filter(t => {
        // 保留正在运行且未过期的
        if (t.status === 'running') {
          const heartbeat = new Date(t.heartbeatAt).getTime();
          return now - heartbeat <= staleMs;
        }
        // 已完成/失败的全部清理
        return false;
      });
      removed = before - data.tasks.length;
      return data;
    },
  );

  return removed;
}

// ── CLI 入口 ──

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    } else if (!result._positional) {
      result._positional = arg;
    }
  }
  return result;
}

async function main() {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'register': {
      const opts = parseArgs(args);
      const title = opts.title;
      if (!title) {
        console.error('Usage: register --title "任务标题" [--agent-type TYPE] [--agent-id ID] [--project KEY] [--scope "file1,file2"] [--branch BRANCH] [--todo-id TODO_ID]');
        process.exit(1);
      }
      const entry = await registerTask({
        agentType: (opts['agent-type'] as ActiveTaskAgentType) || 'agent-chat',
        agentId: opts['agent-id'],
        projectKey: opts.project,
        title,
        scope: opts.scope ? opts.scope.split(',').map(s => s.trim()) : undefined,
        branch: opts.branch,
        sessionId: opts.session,
        todoId: opts['todo-id'],
      });
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'complete': {
      const taskId = args[0];
      if (!taskId) {
        console.error('Usage: complete <taskId>');
        process.exit(1);
      }
      const ok = await completeTask(taskId);
      console.log(ok ? `Completed: ${taskId}` : `Not found or already finished: ${taskId}`);
      break;
    }

    case 'fail': {
      const taskId = args[0];
      if (!taskId) {
        console.error('Usage: fail <taskId>');
        process.exit(1);
      }
      const ok = await failTask(taskId);
      console.log(ok ? `Failed: ${taskId}` : `Not found or already finished: ${taskId}`);
      break;
    }

    case 'heartbeat': {
      const taskId = args[0];
      if (!taskId) {
        console.error('Usage: heartbeat <taskId>');
        process.exit(1);
      }
      const ok = await heartbeatTask(taskId);
      console.log(ok ? `Heartbeat: ${taskId}` : `Not found: ${taskId}`);
      break;
    }

    case 'list': {
      const running = await listRunningTasks();
      const runningIds = new Set(running.map(t => t.id));
      const allTasks = await listActiveTasks();
      const finished = allTasks.filter(t => t.status !== 'running');
      const staleRunning = allTasks.filter(t => t.status === 'running' && !runningIds.has(t.id));

      console.log(`=== Running (${running.length}) ===`);
      for (const t of running) {
        const scope = t.scope ? ` [${t.scope.join(', ')}]` : '';
        const branch = t.branch ? ` (${t.branch})` : '';
        console.log(`  ${t.id}  ${t.agentType}  "${t.title}"${scope}${branch}  since ${t.registeredAt}`);
      }
      if (staleRunning.length > 0) {
        console.log(`=== Stale (${staleRunning.length}, heartbeat expired) ===`);
        for (const t of staleRunning) {
          console.log(`  ${t.id}  "${t.title}"  last heartbeat ${t.heartbeatAt}`);
        }
      }
      if (finished.length > 0) {
        console.log(`=== Finished (${finished.length}) ===`);
        for (const t of finished) {
          console.log(`  ${t.id}  ${t.status}  "${t.title}"  ${t.finishedAt}`);
        }
      }
      break;
    }

    case 'prune': {
      const removed = await pruneTasks();
      console.log(`Pruned ${removed} task(s)`);
      break;
    }

    default:
      console.error('Commands: register, complete, fail, heartbeat, list, prune');
      process.exit(1);
  }
}

// 作为脚本直接运行时执行 CLI
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('active-tasks');
if (isDirectRun) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
