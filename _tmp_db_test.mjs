// 完整实验：一次性拿到所有表结构 + 行数
const BASE = 'http://81.68.249.18:8100/rest/v1';
const HEADERS = {
  'apikey': 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc3MDQ0OTk0MywgImV4cCI6IDIwODU4MDk5NDN9.c93Eb3linNGsiZj7dEb7PSR4ko7pDNuwbs62Ps5xyB0',
  'Authorization': 'Bearer eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogInNlcnZpY2Vfcm9sZSIsICJpc3MiOiAic3VwYWJhc2UiLCAiaWF0IjogMTc3MDQ0OTk0MywgImV4cCI6IDIwODU4MDk5NDN9.c93Eb3linNGsiZj7dEb7PSR4ko7pDNuwbs62Ps5xyB0',
};

async function run() {
  const t0 = Date.now();

  // Step 1: OpenAPI spec（包含完整字段定义）
  const t1 = Date.now();
  const spec = await fetch(`${BASE}/`, { headers: HEADERS }).then(r => r.json());
  const specMs = Date.now() - t1;

  // 提取表和字段
  const tables = {};
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    if (name.startsWith('rpc') || name === '') continue;
    const props = def.properties || {};
    tables[name] = {
      columns: Object.entries(props).map(([col, info]) => ({
        name: col,
        type: info.format || info.type || 'unknown',
        description: info.description || '',
      })),
    };
  }
  console.log(`Step 1 - OpenAPI spec: ${Object.keys(tables).length} tables, ${specMs}ms`);

  // Step 2: 并行查行数（并发限制 10）
  const t2 = Date.now();
  const tableNames = Object.keys(tables).sort();

  async function parallelLimit(items, limit, fn) {
    const results = [];
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
  }

  const counts = await parallelLimit(tableNames, 10, async (table) => {
    const res = await fetch(`${BASE}/${table}?select=*&limit=0`, {
      method: 'HEAD',
      headers: { ...HEADERS, 'Prefer': 'count=exact' },
    });
    const range = res.headers.get('content-range');
    return { table, count: range ? parseInt(range.split('/')[1]) || 0 : -1 };
  });
  console.log(`Step 2 - Row counts: ${counts.length} tables, ${Date.now() - t2}ms`);

  const totalMs = Date.now() - t0;
  console.log(`\n=== Total: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s) ===\n`);

  // 合并输出
  const countMap = Object.fromEntries(counts.map(c => [c.table, c.count]));

  // 输出 Markdown 格式
  console.log('# Database Snapshot (Prod)\n');
  for (const name of tableNames) {
    const t = tables[name];
    const rowCount = countMap[name] ?? '?';
    console.log(`## ${name} (${rowCount} rows)\n`);
    console.log('| Column | Type | Description |');
    console.log('|--------|------|-------------|');
    for (const col of t.columns) {
      console.log(`| ${col.name} | ${col.type} | ${col.description.substring(0, 60)} |`);
    }
    console.log('');
  }
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
