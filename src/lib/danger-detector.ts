/**
 * Dangerous command detection for Bash tool calls.
 *
 * Since --dangerously-skip-permissions auto-executes all tools,
 * we detect dangerous patterns AFTER the fact and emit warnings.
 * For 'critical' level patterns, ProcessManager auto-stops the process.
 */

import type { DangerLevel } from '@/types';

interface DangerPattern {
  pattern: RegExp;
  reason: string;
  level: DangerLevel;
}

/**
 * Patterns checked against the Bash command string.
 *
 * 'critical' — Auto-stop process immediately. Potentially catastrophic.
 * 'warning'  — Show warning to user but don't auto-stop.
 */
const DANGER_PATTERNS: DangerPattern[] = [
  // ── Critical: likely irreversible damage ──
  { pattern: /\brm\s+-[^\s]*r[^\s]*f|rm\s+-[^\s]*f[^\s]*r/,   reason: '递归强制删除文件',          level: 'critical' },
  { pattern: /\brm\s+-rf\s+[/\\]/,                              reason: '从根路径递归删除',          level: 'critical' },
  { pattern: /\bgit\s+push\s+.*--force(?!-with-lease)/,         reason: 'Git 强制推送（非 lease）', level: 'critical' },
  { pattern: /\bgit\s+reset\s+--hard/,                          reason: 'Git 硬重置（丢弃所有变更）', level: 'critical' },
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i,                    reason: 'SQL 删除表/数据库',         level: 'critical' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i,                           reason: 'SQL 清空表数据',            level: 'critical' },
  { pattern: /\bformat\s+[a-zA-Z]:/i,                           reason: 'Windows 格式化磁盘',        level: 'critical' },

  // ── Warning: potentially dangerous but sometimes intentional ──
  { pattern: /\bgit\s+push\b/,                                  reason: 'Git 推送到远程',            level: 'warning' },
  { pattern: /\bgit\s+clean\s+-[^\s]*[fd]/,                     reason: 'Git 清理未跟踪文件',        level: 'warning' },
  { pattern: /\bgit\s+checkout\s+\.\s*$/,                       reason: 'Git 丢弃工作区变更',        level: 'warning' },
  { pattern: /\bgit\s+restore\s+\.\s*$/,                        reason: 'Git 恢复（丢弃变更）',      level: 'warning' },
  { pattern: /\bgit\s+branch\s+-D\b/,                           reason: 'Git 强制删除分支',          level: 'warning' },
  { pattern: /\bnpm\s+publish\b/,                                reason: '发布 npm 包',              level: 'warning' },
  { pattern: /\bkill\s+-9\b/,                                   reason: '强制杀死进程',              level: 'warning' },
  { pattern: /\bdel\s+\/[sfq]/i,                                reason: 'Windows 批量删除',          level: 'warning' },
];

export interface DangerDetection {
  reason: string;
  level: DangerLevel;
}

/**
 * Check a Bash command string against danger patterns.
 * Returns the first matching pattern, or null if safe.
 */
export function detectDangerousCommand(input: string): DangerDetection | null {
  // Parse the command from the tool input JSON
  let command = input;
  try {
    const parsed = JSON.parse(input);
    command = parsed.command || parsed.cmd || input;
  } catch {
    // Input might be a raw command string
  }

  for (const { pattern, reason, level } of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      return { reason, level };
    }
  }

  return null;
}
