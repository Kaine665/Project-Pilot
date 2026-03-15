import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { listSkills, listAllSkills, readSkillFile, listSkillFiles, readSkillSubFile } from '@/lib/skill-store';
import { parseScopeFromParams } from '../scope-utils';
import { exportSkill, listExportFormats } from '@/lib/skill-export';
import type { SkillScope } from '@/lib/file-store';

interface SkillZipEntry {
  name: string;
  mainFileName: string;
  mainContent: string;
  scope: SkillScope;
}

/**
 * 将多个 skill 打包为一个 ZIP Buffer。
 * 每个 skill 在 ZIP 内有独立的 {skillName}/ 目录。
 */
async function createAllSkillsZip(skills: SkillZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);

    archive.pipe(passThrough);
    archive.on('error', reject);

    const addAllFiles = async () => {
      for (const skill of skills) {
        // Add main SKILL.md (or exported format file)
        archive.append(skill.mainContent, { name: `${skill.name}/${skill.mainFileName}` });

        // Add sub-files
        const subFiles = await listSkillFiles(skill.name, skill.scope);
        for (const item of subFiles) {
          const result = await readSkillSubFile(skill.name, item.subdir, item.name, skill.scope);
          if (result) {
            archive.append(result.content, { name: `${skill.name}/${item.subdir}/${item.name}` });
          }
        }
      }
      archive.finalize();
    };

    addAllFiles().catch(reject);
  });
}

/**
 * GET /api/skills/export-all?format=openclaw&scope=global&output=zip
 *
 * 批量导出所有（或指定 scope）Skill 为 ZIP 包。
 * - format 缺省时返回可用格式列表。
 * - scope 缺省时导出所有 scope 的 Skill。
 * - output=zip（或省略）时返回 ZIP 文件。
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format');

    // 如果没有指定 format，返回可用格式列表
    if (!format) {
      return NextResponse.json({ formats: listExportFormats() });
    }

    // 确定要导出的 scope
    const scopeParam = url.searchParams.get('scope');
    let scope: SkillScope | undefined;
    if (scopeParam) {
      scope = parseScopeFromParams(url.searchParams);
    }

    // 列出 skills
    const skillList = scope ? await listSkills(scope) : await listAllSkills();

    // 逐个读取并转换
    const zipEntries: SkillZipEntry[] = [];
    await Promise.all(
      skillList.map(async (item) => {
        const content = await readSkillFile(item.name, item.scope);
        if (!content) return;
        const exported = exportSkill({ name: item.name, content }, format);
        zipEntries.push({
          name: item.name,
          mainFileName: exported.fileName,
          mainContent: exported.content,
          scope: item.scope,
        });
      }),
    );

    if (zipEntries.length === 0) {
      return NextResponse.json({ error: 'No skills found' }, { status: 404 });
    }

    const zipBuffer = await createAllSkillsZip(zipEntries);
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="skills-export-${format}-${timestamp}.zip"`,
        'Content-Length': String(zipBuffer.byteLength),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Unknown export format') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
