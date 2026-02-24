const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const [, , taskId, planId] = process.argv;

if (!taskId || !planId) {
  console.error('Usage: node planner.js <taskId> <planId>');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '../../data');
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');
const PLANS_PATH = path.join(DATA_DIR, 'ai-plans.json');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const LOG_PATH = path.join(LOGS_DIR, `${planId}.log`);

const taskAgentDir = path.join(__dirname, '../..');

// ── helpers ──

async function ensureDirs() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'prompts'), { recursive: true });
}

async function log(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  console.log(line.trim());
  await fs.appendFile(LOG_PATH, line).catch(() => {});
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf-8')); } catch { return fallback; }
}

async function updateTaskStatus(updates) {
  const data = await readJson(TASKS_PATH, { tasks: [] });
  data.tasks = data.tasks.map((t) =>
    t.id === taskId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t,
  );
  await fs.writeFile(TASKS_PATH, JSON.stringify(data, null, 2));
}

async function updatePlan(planData) {
  const data = await readJson(PLANS_PATH, { plans: [] });
  const idx = data.plans.findIndex((p) => p.plan_id === planId);
  if (idx >= 0) data.plans[idx] = { ...data.plans[idx], ...planData };
  else data.plans.push(planData);
  await fs.writeFile(PLANS_PATH, JSON.stringify(data, null, 2));
}

async function cleanupFailedPlan() {
  // Remove the failed plan entry entirely
  const data = await readJson(PLANS_PATH, { plans: [] });
  data.plans = data.plans.filter((p) => p.plan_id !== planId);
  await fs.writeFile(PLANS_PATH, JSON.stringify(data, null, 2));

  // Restore task to most recent valid plan, or clear ai_execution
  const remaining = data.plans
    .filter((p) => p.task_id === taskId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (remaining.length > 0) {
    const latest = remaining[0];
    await updateTaskStatus({
      ai_execution: {
        status: latest.status,
        current_plan_id: latest.plan_id,
        plan_count: remaining.length,
        execution_count: 0,
        last_update: new Date().toISOString(),
      },
    });
  } else {
    await updateTaskStatus({ ai_execution: undefined });
  }
}

async function resolveWorkingDirectory(task) {
  const proj = await readJson(PROJECTS_PATH, { projects: {} });
  if (proj.projects[task.projectKey]) return proj.projects[task.projectKey].path;
  return taskAgentDir;
}

// ── main ──

async function main() {
  await ensureDirs();
  await log(`Starting plan generation for task: ${taskId}`);

  const tasksData = await readJson(TASKS_PATH, { tasks: [] });
  const task = tasksData.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const workingDir = await resolveWorkingDirectory(task);
  await log(`Working directory: ${workingDir}`);

  // Build prompt
  const prompt = `你是 ProjectPilot 系统的 AI 计划生成器。

**当前任务**：
- ID: ${task.id}
- 标题: ${task.title}
- 描述: ${task.content || '(无详细描述)'}

**你的职责**：
⚠️ **重要：你现在处于计划模式（Planning Mode），只需生成执行计划，不要执行任何代码修改操作！**

1. 分析任务：理解用户意图，评估复杂度，识别依赖
2. 检查信息是否充足，如果不足在 plan 中添加 questions
3. 生成详细的分步执行计划

4. **写入计划文件**：使用以下命令将计划写入 JSON：
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/ai-plans.json', 'utf8'));
const idx = data.plans.findIndex(p => p.plan_id === '${planId}');
const plan = {
  plan_id: '${planId}',
  task_id: '${taskId}',
  created_at: new Date().toISOString(),
  status: 'pending_approval',
  analysis: '你的任务分析...',
  questions: [],
  steps: [
    { id: 1, type: 'auto', action: '步骤名', description: '详细说明', status: 'pending', risk_level: 'low' }
  ],
  expected_results: '预期结果...',
  risks: '风险评估...',
  execution_notes: '注意事项...'
};
if (idx >= 0) data.plans[idx] = plan; else data.plans.push(plan);
fs.writeFileSync('data/ai-plans.json', JSON.stringify(data, null, 2));
console.log('Plan saved');
"
\`\`\`

5. **更新 task 状态**：
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/tasks.json', 'utf8'));
const t = data.tasks.find(t => t.id === '${taskId}');
if (t) { t.ai_execution = { ...t.ai_execution, status: 'pending_approval', last_update: new Date().toISOString() }; t.updatedAt = new Date().toISOString(); }
fs.writeFileSync('data/tasks.json', JSON.stringify(data, null, 2));
console.log('Task updated');
"
\`\`\`

**重要**：
- ❌ 不要修改项目源代码
- ✅ 只生成计划并写入 ai-plans.json
- ✅ 设置状态为 pending_approval

现在开始分析任务并生成计划！`;

  // Write prompt to file (for reference)
  const promptFile = path.join(DATA_DIR, 'prompts', `${planId}_planning.txt`);
  await fs.writeFile(promptFile, prompt, 'utf-8');

  // Create initial plan record
  await updatePlan({
    plan_id: planId,
    task_id: taskId,
    created_at: new Date().toISOString(),
    status: 'planning',
    analysis: '正在分析任务并生成执行计划...',
    steps: [],
  });

  // Update task status
  await updateTaskStatus({
    ai_execution: {
      status: 'planning',
      current_plan_id: planId,
      plan_count: 1,
      execution_count: 0,
      last_update: new Date().toISOString(),
    },
  });

  await log('Spawning claude -p (non-interactive, stdin pipe)...');

  // Spawn claude -p non-interactively, pipe prompt via stdin to avoid Windows cmd length limit
  const claude = spawn('claude', [
    '-p',
    '--dangerously-skip-permissions',
  ], {
    cwd: workingDir,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0', CLAUDECODE: '' },
  });

  // Write prompt via stdin (avoids ~8191 char Windows command line limit)
  claude.stdin.write(prompt);
  claude.stdin.end();

  // Stream stdout/stderr to log file in real-time
  claude.stdout.on('data', async (chunk) => {
    const text = chunk.toString('utf-8');
    await fs.appendFile(LOG_PATH, text).catch(() => {});
  });

  claude.stderr.on('data', async (chunk) => {
    const text = chunk.toString('utf-8');
    await fs.appendFile(LOG_PATH, `[stderr] ${text}`).catch(() => {});
  });

  claude.on('close', async (code) => {
    await log(`Claude process exited with code ${code}`);

    if (code === 0) {
      // Check if plan was updated by Claude
      const plans = await readJson(PLANS_PATH, { plans: [] });
      const plan = plans.plans.find((p) => p.plan_id === planId);
      if (plan && plan.status === 'pending_approval') {
        await log('Plan successfully generated and saved.');
      } else {
        await log('Claude exited OK but plan may not have been written. Marking pending_approval anyway.');
        await updatePlan({ status: 'pending_approval', analysis: plan?.analysis || '计划生成完成（请查看日志）' });
        await updateTaskStatus({
          ai_execution: {
            status: 'pending_approval',
            current_plan_id: planId,
            last_update: new Date().toISOString(),
          },
        });
      }
    } else {
      await log(`Claude failed with exit code ${code}. Cleaning up failed plan.`);
      await cleanupFailedPlan();
    }
  });

  claude.on('error', async (err) => {
    await log(`Failed to spawn claude: ${err.message}. Cleaning up failed plan.`);
    await cleanupFailedPlan();
  });
}

main().catch(async (err) => {
  await log(`Fatal error: ${err.message}`);
  process.exit(1);
});
