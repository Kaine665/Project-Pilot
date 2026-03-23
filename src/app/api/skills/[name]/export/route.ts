import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { readSkillFile, listSkillFiles, readSkillSubFile } from '@/lib/skill-store';
import { parseScopeFromParams } from '../../scope-utils';
import { exportSkill, listExportFormats } from '@/lib/skill-export';
import type { SkillScope } from '@/lib/file-store';

type Params = { params: Promise<{ name: string }> };

/**
 * 将 skill 数据打包成 ZIP Buffer。
 * ZIP 结构：
 *   {skillName}/SKILL.md
 *   {skillName}/scripts/...
 *   {skillName}/references/...
 *   {skillName}/assets/...
 */
async function createSkillZip(
  skillName: string,
  mainFileName: string,
  mainContent: string,
  scope: SkillScope,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);

    archive.pipe(passThrough);
    archive.on('error', reject);

    // Add main skill file
    archive.append(mainContent, { name: `${skillName}/${mainFileName}` });

    // Finalize after adding sub-files (async)
    listSkillFiles(skillName, scope).then(async (subFiles) => {
      for (const item of subFiles) {
        const result = await readSkillSubFile(skillName, item.subdir, item.name, scope);
        if (result) {
          archive.append(result.content, { name: `${skillName}/${item.subdir}/${item.name}` });
        }
      }
      archive.finalize();
    }).catch(reject);
  });
}

/**
 * GET /api/skills/{name}/export?scope=global&format=standard
 *
 * 导出单个 Skill 为 ZIP 包。
 * - format 缺省时返回可用格式列表。
 */
export async function GET(req: Request, { params }: Params) {
  const { name } = await params;
  try {
    const url = new URL(req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const format = url.searchParams.get('format');

    // 如果没有指定 format，返回可用格式列表
    if (!format) {
      return NextResponse.json({ formats: listExportFormats() });
    }

    const content = await readSkillFile(name, scope);
    if (content === undefined) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    const exported = exportSkill({ name, content }, format);

    const zipBuffer = await createSkillZip(name, exported.fileName, exported.content, scope);

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}-${format}.zip"`,
        'Content-Length': String(zipBuffer.byteLength),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('Unknown export format') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
