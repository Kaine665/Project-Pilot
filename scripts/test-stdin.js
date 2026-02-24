const { spawn } = require('child_process');

console.log('Testing claude -p with stdin pipe...');

const claude = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
  cwd: process.cwd(),
  shell: true,
  env: { ...process.env, FORCE_COLOR: '0' },
});

claude.stdin.write('请回复"测试成功"两个字，不要多说别的。');
claude.stdin.end();

let output = '';

claude.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf-8');
  output += text;
  process.stdout.write(`[stdout] ${text}`);
});

claude.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf-8');
  process.stderr.write(`[stderr] ${text}`);
});

claude.on('close', (code) => {
  console.log(`\n--- Process exited with code ${code} ---`);
  console.log(`Total output length: ${output.length}`);
});

claude.on('error', (err) => {
  console.error(`Spawn error: ${err.message}`);
});
