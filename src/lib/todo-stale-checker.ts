/**
 * Todo Stale Checker
 *
 * 定期扫描 todo 列表，将可能过期的 todo 标记为 stale。
 * 设计为 CLI 工具，可通过定时运行（/api/schedules）或手动调用。
 *
 * 触发 stale 的条件：
 * 1. pending 状态超过 STALE_DAYS 天未被认领
 * 2. lifecycle=active 但 activeTaskId 对应的 ActiveTask 已不存在（孤儿修复）
 *
 * 使用方式：
 *   npx tsx src/lib/todo-stale-checker.ts [--dry-run]
 */

import { getTodosPath, readJsonFile, modifyJsonFile } from './file-store';
import { listActiveTasks } from './active-tasks';
import type { TodosData, TodoLifecycle } from '@/types';

const DEFAULT: TodosData = { todos: [] };

/** pending 超过多少天标记为 stale */
const STALE_DAYS = 14;

export interface StaleCheckResult {
  /** 被标记为 stale 的 todo 数量 */
  markedStale: number;
  /** 孤儿修复（active 但 ActiveTask 不存在）的数量 */
  orphansFixed: number;
  /** 详细信息 */
  details: string[];
}

export async function checkAndMarkStaleTodos(dryRun = false): Promise<StaleCheckResult> {
  const result: StaleCheckResult = { markedStale: 0, orphansFixed: 0, details: [] };
  const now = Date.now();
  const staleMsThreshold = STALE_DAYS * 24 * 60 * 60 * 1000;

  // 获取当前所有活跃任务的 ID 集合
  const activeTasks = await listActiveTasks();
  const activeTaskIds = new Set(
    activeTasks.filter(t => t.status === 'running').map(t => t.id),
  );

  const data = await readJsonFile<TodosData>(getTodosPath(), DEFAULT);

  // 收集需要修改的 todo IDs 和目标 lifecycle
  const changes: Array<{ id: string; newLifecycle: TodoLifecycle; reason: string }> = [];

  for (const todo of data.todos) {
    const lifecycle = todo.lifecycle || inferLifecycle(todo.status);

    // 条件 1：pending 且超期
    if (lifecycle === 'pending') {
      const age = now - new Date(todo.updatedAt || todo.createdAt).getTime();
      if (age > staleMsThreshold) {
        changes.push({
          id: todo.id,
          newLifecycle: 'stale',
          reason: `pending for ${Math.floor(age / 86400000)} days (threshold: ${STALE_DAYS})`,
        });
      }
    }

    // 条件 2：lifecycle=active 但 activeTaskId 对应的任务已不在运行
    if (lifecycle === 'active' && todo.activeTaskId) {
      if (!activeTaskIds.has(todo.activeTaskId)) {
        changes.push({
          id: todo.id,
          newLifecycle: 'pending',
          reason: `activeTaskId "${todo.activeTaskId}" no longer running (orphan)`,
        });
      }
    }
  }

  if (changes.length === 0) {
    result.details.push('No stale or orphan todos found.');
    return result;
  }

  // 记录变更
  for (const c of changes) {
    result.details.push(`[${c.id}] ${c.newLifecycle}: ${c.reason}`);
    if (c.newLifecycle === 'stale') result.markedStale++;
    else result.orphansFixed++;
  }

  // 执行变更
  if (!dryRun) {
    const changeMap = new Map(changes.map(c => [c.id, c]));
    await modifyJsonFile<TodosData>(getTodosPath(), DEFAULT, (d) => ({
      ...d,
      todos: d.todos.map((t) => {
        const change = changeMap.get(t.id);
        if (!change) return t;
        // 同步 status
        const statusMap: Record<TodoLifecycle, typeof t.status> = {
          draft: 'pending', pending: 'pending', active: 'in_progress',
          stale: 'pending', done: 'done', archived: 'done',
        };
        return {
          ...t,
          lifecycle: change.newLifecycle,
          status: statusMap[change.newLifecycle],
          ...(change.newLifecycle === 'pending' && { activeTaskId: undefined, claimedByBranch: undefined }),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }

  return result;
}

/** 从旧的 status 推导 lifecycle（兼容没有 lifecycle 字段的旧数据） */
function inferLifecycle(status: string): TodoLifecycle {
  switch (status) {
    case 'in_progress': return 'active';
    case 'done': return 'done';
    default: return 'pending';
  }
}

// ── CLI ──

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[todo-stale-checker] Running${dryRun ? ' (DRY RUN)' : ''}...`);

  const result = await checkAndMarkStaleTodos(dryRun);

  console.log(`\nResults:`);
  console.log(`  Marked stale: ${result.markedStale}`);
  console.log(`  Orphans fixed: ${result.orphansFixed}`);
  if (result.details.length > 0) {
    console.log(`\nDetails:`);
    for (const d of result.details) {
      console.log(`  ${d}`);
    }
  }

  console.log(JSON.stringify(result));
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('todo-stale-checker');
if (isDirectRun) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
