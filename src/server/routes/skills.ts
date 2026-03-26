import { Hono } from 'hono';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import {
  listSkills,
  listAllSkills,
  writeSkillFile,
  parseSkillFrontmatter,
  detectLegacySkills,
  migrateLegacySkill,
  readSkillFile,
  deleteSkillFile,
  listSkillVersions,
  readSkillVersion,
  revertSkillToVersion,
  listSkillFiles,
  readSkillSubFile,
  writeSkillSubFile,
  deleteSkillSubFile,
} from '@/lib/skill-store';
import { exportSkill, listExportFormats } from '@/lib/skill-export';
import type { SkillScope } from '@/lib/file-store';

const app = new Hono();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseScopeFromParams(params: URLSearchParams): SkillScope {
  const level = params.get('scope') ?? 'global';
  switch (level) {
    case 'project': {
      const projectKey = params.get('projectKey');
      if (!projectKey) throw new Error('projectKey is required for scope=project');
      return { level: 'project', projectKey };
    }
    case 'agent': {
      const agentId = params.get('agentId');
      if (!agentId) throw new Error('agentId is required for scope=agent');
      return { level: 'agent', agentId };
    }
    case 'global':
    default:
      return { level: 'global' };
  }
}

function parseScopeFromBody(s: { level: string; projectKey?: string; agentId?: string }) {
  return parseScopeFromParams(new URLSearchParams({
    scope: s.level,
    ...(s.projectKey ? { projectKey: s.projectKey } : {}),
    ...(s.agentId ? { agentId: s.agentId } : {}),
  }));
}

interface SkillZipEntry {
  name: string;
  mainFileName: string;
  mainContent: string;
  scope: SkillScope;
}

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

    archive.append(mainContent, { name: `${skillName}/${mainFileName}` });

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
        archive.append(skill.mainContent, { name: `${skill.name}/${skill.mainFileName}` });
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

