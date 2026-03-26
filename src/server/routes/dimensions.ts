import { Hono } from 'hono';
import { getDimensionsPath, readJsonFile, writeJsonFile } from '@/lib/file-store';
import type { Dimension, DimensionsData } from '@/types';

const app = new Hono();

const DEFAULT_DIMENSIONS: Dimension[] = [
  { id: 'pages', name: '页面清单', description: '有哪些页面', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'ui-layout', name: '各页面 UI 布局图', description: '每个页面长什么样、元素怎么摆', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'user-flow', name: '用户流程', description: '用户点了什么、看到什么、下一步能干什么（只有用户能感知到的东西）', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'logic', name: '功能逻辑', description: '一个功能内部怎么运作：先判断什么、再做什么、遇到岔路怎么走（不涉及具体函数名，但比用户流程深一层）', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'data-path', name: '数据链路', description: '数据从哪张表读、往哪里写、经过哪些中转', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'db-schema', name: '数据库表设计', description: '有哪些表、什么字段、什么关系', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'interactions', name: '交互起点', description: '每个页面上用户能做什么操作：哪些能点、能长按、能滑动（全软件可触发的东西是有限的）', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'db-rationale', name: '数据库表设计思路', description: '为什么这样设计：为什么拆表、为什么选这个字段类型、为什么用这种关联方式（给未来的自己、AI、合作者看的）', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
  { id: 'module-features', name: '模块功能清单', description: '按 App 现有模块（Tab/入口）组织，展示每个模块下有哪些功能、每个功能下有哪些子功能。依赖现有结构，结构变则清单变。', createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z' },
];

async function readDimensions(): Promise<DimensionsData> {
  const data = await readJsonFile<DimensionsData>(getDimensionsPath(), { dimensions: [] });
  if (data.dimensions.length === 0) {
    data.dimensions = DEFAULT_DIMENSIONS;
    await writeDimensions(data);
  }
  return data;
}

async function writeDimensions(data: DimensionsData): Promise<void> {
  await writeJsonFile(getDimensionsPath(), data);
}

app.get('/', async (c) => {
  const data = await readDimensions();
  const includeArchived = c.req.query('includeArchived') === 'true';
  const dimensions = includeArchived ? data.dimensions : data.dimensions.filter((d) => !d.archived);
  return c.json({ dimensions });
});

app.post('/', async (c) => {
  const { name, description } = await c.req.json();
  if (!name?.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  const now = new Date().toISOString();
  const dimension: Dimension = {
    id: `dim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    description: description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  const data = await readDimensions();
  data.dimensions.push(dimension);
  await writeDimensions(data);

  return c.json({ ok: true, dimension });
});

app.patch('/', async (c) => {
  const { id, name, description } = await c.req.json();
  if (!id) {
    return c.json({ error: 'id is required' }, 400);
  }

  const data = await readDimensions();
  const dimension = data.dimensions.find((d) => d.id === id);
  if (!dimension) {
    return c.json({ error: 'dimension not found' }, 404);
  }

  if (name !== undefined) dimension.name = name.trim();
  if (description !== undefined) dimension.description = description.trim() || undefined;
  dimension.updatedAt = new Date().toISOString();

  await writeDimensions(data);
  return c.json({ ok: true, dimension });
});

app.delete('/', async (c) => {
  const { id } = await c.req.json();
  if (!id) {
    return c.json({ error: 'id is required' }, 400);
  }

  const data = await readDimensions();
  const dimension = data.dimensions.find((d) => d.id === id);
  if (!dimension) {
    return c.json({ error: 'dimension not found' }, 404);
  }

  dimension.archived = true;
  dimension.archivedAt = new Date().toISOString();
  dimension.updatedAt = new Date().toISOString();
  await writeDimensions(data);

  return c.json({ ok: true });
});

export default app;
