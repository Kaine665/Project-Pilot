/**
 * Dangerous command detection for Bash tool calls.
 *
 * Since --dangerously-skip-permissions auto-executes all tools,
 * we detect dangerous patterns AFTER the fact and emit warnings.
 *
 * Level semantics (user-configurable via Settings → 安全检测):
 * - 'critical' — Auto-stops process via onDangerousCritical().
 * - 'warning'  — Emits warning to UI; does NOT stop process.
 * - 'disabled' — Detection skipped entirely for this category.
 */

import type { DangerLevel, DangerCategory, DangerDetectorSettings } from '@/types';
import { DEFAULT_DANGER_SETTINGS } from '@/types';
import { getDataDir, getAgentDataDir } from '@/lib/file-store';

interface DangerPattern {
  pattern: RegExp;
  reason: string;
  category: DangerCategory;
}

/**
 * Patterns checked against the Bash command string.
 * Each pattern is tagged with a category; the effective level
 * comes from the user's DangerDetectorSettings at runtime.
 */
const DANGER_PATTERNS: DangerPattern[] = [
  // ── sqlDestructive ──
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i,                    reason: 'SQL 删除表/数据库',         category: 'sqlDestructive' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i,                           reason: 'SQL 清空表数据',            category: 'sqlDestructive' },

  // ── diskFormat ──
  { pattern: /\bformat\s+[a-zA-Z]:/i,                           reason: 'Windows 格式化磁盘',        category: 'diskFormat' },

  // ── fileDestructive ──
  { pattern: /\brm\s+-[^\s]*r[^\s]*f|\brm\s+-[^\s]*f[^\s]*r/,  reason: '递归强制删除（建议用 safe-delete CLI）', category: 'fileDestructive' },
  { pattern: /\brm\s+-rf\s+[/\\]/,                              reason: '从根路径递归删除',          category: 'fileDestructive' },
  { pattern: /\bdel\s+\/[sfq]/i,                                reason: 'Windows 批量删除',          category: 'fileDestructive' },

  // ── gitDangerous ──
  { pattern: /\bgit\s+push\s+.*--force(?!-with-lease)/,         reason: 'Git 强制推送（非 lease）', category: 'gitDangerous' },
  { pattern: /\bgit\s+reset\s+--hard/,                          reason: 'Git 硬重置（丢弃所有变更）', category: 'gitDangerous' },
  { pattern: /\bgit\s+push\b/,                                  reason: 'Git 推送到远程',            category: 'gitDangerous' },
  { pattern: /\bgit\s+clean\s+-[^\s]*[fd]/,                     reason: 'Git 清理未跟踪文件',        category: 'gitDangerous' },
  { pattern: /\bgit\s+checkout\s+\.\s*$/,                       reason: 'Git 丢弃工作区变更',        category: 'gitDangerous' },
  { pattern: /\bgit\s+restore\s+\.\s*$/,                        reason: 'Git 恢复（丢弃变更）',      category: 'gitDangerous' },
  { pattern: /\bgit\s+branch\s+-D\b/,                           reason: 'Git 强制删除分支',          category: 'gitDangerous' },

  // ── npmPublish ──
  { pattern: /\bnpm\s+publish\b/,                                reason: '发布 npm 包',              category: 'npmPublish' },

  // ── processKill ──
  { pattern: /\bkill\s+-9\b/,                                   reason: '强制杀死进程',              category: 'processKill' },
];

// ── ProjectPilot data 目录写入保护 ──

// 写入/删除操作的关键词
const WRITE_INDICATORS = /\b(>|>>|tee|mv|cp|rm|del|unlink|echo\s+.*>|cat\s+.*>|printf\s+.*>|Write-Output|Set-Content|Out-File|Remove-Item|Move-Item|Copy-Item)\b/;

/**
 * Check if a command attempts to write/delete files inside the ProjectPilot data directory.
 * Read-only access (cat, head, type, Get-Content) is allowed.
 */
function detectDataDirWrite(command: string): { reason: string } | null {
  const normalized = command.replace(/\\/g, '/');
  const dataDirNormalized = getDataDir().replace(/\\/g, '/');
  const agentWorkspacesNormalized = getAgentDataDir().replace(/\\/g, '/');

  const referencesDataDir = normalized.includes(dataDirNormalized)
    || normalized.includes('.project-pilot/data')
    || normalized.includes('.project-pilot\\data');

  if (!referencesDataDir) return null;

  // 白名单：agents/workspaces 为 Agent 私有工作区，允许写入
  if (normalized.includes(agentWorkspacesNormalized)) {
    return null;
  }

  if (WRITE_INDICATORS.test(command)) {
    return {
      reason: `禁止写入 ProjectPilot 数据目录（${dataDirNormalized}）`,
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
 *
 * @param input - Raw tool input (JSON string or command string)
 * @param settings - User's danger detector settings (defaults apply if undefined)
 */
export function detectDangerousCommand(
  input: string,
  settings?: DangerDetectorSettings,
): DangerDetection | null {
  const config = settings ?? DEFAULT_DANGER_SETTINGS;

  // Parse the command from the tool input JSON
  let command = input;
  try {
    const parsed = JSON.parse(input);
    command = parsed.command || parsed.cmd || input;
  } catch {
    // Input might be a raw command string
  }

  // ── Data directory write protection (check first, highest priority) ──
  if (config.dataDirectory !== 'disabled') {
    const dataDirHit = detectDataDirWrite(command);
    if (dataDirHit) {
      return { reason: dataDirHit.reason, level: config.dataDirectory };
    }
  }

  for (const { pattern, reason, category } of DANGER_PATTERNS) {
    const level = config[category];
    if (level === 'disabled') continue;
    if (pattern.test(command)) {
      return { reason, level };
    }
  }

  return null;
}