// ---------------------------------------------------------------------------
// GET  / — List skills
// POST / — Create new skill or migrate legacy skill
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);

    if (url.searchParams.get('legacy') === 'true') {
      const legacy = await detectLegacySkills();
      return c.json(legacy);
    }

    const scopeParam = url.searchParams.get('scope');
    if (!scopeParam) {
      const skills = await listAllSkills();
      return c.json(skills);
    }

    const scope = parseScopeFromParams(url.searchParams);
    const skills = await listSkills(scope);
    return c.json(skills);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.post('/', async (c) => {
  try {
    const body = await c.req.json();

    if (body.action === 'migrate') {
      if (!body.dirName || !body.scope?.level) {
        return c.json({ error: 'dirName and scope.level are required' }, 400);
      }
      const scope = parseScopeFromBody(body.scope);
      await migrateLegacySkill(body.dirName, scope);
      return c.json({ migrated: body.dirName, scope });
    }

    if (!body.content) {
      return c.json({ error: 'content is required' }, 400);
    }

    const meta = parseSkillFrontmatter(body.content);
    if (!meta) {
      return c.json({ error: 'content must have valid YAML frontmatter with name and description' }, 400);
    }

    const skillName = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : meta.name;
    const scope = body.scope ? parseScopeFromBody(body.scope) : { level: 'global' as const };
    await writeSkillFile(skillName, body.content, scope);
    return c.json({ name: skillName, scope }, 201);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /export-all — Batch export all skills as ZIP
// ---------------------------------------------------------------------------

app.get('/export-all', async (c) => {
  try {
    const url = new URL(c.req.url);
    const format = url.searchParams.get('format');

    if (!format) {
      return c.json({ formats: listExportFormats() });
    }

    const scopeParam = url.searchParams.get('scope');
    let scope: SkillScope | undefined;
    if (scopeParam) {
      scope = parseScopeFromParams(url.searchParams);
    }

    const skillList = scope ? await listSkills(scope) : await listAllSkills();

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
      return c.json({ error: 'No skills found' }, 404);
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
    return c.json({ error: message }, status);
  }
});

// ---------------------------------------------------------------------------
// GET    /:name — Read a skill
// PUT    /:name — Update a skill
// DELETE /:name — Delete a skill
// ---------------------------------------------------------------------------

app.get('/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const content = await readSkillFile(name, scope);
    if (content === undefined) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    const meta = parseSkillFrontmatter(content);
    return c.json({
      name: meta?.name ?? name,
      description: meta?.description ?? '',
      content,
      scope,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.put('/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const body = await c.req.json<{ content?: string }>();
    if (!body.content) {
      return c.json({ error: 'content is required' }, 400);
    }
    const meta = parseSkillFrontmatter(body.content);
    if (!meta) {
      return c.json({ error: 'content must have valid YAML frontmatter with name and description' }, 400);
    }
    await writeSkillFile(name, body.content, scope);
    return c.json({ name, scope });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.delete('/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    await deleteSkillFile(name, scope);
    return c.body(null, 204);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:name/export — Export a single skill as ZIP
// ---------------------------------------------------------------------------

app.get('/:name/export', async (c) => {
  const name = c.req.param('name');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const format = url.searchParams.get('format');

    if (!format) {
      return c.json({ formats: listExportFormats() });
    }

    const content = await readSkillFile(name, scope);
    if (content === undefined) {
      return c.json({ error: 'Skill not found' }, 404);
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
    return c.json({ error: message }, status);
  }
});

// ---------------------------------------------------------------------------
// GET /:name/history — List skill versions
// ---------------------------------------------------------------------------

app.get('/:name/history', async (c) => {
  const name = c.req.param('name');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const versions = await listSkillVersions(name, scope);
    return c.json(versions);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET  /:name/history/:version — Read a specific version
// POST /:name/history/:version/revert — Revert to a specific version
// ---------------------------------------------------------------------------

app.get('/:name/history/:version', async (c) => {
  const name = c.req.param('name');
  const version = c.req.param('version');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const content = await readSkillVersion(name, version, scope);
    if (content === undefined) {
      return c.json({ error: 'Version not found' }, 404);
    }
    return c.json({ version, content });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.post('/:name/history/:version/revert', async (c) => {
  const name = c.req.param('name');
  const version = c.req.param('version');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const ok = await revertSkillToVersion(name, version, scope);
    if (!ok) {
      return c.json({ error: 'Version not found' }, 404);
    }
    return c.json({ name, revertedTo: version });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:name/files — List skill sub-files
// ---------------------------------------------------------------------------

app.get('/:name/files', async (c) => {
  const name = c.req.param('name');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const files = await listSkillFiles(name, scope);
    return c.json(files);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET    /:name/files/:subdir/:fileName — Read a sub-file
// PUT    /:name/files/:subdir/:fileName — Write a sub-file
// DELETE /:name/files/:subdir/:fileName — Delete a sub-file
// ---------------------------------------------------------------------------

app.get('/:name/files/:subdir/:fileName', async (c) => {
  const name = c.req.param('name');
  const subdir = c.req.param('subdir');
  const fileName = c.req.param('fileName');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const result = await readSkillSubFile(name, subdir, fileName, scope);
    if (!result) {
      return c.json({ error: 'File not found' }, 404);
    }
    return c.json({ name: fileName, subdir, content: result.content, size: result.size });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.put('/:name/files/:subdir/:fileName', async (c) => {
  const name = c.req.param('name');
  const subdir = c.req.param('subdir');
  const fileName = c.req.param('fileName');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    const body = await c.req.json<{ content?: string }>();
    if (body.content === undefined) {
      return c.json({ error: 'content is required' }, 400);
    }
    await writeSkillSubFile(name, subdir, fileName, body.content, scope);
    return c.json({ name: fileName, subdir });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

app.delete('/:name/files/:subdir/:fileName', async (c) => {
  const name = c.req.param('name');
  const subdir = c.req.param('subdir');
  const fileName = c.req.param('fileName');
  try {
    const url = new URL(c.req.url);
    const scope = parseScopeFromParams(url.searchParams);
    await deleteSkillSubFile(name, subdir, fileName, scope);
    return c.body(null, 204);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

export default app;
