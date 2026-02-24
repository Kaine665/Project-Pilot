/**
 * JSON 文件读写工具（简化版，无文件锁）
 * ProjectPilot 项目数据存储在项目内 data/ 目录
 */

import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

export function getDataDir(): string {
  return DATA_DIR;
}

export function getTasksPath(): string {
  return path.join(DATA_DIR, 'tasks.json');
}

export function getProjectsPath(): string {
  return path.join(DATA_DIR, 'projects.json');
}

export function getAiPlansPath(): string {
  return path.join(DATA_DIR, 'ai-plans.json');
}

export function getArtifactsDir(planId?: string): string {
  if (planId) {
    return path.join(DATA_DIR, 'artifacts', planId);
  }
  return path.join(DATA_DIR, 'artifacts');
}

/** 旧格式：单个对话文件（向后兼容 / 懒迁移源） */
export function getConversationPath(taskId: string): string {
  return path.join(DATA_DIR, 'conversations', `${taskId}.json`);
}

/** 新格式：每个 task 一个对话目录 */
export function getConversationDir(taskId: string): string {
  return path.join(DATA_DIR, 'conversations', taskId);
}

/** 对话索引文件 */
export function getConversationIndexPath(taskId: string): string {
  return path.join(DATA_DIR, 'conversations', taskId, '_index.json');
}

/** 单个对话文件 */
export function getConversationFilePath(taskId: string, conversationId: string): string {
  return path.join(DATA_DIR, 'conversations', taskId, `${conversationId}.json`);
}

export function getTaskArtifactsPath(taskId: string): string {
  return path.join(DATA_DIR, 'task-artifacts', `${taskId}.json`);
}

export function getFlowDataPath(projectKey: string): string {
  const safe = projectKey.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(process.cwd(), 'src', 'data', 'flows', `${safe}.json`);
}

export function getPlannerSessionsPath(): string {
  return path.join(DATA_DIR, 'planner-sessions.json');
}

export function getArtifactSummaryPath(planId: string): string {
  return path.join(DATA_DIR, 'artifacts', planId, 'summary.json');
}

/**
 * 读取 JSON 文件，文件不存在时返回 defaultValue
 */
export async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // File not found or empty/corrupt JSON → return default
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return defaultValue;
    }
    throw error;
  }
}

/**
 * 写入 JSON 文件，自动创建目录
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 原子读-改-写操作
 */
export async function modifyJsonFile<T>(
  filePath: string,
  defaultValue: T,
  modifier: (data: T) => T,
): Promise<T> {
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  let data: T;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch {
    data = defaultValue;
  }

  const modified = modifier(data);
  await fs.writeFile(filePath, JSON.stringify(modified, null, 2), 'utf-8');
  return modified;
}

/**
 * 通知数据已变更（供 MCP Server 写入后触发 UI 刷新）
 */
export async function notifyDataChanged(): Promise<void> {
  const notifyPath = path.join(DATA_DIR, '.notify');
  await fs.writeFile(notifyPath, Date.now().toString(), 'utf-8');
}
