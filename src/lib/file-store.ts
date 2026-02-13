/**
 * JSON 文件读写工具（简化版，无文件锁）
 * task-agent 项目数据存储在项目内 data/ 目录
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
