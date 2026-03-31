/**
 * 待办存储：数据根 `todos.json`（聚合）与 `todos/entries/<id>.json`（分文件）。
 * 读取时合并，同 id 以分文件为准；写入时按来源回写对应位置。
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { TodoItem, TodosData } from '@/types';
import {
  getTodosEntriesDir,
  getTodosPath,
  parseJsonSafe,
  readJsonFile,
  writeJsonFile,
} from '@/lib/file-store';

const TODO_DEFAULT: TodosData = { todos: [] };

function normalizeTodoEntryPayload(parsed: unknown): TodoItem | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  let candidate: Record<string, unknown> = o;
  if ('todo' in o && o.todo && typeof o.todo === 'object') {
    candidate = o.todo as Record<string, unknown>;
  }
  const id = candidate.id;
  const title = candidate.title;
  if (typeof id !== 'string' || !id.trim()) return null;
  if (typeof title !== 'string' || !title.trim()) return null;
  return candidate as unknown as TodoItem;
}

async function loadTodoEntriesIndex(): Promise<{
  todos: TodoItem[];
  /** todo id → 磁盘上的 entry 文件绝对路径 */
  fileById: Map<string, string>;
}> {
  const dir = getTodosEntriesDir();
  const fileById = new Map<string, string>();
  const todos: TodoItem[] = [];

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { todos, fileById };
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fullPath = path.join(dir, name);
    let raw: string;
    try {
      raw = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parseJsonSafe(raw);
    } catch {
      continue;
    }
    const item = normalizeTodoEntryPayload(parsed);
    if (!item) continue;
    fileById.set(item.id, fullPath);
    todos.push(item);
  }

  return { todos, fileById };
}

function mergeTodoLists(legacyTodos: TodoItem[], entryTodos: TodoItem[]): TodosData {
  const map = new Map<string, TodoItem>();
  for (const t of legacyTodos) map.set(t.id, t);
  for (const t of entryTodos) map.set(t.id, t);
  return { todos: [...map.values()] };
}

/** 合并读取：`todos/entries/*.json` 覆盖数据根 `todos.json` 中同 id 条目 */
export async function readTodosMerged(): Promise<TodosData> {
  const legacy = await readJsonFile<TodosData>(getTodosPath(), TODO_DEFAULT);
  const { todos: entryTodos } = await loadTodoEntriesIndex();
  return mergeTodoLists(legacy.todos, entryTodos);
}

async function readTodosMergeContext(): Promise<{
  data: TodosData;
  entryFileById: Map<string, string>;
}> {
  const legacy = await readJsonFile<TodosData>(getTodosPath(), TODO_DEFAULT);
  const { todos: entryTodos, fileById: entryFileById } = await loadTodoEntriesIndex();
  return {
    data: mergeTodoLists(legacy.todos, entryTodos),
    entryFileById,
  };
}

let todosMergeChain: Promise<unknown> = Promise.resolve();

/**
 * 原子读-改-写（进程内串行），持久化到分文件或聚合文件。
 * 新建、且此前无分文件的 id 写入数据根 `todos.json`。
 */
export async function modifyTodosMerged(
  modifier: (data: TodosData) => TodosData,
): Promise<TodosData> {
  const run = async (): Promise<TodosData> => {
    const { data: before, entryFileById } = await readTodosMergeContext();
    const after = modifier(structuredClone(before));

    const afterIds = new Set(after.todos.map(t => t.id));
    const beforeIds = new Set(before.todos.map(t => t.id));

    for (const id of beforeIds) {
      if (!afterIds.has(id)) {
        const fp = entryFileById.get(id);
        if (fp) {
          await fs.unlink(fp).catch(() => {});
          entryFileById.delete(id);
        }
      }
    }

    const legacyTodos: TodoItem[] = [];
    for (const t of after.todos) {
      const entryPath = entryFileById.get(t.id);
      if (entryPath) {
        await writeJsonFile(entryPath, t);
      } else {
        legacyTodos.push(t);
      }
    }

    await writeJsonFile(getTodosPath(), { todos: legacyTodos });
    return after;
  };

  todosMergeChain = todosMergeChain.then(run, run);
  return todosMergeChain as Promise<TodosData>;
}
