const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// 获取命令行参数
const [, , taskId, planId] = process.argv;

if (!taskId || !planId) {
  console.error('Usage: node executor.js <taskId> <planId>');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '../../data');
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');
const PLANS_PATH = path.join(DATA_DIR, 'ai-plans.json');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const LOG_PATH = path.join(LOGS_DIR, `${planId}.log`);

// 确保日志目录存在
fs.mkdir(LOGS_DIR, { recursive: true }).catch(console.error);

// task-agent 项目根目录
const taskAgentDir = path.join(__dirname, '../..');

// 验证产物目录
const artifactsDir = path.join(DATA_DIR, 'artifacts', planId);

// 从 projects.json 解析工作目录
async function resolveWorkingDirectory(task) {
  const projectsData = JSON.parse(await fs.readFile(PROJECTS_PATH, 'utf-8'));
  const project = projectsData.projects[task.projectKey];
  if (project) return project.path;
  // fallback: search task title/content for project names
  const content = `${task.title} ${task.content}`.toLowerCase();
  for (const [key, proj] of Object.entries(projectsData.projects)) {
    if (content.includes(key)) return proj.path;
  }
  return taskAgentDir;
}

// 日志输出函数
async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  try {
    await fs.appendFile(LOG_PATH, logMessage);
  } catch (error) {
    console.error('Failed to write log:', error);
  }
}

// 更新 task 状态
async function updateTaskStatus(updates) {
  const data = JSON.parse(await fs.readFile(TASKS_PATH, 'utf-8'));
  data.tasks = data.tasks.map((t) =>
    t.id === taskId
      ? { ...t, ...updates, updatedAt: new Date().toISOString() }
      : t
  );
  await fs.writeFile(TASKS_PATH, JSON.stringify(data, null, 2));
}

// 更新执行计划
async function updatePlan(planData) {
  let plansData;
  try {
    plansData = JSON.parse(await fs.readFile(PLANS_PATH, 'utf-8'));
  } catch {
    plansData = { plans: [] };
  }

  const existingIndex = plansData.plans.findIndex((p) => p.plan_id === planId);
  if (existingIndex >= 0) {
    plansData.plans[existingIndex] = { ...plansData.plans[existingIndex], ...planData };
  } else {
    plansData.plans.push(planData);
  }

  await fs.writeFile(PLANS_PATH, JSON.stringify(plansData, null, 2));
}

// 添加日志到 task
async function addLog(logMessage) {
  const data = JSON.parse(await fs.readFile(TASKS_PATH, 'utf-8'));
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) return;

  const logs = task.logs || [];
  logs.push({
    date: new Date().toISOString(),
    did: logMessage,
  });

  data.tasks = data.tasks.map((t) =>
    t.id === taskId
      ? { ...t, logs, updatedAt: new Date().toISOString() }
      : t
  );
  await fs.writeFile(TASKS_PATH, JSON.stringify(data, null, 2));
}

