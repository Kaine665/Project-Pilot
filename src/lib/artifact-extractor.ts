import { getTaskArtifactsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import type { TaskUnderstanding, TaskResult, TaskArtifacts } from '@/types';

const DEFAULT_ARTIFACTS = (taskId: string): TaskArtifacts => ({
  taskId,
  updatedAt: new Date().toISOString(),
});

/**
 * 转义 JSON 字符串值内部的未转义双引号。
 * 使用状态机方法，只转义属性值中的引号，不影响 JSON 结构。
 */
function escapeInnerQuotes(jsonStr: string): string {
  const result: string[] = [];
  let inString = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    const prev = i > 0 ? jsonStr[i - 1] : '';

    if (char === '"' && prev !== '\\') {
      if (!inString) {
        // 进入字符串
        inString = true;
        result.push(char);
      } else {
        // 可能退出字符串，检查后面是否是冒号或逗号/}
        const nextNonSpace = jsonStr.slice(i + 1).match(/\S/);
        const nextChar = nextNonSpace ? nextNonSpace[0] : '';

        if (nextChar === ':') {
          // 这是属性名的结束引号
          inString = false;
          result.push(char);
        } else if (nextChar === ',' || nextChar === '}' || nextChar === '') {
          // 这是属性值的结束引号
          inString = false;
          result.push(char);
        } else {
          // 这是属性值内部的引号，需要转义
          result.push('\\' + char);
        }
      }
    } else {
      result.push(char);
    }
  }

  return result.join('');
}

/**
 * Extract a ```json:branch block from AI response text.
 * Phase 0 artifact: just a branch name slug.
 */
export function extractBranchSlugFromText(text: string): string | null {
  const regex = /```json:branch\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    const sanitized = escapeInnerQuotes(match[1]);
    const parsed = JSON.parse(sanitized);
    if (typeof parsed.slug === 'string' && parsed.slug.trim()) {
      return parsed.slug.trim();
    }
  } catch (err) {
    console.error('Failed to parse branch JSON:', err);
  }
  return null;
}

/**
 * Extract a ```json:understanding block from AI response text.
 */
export function extractUnderstandingFromText(text: string): TaskUnderstanding | null {
  const regex = /```json:understanding\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    // 预处理：转义字符串值内部的未转义双引号
    const sanitized = escapeInnerQuotes(match[1]);

    const parsed = JSON.parse(sanitized);
    if (parsed.project && parsed.action && parsed.goal && parsed.deliverable) {
      return {
        project: parsed.project,
        action: parsed.action,
        goal: parsed.goal,
        deliverable: parsed.deliverable,
        ...(parsed.branchSlug && { branchSlug: parsed.branchSlug }),
      };
    }
  } catch (err) {
    // Log the error for debugging
    console.error('Failed to parse understanding JSON:', err);
    console.error('Original JSON:', match[1].substring(0, 500));
  }
  return null;
}

/**
 * Extract a ```json:result block from AI response text.
 */
export function extractResultFromText(text: string): TaskResult | null {
  const regex = /```json:result\s*\n([\s\S]*?)```/;
  const match = text.match(regex);
  if (!match) return null;

  try {
    // 预处理：转义字符串值内部的未转义双引号
    const sanitized = escapeInnerQuotes(match[1]);

    const parsed = JSON.parse(sanitized);
    if (parsed.status && parsed.summary) {
      return {
        status: parsed.status,
        branch: parsed.branch,
        summary: parsed.summary,
        files_changed: parsed.files_changed,
        stats: parsed.stats,
      };
    }
  } catch (err) {
    // Log the error for debugging
    console.error('Failed to parse result JSON:', err);
    console.error('Original JSON:', match[1].substring(0, 500));
  }
  return null;
}

/**
 * Save understanding data to task artifacts file.
 */
export async function saveUnderstanding(
  taskId: string,
  understanding: TaskUnderstanding,
): Promise<void> {
  const artifacts = await readJsonFile<TaskArtifacts>(
    getTaskArtifactsPath(taskId),
    DEFAULT_ARTIFACTS(taskId),
  );
  artifacts.understanding = understanding;
  artifacts.updatedAt = new Date().toISOString();
  await writeJsonFile(getTaskArtifactsPath(taskId), artifacts);
}

/**
 * Save result data to task artifacts file.
 */
export async function saveResult(
  taskId: string,
  result: TaskResult,
): Promise<void> {
  const artifacts = await readJsonFile<TaskArtifacts>(
    getTaskArtifactsPath(taskId),
    DEFAULT_ARTIFACTS(taskId),
  );
  artifacts.result = result;
  artifacts.updatedAt = new Date().toISOString();
  await writeJsonFile(getTaskArtifactsPath(taskId), artifacts);
}
