/**
 * Skill export adapters for ProjectPilot.
 *
 * Current formats:
 *   - standard: public SKILL.md spec (export exact content)
 *   - json: structured JSON export
 *
 * Legacy aliases:
 *   - openclaw -> standard
 *   - raw -> standard
 */

const yaml = require('js-yaml') as {
  load(input: string): unknown;
  dump(input: unknown, options?: Record<string, unknown>): string;
};

export interface PPSkill {
  name: string;
  content: string;
}

export interface ExportedSkill {
  dirName: string;
  fileName: string;
  content: string;
  format: string;
}

export interface SkillExporter {
  format: string;
  label: string;
  convert: (skill: PPSkill) => ExportedSkill;
}

interface ParsedSkill {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): ParsedSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterBlock = match[1];
  const body = match[2];

  try {
    const parsed = yaml.load(frontmatterBlock);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { frontmatter: {}, body };
    }
    return { frontmatter: parsed as Record<string, unknown>, body };
  } catch {
    return { frontmatter: {}, body };
  }
}

const standardExporter: SkillExporter = {
  format: 'standard',
  label: 'Public SKILL.md',
  convert(skill: PPSkill): ExportedSkill {
    return {
      dirName: skill.name,
      fileName: 'SKILL.md',
      content: skill.content,
      format: 'standard',
    };
  },
};

const jsonExporter: SkillExporter = {
  format: 'json',
  label: 'JSON',
  convert(skill: PPSkill): ExportedSkill {
    const { frontmatter, body } = parseFrontmatter(skill.content);
    const json = JSON.stringify(
      {
        name: typeof frontmatter.name === 'string' && frontmatter.name.trim()
          ? frontmatter.name
          : skill.name,
        description: typeof frontmatter.description === 'string'
          ? frontmatter.description
          : '',
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

export const exporters = new Map<string, SkillExporter>();
exporters.set('standard', standardExporter);
exporters.set('json', jsonExporter);

const exportFormatAliases = new Map<string, string>([
  ['openclaw', 'standard'],
  ['raw', 'standard'],
]);

export function listExportFormats(): { format: string; label: string }[] {
  return Array.from(exporters.values()).map(exporter => ({
    format: exporter.format,
    label: exporter.label,
  }));
}

export function exportSkill(skill: PPSkill, format: string): ExportedSkill {
  const resolvedFormat = exportFormatAliases.get(format) ?? format;
  const exporter = exporters.get(resolvedFormat);
  if (!exporter) {
    const available = Array.from(new Set([
      ...exporters.keys(),
      ...exportFormatAliases.keys(),
    ])).join(', ');
    throw new Error(`Unknown export format: "${format}". Available: ${available}`);
  }
  return exporter.convert(skill);
}