async function main() {
  try {
    await log(`Starting execution for task: ${taskId}`);

    // 读取 task 信息
    const tasksData = JSON.parse(await fs.readFile(TASKS_PATH, 'utf-8'));
    const task = tasksData.tasks.find((t) => t.id === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    await log(`Task title: ${task.title}`);
    await log(`Task content: ${task.content}`);

    // 从 projects.json 解析项目目录
    const workingDir = await resolveWorkingDirectory(task);
    await log(`Detected working directory: ${workingDir}`);

    // 构建 AI 提示词（Execution Mode）
    const prompt = `你是 task-agent 系统的 AI 执行器。

**当前任务**：
- ID: ${task.id}
- 标题: ${task.title}
- 描述: ${task.content}

\u26a0\ufe0f **重要：你现在处于执行模式（Execution Mode）**

**你的职责**：
1. **读取已批准的执行计划**
   从 ${PLANS_PATH.replace(/\\/g, '/')} 读取 plan_id = "${planId}" 的计划
   这个计划已经经过人类审批确认

2. **按计划执行任务**
   - 严格按照计划中的 steps 数组执行
   - 每执行一步，更新该步骤的状态
   - 记录每步的输出结果

3. **更新执行进度**
   - 更新 ${TASKS_PATH.replace(/\\/g, '/')} 的 ai_execution 字段
   - 更新 ${PLANS_PATH.replace(/\\/g, '/')} 中的步骤状态

4. **完成后记录**
   - 设置 plan.status = 'completed'
   - 设置 task.ai_execution.status = 'pending_review'（等待人工审核）
   - \u26a0\ufe0f **不要设置 task.completedAt** \u2014 人工审核通过后由前端设置
   - 添加完成日志

**执行流程**：

第一步：读取已批准的计划
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/ai-plans.json', 'utf8'));
const plan = data.plans.find(p => p.plan_id === '${planId}');
console.log(JSON.stringify(plan, null, 2));
"
\`\`\`

第二步：执行每个步骤
对每个 step:
1. 更新 step.status = 'running'
2. 执行该步骤的操作
3. 记录 step.output
4. 更新 step.status = 'completed'
5. 更新 plan.current_step

第三步：完成后更新状态

**重要提示**：
- \u2705 严格按照已批准的计划执行
- \u2705 使用 Write/Edit 工具更新普通文件（如 README.md）
- \u274c 不要偏离计划或添加额外步骤（除非遇到错误需要调整）
- \u2705 执行完成后更新 ai_execution.status 为 'pending_review'（等待人工审核）
- \u274c **不要设置 task.completedAt** \u2014 这由人工审核后设置

**文件写入策略（关键）**：

对于 JSON 文件（tasks.json、ai-plans.json）的更新，**使用 Node.js 脚本强制写入**：

**推荐方式**：使用 Node.js 一行命令（最可靠）
\`\`\`bash
# 更新 ai-plans.json
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "const fs=require('fs'); const path='data/ai-plans.json'; const data=JSON.parse(fs.readFileSync(path,'utf8')); /* 修改 data */ fs.writeFileSync(path, JSON.stringify(data,null,2)); console.log('Updated successfully');"

# 更新 tasks.json
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "const fs=require('fs'); const path='data/tasks.json'; const data=JSON.parse(fs.readFileSync(path,'utf8')); /* 修改 data.tasks */ fs.writeFileSync(path, JSON.stringify(data,null,2)); console.log('Updated successfully');"
\`\`\`

**完整示例（更新 ai-plans.json 的状态为 completed）**：
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const path = 'data/ai-plans.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const plan = data.plans.find(p => p.plan_id === '${planId}');
if (plan) {
  plan.status = 'completed';
  plan.completed_at = new Date().toISOString();
}
fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('ai-plans.json updated successfully');
"
\`\`\`

**完整示例（更新 tasks.json 标记为待审核）**：
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const path = 'data/tasks.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const task = data.tasks.find(t => t.id === '${taskId}');
if (task) {
  if (task.ai_execution) {
    task.ai_execution.status = 'pending_review';
    task.ai_execution.last_update = new Date().toISOString();
  }
}
fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('tasks.json updated: pending_review');
"
\`\`\`

\u26a0\ufe0f **重要**：不要设置 task.completedAt，人工审核后由前端设置。

**重要说明**：
1. **不要使用 Write/Edit 工具**更新 JSON（会因编辑器占用文件而失败）
2. **不要使用 PowerShell heredoc 或 cat heredoc**（引号转义问题导致语法错误）
3. 使用 Node.js 的 fs.writeFileSync 可以强制覆盖被占用的文件

第四步：提交代码变更
执行完所有代码步骤后，确保提交代码变更：
\`\`\`bash
cd "${workingDir.replace(/\\/g, '/')}" && git add -A && git commit -m "feat: <根据任务描述填写>"
\`\`\`

第五步：生成验证产物

执行完所有代码步骤后，你需要生成验证材料供人工审核。

**判断改动类型**：
运行 \`git diff --name-only HEAD~1\` 查看改了哪些文件。

**A) 如果有前端文件变更（.tsx/.jsx/.css/.html/.vue）**：
1. 获取项目配置：读取 ${PROJECTS_PATH.replace(/\\/g, '/')} 中 projectKey "${task.projectKey || ''}" 对应的 webCommand 和 webUrl
2. 启动开发服务器：在项目目录运行 webCommand（后台运行）
3. 等待服务器就绪（轮询 webUrl 直到响应 200）
4. 运行截图脚本：
   node "${taskAgentDir.replace(/\\/g, '/')}/scripts/verify/capture-screenshot.js" --url {webUrl} --out "${artifactsDir.replace(/\\/g, '/')}"
5. 关闭开发服务器

**B) 如果有后端/逻辑文件变更**：
1. 运行 \`git diff HEAD~1 --stat\` 获取变更概况
2. 运行 \`git diff HEAD~1 -U10\` 获取详细 diff
3. 将结果保存为 ${artifactsDir.replace(/\\/g, '/')}/code-diff.md，格式：
   # 代码变更
   ## 变更概况
   (git diff --stat 输出)
   ## 详细变更
   \`\`\`diff
   (git diff 输出)
   \`\`\`

**C) 生成 summary.json**：
将以下内容写入 ${artifactsDir.replace(/\\/g, '/')}/summary.json：
\`\`\`json
{
  "planId": "${planId}",
  "taskId": "${taskId}",
  "timestamp": "当前ISO时间",
  "changeType": "frontend" | "backend" | "both",
  "filesChanged": ["改动的文件列表"],
  "artifacts": [
    { "type": "screenshot", "path": "screenshot-xxx.png", "label": "页面描述" },
    { "type": "diff", "path": "code-diff.md", "label": "代码变更详情" }
  ]
}
\`\`\`

验证产物目录：${artifactsDir.replace(/\\/g, '/')}
确保该目录存在（mkdir -p）。

现在开始执行任务！`;

    // 创建初始计划
    const initialPlan = {
      plan_id: planId,
      task_id: taskId,
      created_at: new Date().toISOString(),
      status: 'running',
      analysis: '正在分析任务并生成执行计划...',
      steps: [],
      current_step: 0,
      execution_history: [
        {
          timestamp: new Date().toISOString(),
          event: 'plan_created',
          details: 'AI 执行器已启动，等待 Claude Code 分析任务'
        }
      ]
    };
    await updatePlan(initialPlan);
    await log('Initial plan created');

    // 将 prompt 写入临时文件
    const promptFile = path.join(DATA_DIR, 'prompts', `${planId}.txt`);
    await fs.mkdir(path.dirname(promptFile), { recursive: true });
    await fs.writeFile(promptFile, prompt, 'utf-8');
    await log(`Prompt written to: ${promptFile}`);

    // 创建 PowerShell 启动脚本
    const psFile = path.join(DATA_DIR, 'prompts', `${planId}.ps1`);

    // 创建简短的启动命令
    const startCommand = `Read ${promptFile.replace(/\\/g, '/')} and execute the task`;

    await log(`Start command: ${startCommand}`);

    // PowerShell 脚本内容（执行模式）
    const psContent = `# Task Agent AI Executor
# Set console encoding to UTF-8
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Task Agent AI Executor (Execution Mode)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Task: ${task.title.replace(/"/g, '`"')}" -ForegroundColor Yellow
Write-Host "Plan ID: ${planId}" -ForegroundColor Yellow
Write-Host "Working Directory: ${workingDir}" -ForegroundColor Yellow
Write-Host ""
Write-Host "MODE: Execute Approved Plan" -ForegroundColor Green
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Copy command to clipboard
$command = "${startCommand}"
Set-Clipboard -Value $command

Write-Host "READY TO EXECUTE!" -ForegroundColor Green
Write-Host ""
Write-Host "Command copied to clipboard:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  $command" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press ANY KEY to start Claude Code..." -ForegroundColor White -BackgroundColor DarkGreen
Write-Host "AI will execute the approved plan" -ForegroundColor Gray
Write-Host ""

# Wait for user confirmation
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host ""
Write-Host "Starting Claude Code (Execution Mode)..." -ForegroundColor Green
Write-Host ""

# Change to working directory and start Claude Code
Set-Location "${workingDir.replace(/\\/g, '/')}"
& claude --dangerously-skip-permissions --add-dir "${taskAgentDir.replace(/\\/g, '/')}"
`;

    // 使用 UTF-8 with BOM 保存 PowerShell 脚本
    const utf8WithBom = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]), // UTF-8 BOM
      Buffer.from(psContent, 'utf-8')
    ]);
    await fs.writeFile(psFile, utf8WithBom);
    await log(`PowerShell script created: ${psFile}`);

    // 在新窗口启动 PowerShell 脚本
    await log('Launching Claude Code in new window...');

    const launchProcess = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `Start-Process powershell -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', '"${psFile}"'`
    ], {
      detached: true,
      stdio: 'ignore',
      shell: true
    });

    launchProcess.unref();

    await log('Claude Code launched in new terminal window');
    await log(`Working directory: ${workingDir}`);
    await log(`Task Agent directory: ${taskAgentDir}`);
    await log(`Plan ID: ${planId}`);
    await log(`Full prompt file: ${promptFile}`);
    await log(`Artifacts directory: ${artifactsDir}`);

    // 更新状态为运行中
    await updateTaskStatus({
      ai_execution: {
        status: 'running',
        plan_id: planId,
        current_step: 0,
        current_action: 'Claude Code 已启动，正在分析任务...',
        started_at: task.ai_execution?.started_at || new Date().toISOString(),
        last_update: new Date().toISOString(),
      },
    });

    await addLog(`AI 执行已启动：Claude Code 已在新窗口打开，正在处理任务 "${task.title}"`);
  } catch (error) {
    await log(`Fatal error: ${error.message}`);
    await addLog(`AI 执行器错误：${error.message}`);
    process.exit(1);
  }
}

main();
