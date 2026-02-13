const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// 获取命令行参数
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

// 确保日志目录存在
fs.mkdir(LOGS_DIR, { recursive: true }).catch(console.error);

// task-agent 项目根目录
const taskAgentDir = path.join(__dirname, '../..');

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
    await log(`Starting plan generation for task: ${taskId}`);

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

    // 构建 AI 提示词（Planning Mode）
    const prompt = `你是 task-agent 系统的 AI 计划生成器。

**当前任务**：
- ID: ${task.id}
- 标题: ${task.title}
- 描述: ${task.content || '(无详细描述)'}

**你的职责**：
\u26a0\ufe0f **重要：你现在处于计划模式（Planning Mode），只需生成执行计划，不要执行任何操作！**

1. **分析任务**
   - 理解用户意图
   - 评估任务复杂度
   - 识别所需信息

2. **检查信息是否充足**
   - 如果信息不足，在 plan 中添加 questions 字段，列出需要用户回答的问题
   - 如果信息充足，继续生成计划

3. **生成执行计划**
   - 创建详细的 steps 数组（每个步骤包含：id, type, action, description）
   - 评估每个步骤的风险和依赖关系
   - 预估执行结果

4. **写入计划文件**
   - 将计划写入 ${PLANS_PATH.replace(/\\/g, '/')}
   - 设置 status 为 "pending_approval"（等待人类批准）

**计划数据结构**：
\`\`\`json
{
  "plan_id": "${planId}",
  "task_id": "${taskId}",
  "created_at": "ISO时间",
  "status": "pending_approval",
  "analysis": "任务分析：描述你对这个任务的理解...",
  "questions": [
    // 如果信息不足，在这里列出问题
    {
      "id": 1,
      "question": "是否需要添加测试用例？",
      "type": "yes_no",
      "importance": "optional"
    }
  ],
  "steps": [
    {
      "id": 1,
      "type": "auto",
      "action": "读取相关文件",
      "description": "读取 src/... 了解现有结构",
      "estimated_time": "1分钟",
      "risk_level": "low"
    },
    {
      "id": 2,
      "type": "auto",
      "action": "编写代码",
      "description": "创建新的文件...",
      "estimated_time": "5分钟",
      "risk_level": "medium",
      "dependencies": [1]
    }
  ],
  "expected_results": "预期将创建以下文件：...",
  "risks": "可能的风险：...",
  "execution_notes": "执行时的注意事项：..."
}
\`\`\`

**使用 Node.js 脚本写入计划**：
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const path = 'data/ai-plans.json';
let data;
try {
  data = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch {
  data = { plans: [] };
}

// 创建新计划
const newPlan = {
  plan_id: '${planId}',
  task_id: '${taskId}',
  created_at: new Date().toISOString(),
  status: 'pending_approval',
  analysis: '你的分析...',
  questions: [], // 或添加问题
  steps: [
    // 你生成的步骤...
  ],
  expected_results: '...',
  risks: '...',
  execution_notes: '...'
};

// 检查是否已存在
const existingIndex = data.plans.findIndex(p => p.plan_id === '${planId}');
if (existingIndex >= 0) {
  data.plans[existingIndex] = newPlan;
} else {
  data.plans.push(newPlan);
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Plan saved successfully');
"
\`\`\`

**完成后更新 task 状态**：
\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const path = 'data/tasks.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const task = data.tasks.find(t => t.id === '${taskId}');
if (task && task.ai_execution) {
  task.ai_execution.status = 'pending_approval';
  task.ai_execution.current_action = '计划已生成，等待用户审批';
  task.ai_execution.last_update = new Date().toISOString();
}
fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Task status updated');
"
\`\`\`

**重要提醒**：
- \u274c 不要执行任何代码编写、文件修改等操作
- \u274c 不要设置 task.completedAt
- \u2705 只需生成计划并写入 ai-plans.json
- \u2705 设置状态为 "pending_approval"
- \u2705 如果信息不足，添加 questions 字段询问用户

现在开始生成计划！`;

    // 创建初始计划
    const initialPlan = {
      plan_id: planId,
      task_id: taskId,
      created_at: new Date().toISOString(),
      status: 'planning',
      analysis: '正在分析任务并生成执行计划...',
      steps: [],
      current_step: 0,
      execution_history: [
        {
          timestamp: new Date().toISOString(),
          event: 'planning_started',
          details: 'AI 计划生成器已启动，等待 Claude Code 分析任务'
        }
      ]
    };
    await updatePlan(initialPlan);
    await log('Initial planning record created');

    // 将 prompt 写入临时文件
    const promptFile = path.join(DATA_DIR, 'prompts', `${planId}_planning.txt`);
    await fs.mkdir(path.dirname(promptFile), { recursive: true });
    await fs.writeFile(promptFile, prompt, 'utf-8');
    await log(`Prompt written to: ${promptFile}`);

    // 创建 PowerShell 启动脚本
    const psFile = path.join(DATA_DIR, 'prompts', `${planId}_planning.ps1`);

    // 创建简短的启动命令
    const startCommand = `Read ${promptFile.replace(/\\/g, '/')} and execute the task`;

    await log(`Start command: ${startCommand}`);

    // PowerShell 脚本内容
    const psContent = `# Task Agent AI Planner
# Set console encoding to UTF-8
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Task Agent AI Planner (Planning Mode)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Task: ${task.title.replace(/"/g, '`"')}" -ForegroundColor Yellow
Write-Host "Plan ID: ${planId}" -ForegroundColor Yellow
Write-Host "Working Directory: ${workingDir}" -ForegroundColor Yellow
Write-Host ""
Write-Host "MODE: Planning Only (No Execution)" -ForegroundColor Magenta
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Copy command to clipboard
$command = "${startCommand}"
Set-Clipboard -Value $command

Write-Host "READY TO GENERATE PLAN!" -ForegroundColor Green
Write-Host ""
Write-Host "Command copied to clipboard:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  $command" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press ANY KEY to start Claude Code..." -ForegroundColor White -BackgroundColor DarkGreen
Write-Host "AI will ONLY generate a plan, NOT execute it" -ForegroundColor Gray
Write-Host ""

# Wait for user confirmation
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host ""
Write-Host "Starting Claude Code (Planning Mode)..." -ForegroundColor Green
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
    await log('Launching Claude Code in planning mode...');

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

    await log('Claude Code launched in new terminal window (Planning Mode)');
    await log(`Working directory: ${workingDir}`);
    await log(`Task Agent directory: ${taskAgentDir}`);
    await log(`Plan ID: ${planId}`);
    await log(`Full prompt file: ${promptFile}`);

    // 更新状态为计划生成中
    await updateTaskStatus({
      ai_execution: {
        status: 'planning',
        plan_id: planId,
        current_step: 0,
        current_action: 'Claude Code 已启动（计划模式），正在分析任务...',
        started_at: task.ai_execution?.started_at || new Date().toISOString(),
        last_update: new Date().toISOString(),
      },
    });

    await addLog(`AI 计划生成已启动：Claude Code 已在新窗口打开（计划模式），正在为任务 "${task.title}" 生成执行计划`);
  } catch (error) {
    await log(`Fatal error: ${error.message}`);
    await addLog(`AI 计划生成器错误：${error.message}`);
    process.exit(1);
  }
}

main();
