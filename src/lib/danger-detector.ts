/**
 * Dangerous command detection for Bash tool calls.
 *
 * Since --dangerously-skip-permissions auto-executes all tools,
 * we detect dangerous patterns AFTER the fact and emit warnings.
 *
 * Level semantics:
 * - 'critical' — Reserved for truly catastrophic operations (data dir writes,
 *   disk format, SQL DROP). Auto-stops process via onDangerousCritical().
 * - 'warning'  — Dangerous but survivable (rm -rf, git push --force, etc.).
 *   Emits warning to UI; does NOT stop process.
 *
 * Design note (2026-03): rm -rf was downgraded from critical to warning because
 * auto-stopping (SIGTERM) on detection was WORSE than letting the command run:
 * 1. On Windows, rm -rf usually fails anyway due to file locks
 * 2. The detection happens AFTER execution, so SIGTERM can't prevent damage
 * 3. Killing the session destroys all conversation context
 * 4. The agent can't learn from the failure or try alternatives
 */

import os from 'os';
import path from 'path';
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
  // ── Critical: truly catastrophic, auto-stop process ──
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i,                    reason: 'SQL 删除表/数据库',         level: 'critical' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i,                           reason: 'SQL 清空表数据',            level: 'critical' },
  { pattern: /\bformat\s+[a-zA-Z]:/i,                           reason: 'Windows 格式化磁盘',        level: 'critical' },

  // ── Warning: dangerous but don't kill the session ──
  { pattern: /\brm\s+-[^\s]*r[^\s]*f|\brm\s+-[^\s]*f[^\s]*r/,  reason: '递归强制删除（建议用 safe-delete CLI）', level: 'warning' },
  { pattern: /\brm\s+-rf\s+[/\\]/,                              reason: '从根路径递归删除',          level: 'warning' },
  { pattern: /\bgit\s+push\s+.*--force(?!-with-lease)/,         reason: 'Git 强制推送（非 lease）', level: 'warning' },
  { pattern: /\bgit\s+reset\s+--hard/,                          reason: 'Git 硬重置（丢弃所有变更）', level: 'warning' },
  { pattern: /\bgit\s+push\b/,                                  reason: 'Git 推送到远程',            level: 'warning' },
  { pattern: /\bgit\s+clean\s+-[^\s]*[fd]/,                     reason: 'Git 清理未跟踪文件',        level: 'warning' },
  { pattern: /\bgit\s+checkout\s+\.\s*$/,                       reason: 'Git 丢弃工作区变更',        level: 'warning' },
  { pattern: /\bgit\s+restore\s+\.\s*$/,                        reason: 'Git 恢复（丢弃变更）',      level: 'warning' },
  { pattern: /\bgit\s+branch\s+-D\b/,                           reason: 'Git 强制删除分支',          level: 'warning' },
  { pattern: /\bnpm\s+publish\b/,                                reason: '发布 npm 包',              level: 'warning' },
  { pattern: /\bkill\s+-9\b/,                                   reason: '强制杀死进程',              level: 'warning' },
  { pattern: /\bdel\s+\/[sfq]/i,                                reason: 'Windows 批量删除',          level: 'warning' },
];

// ── ProjectPilot data 目录写入保护 ──
// Agent 可以读取 data 目录（管家需要读），但不允许写入/删除/覆盖

const DATA_DIR = process.env.PROJECT_PILOT_DATA_DIR
  || path.join(os.homedir(), '.project-pilot', 'data');

// 写入/删除操作的关键词（出现在命令中 + 路径命中 data 目录 = 拦截）
const WRITE_INDICATORS = /\b(>|>>|tee|mv|cp|rm|del|unlink|echo\s+.*>|cat\s+.*>|printf\s+.*>|Write-Output|Set-Content|Out-File|Remove-Item|Move-Item|Copy-Item)\b/;

/**
 * Check if a command attempts to write/delete files inside the ProjectPilot data directory.
 * Read-only access (cat, head, type, Get-Content) is allowed.
 */
function detectDataDirWrite(command: string): DangerDetection | null {
  // Normalize path separators for matching
  const normalized = command.replace(/\\/g, '/');
  const dataDirNormalized = DATA_DIR.replace(/\\/g, '/');

  // Check if command references the data directory
  const referencesDataDir = normalized.includes(dataDirNormalized)
    || normalized.includes('.project-pilot/data')
    || normalized.includes('.project-pilot\\data');

  if (!referencesDataDir) return null;

  // Only block write/delete operations, not reads
  if (WRITE_INDICATORS.test(command)) {
    return {
      reason: `禁止写入 ProjectPilot 数据目录（${DATA_DIR}）`,
      level: 'critical',
    };
  }

  return null;
}

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

  // ── Data directory write protection (check first, highest priority) ──
  const dataDirHit = detectDataDirWrite(command);
  if (dataDirHit) return dataDirHit;

  for (const { pattern, reason, level } of DANGER_PATTERNS) {
    if (pattern.test(command)) {
      return { reason, level };
    }
  }

  return null;
}
