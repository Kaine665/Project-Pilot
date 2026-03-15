/**
 * Skill 导出系统 — 插件式格式转换器注册表。
 *
 * 当前已注册格式：
 *   - openclaw: OpenClaw SKILL.md 格式
 *   - raw:      原始 PP 格式（直通）
 *   - json:     结构化 JSON
 *
 * 扩展：exporters.set('cursor-rules', cursorRulesExporter);
 */

// ── Types ──

export interface PPSkill {
  /** Skill 目录名（如 "git-commit"） */
  name: string;
  /** SKILL.md 原始内容 */
  content: string;
}

export interface ExportedSkill {
  /** 导出后的目录名 */
  dirName: string;
  /** 导出后的文件名 */
  fileName: string;
  /** 导出后的文件内容 */
  content: string;
  /** 导出格式标识 */
  format: string;
}

export interface SkillExporter {
  format: string;
  label: string;
  convert: (skill: PPSkill) => ExportedSkill;
}

// ── Frontmatter 解析/序列化 ──

interface ParsedSkill {
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): ParsedSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const fmBlock = match[1];
  const body = match[2];
  const frontmatter: Record<string, string> = {};

  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^(\w[\w.-]*):\s*(.*)$/);
    if (m) {
      frontmatter[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }

  return { frontmatter, body };
}

function serializeFrontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => {
      // 如果值包含特殊 YAML 字符，用引号包裹
      if (/[:#{}[\],&*?|>!%@`]/.test(v) || v.includes('\n')) {
        return `${k}: "${v.replace(/"/g, '\\"')}"`;
      }
      return `${k}: ${v}`;
    });
  return lines.join('\n');
}

// ── OpenClaw 格式导出器 ──

const openClawExporter: SkillExporter = {
  format: 'openclaw',
  label: 'OpenClaw 格式',
  convert(skill: PPSkill): ExportedSkill {
    const { frontmatter, body } = parseFrontmatter(skill.content);

    // 只保留 name 和 description，丢弃 PP 特有字段（metadata.author, metadata.version 等）
    const ocFields: Record<string, string> = {};
    if (frontmatter.name) ocFields.name = frontmatter.name;
    else ocFields.name = skill.name;
    if (frontmatter.description) ocFields.description = frontmatter.description;

    const fm = serializeFrontmatter(ocFields);
    const exportedContent = `---\n${fm}\n---\n\n${body.replace(/^\n+/, '')}`;

    return {
      dirName: skill.name,
      fileName: 'SKILL.md',
      content: exportedContent,
      format: 'openclaw',
    };
  },
};

// ── Raw 格式导出器（原样输出）──

const rawExporter: SkillExporter = {
  format: 'raw',
  label: '原始 Markdown',
  convert(skill: PPSkill): ExportedSkill {
    return {
      dirName: skill.name,
      fileName: 'SKILL.md',
      content: skill.content,
      format: 'raw',
    };
  },
};

// ── JSON 格式导出器 ──

const jsonExporter: SkillExporter = {
  format: 'json',
  label: 'JSON（通用）',
  convert(skill: PPSkill): ExportedSkill {
    const { frontmatter, body } = parseFrontmatter(skill.content);
    const json = JSON.stringify(
      {
        name: frontmatter.name || skill.name,
        description: frontmatter.description || '',
        content: body.replace(/^\n+/, ''),
      },
      null,
      2,
    );
    return {
      dirName: skill.name,
      fileName: `${skill.name}.json`,
      content: json,
      format: 'json',
    };
  },
};

// ── 注册表 ──

export const exporters = new Map<string, SkillExporter>();
exporters.set('openclaw', openClawExporter);
exporters.set('raw', rawExporter);
exporters.set('json', jsonExporter);

/** 获取所有已注册格式的元信息 */
export function listExportFormats(): { format: string; label: string }[] {
  return Array.from(exporters.values()).map(e => ({ format: e.format, label: e.label }));
}

/** 导出单个 skill */
export function exportSkill(skill: PPSkill, format: string): ExportedSkill {
  const exporter = exporters.get(format);
  if (!exporter) {
    throw new Error(`Unknown export format: "${format}". Available: ${Array.from(exporters.keys()).join(', ')}`);
  }
  return exporter.convert(skill);
}
