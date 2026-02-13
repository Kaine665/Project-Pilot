const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

// 获取命令行参数
const [, , taskId, planId] = process.argv;

if (!taskId || !planId) {
  console.error('Usage: node discussor.js <taskId> <planId>');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '../../data');
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');
const PLANS_PATH = path.join(DATA_DIR, 'ai-plans.json');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const LOG_PATH = path.join(LOGS_DIR, `discuss-${planId}.log`);

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

async function main() {
  try {
    await log(`Starting plan discussion for task: ${taskId}`);

    // 读取 task 信息
    const tasksData = JSON.parse(await fs.readFile(TASKS_PATH, 'utf-8'));
    const task = tasksData.tasks.find((t) => t.id === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    await log(`Task title: ${task.title}`);

    // 读取现有计划
    let existingPlan = null;
    try {
      const plansData = JSON.parse(await fs.readFile(PLANS_PATH, 'utf-8'));
      existingPlan = plansData.plans.find((p) => p.plan_id === planId);
      await log(`Existing plan found: ${planId}`);
    } catch (error) {
      await log('No existing plan found');
    }

    // 从 projects.json 解析项目目录
    const workingDir = await resolveWorkingDirectory(task);
    await log(`Detected working directory: ${workingDir}`);

    // 构建讨论计划的提示词
    let planSection = '';
    if (existingPlan) {
      planSection = `
**现有计划**：
- 计划ID: ${existingPlan.plan_id}
- 状态: ${existingPlan.status}
- 分析: ${existingPlan.analysis}
- 步骤数: ${existingPlan.steps.length}

**现有步骤列表**：
${existingPlan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.action}`).join('\n')}

${existingPlan.execution_history && existingPlan.execution_history.length > 0 ? `
**执行历史**（最近5条）：
${existingPlan.execution_history.slice(-5).map(h => `- ${h.event}: ${h.details}`).join('\n')}
` : ''}
`;
    } else {
      planSection = `
**现有计划**：
- 尚未创建计划
`;
    }

    const prompt = `你是 task-agent 系统的 AI 计划顾问。

**当前任务**：
- ID: ${task.id}
- 标题: ${task.title}
- 描述: ${task.content || '（无详细描述）'}

${planSection}

\u26a0\ufe0f **重要：你现在处于讨论模式（Discussion Mode），只讨论和优化计划，不要执行任何操作！**

**你的职责**：
与用户讨论这个任务的执行计划，帮助用户：
1. 理解现有计划的优缺点
2. 根据用户反馈优化计划步骤
3. 记录讨论中确认的细节
4. 生成改进后的执行计划
5. 将最终计划保存到 ai-plans.json

**工作模式**：
- 这是一个对话式会话，你应该主动询问用户的想法
- \u274c 不要执行任何代码编写、文件修改等操作
- \u274c 不要设置 task.completedAt
- \u2705 只讨论如何执行，记录用户确认的细节
- \u2705 可以提出建议，但要等待用户确认
- \u2705 如果现有计划存在，先分析它的合理性

**讨论要点**：
- 任务目标是否清晰？
- 步骤划分是否合理？
- 是否有遗漏的环节？
- 每个步骤的优先级如何？
- 是否需要人工介入的环节？
- 用户对哪些细节有特殊要求？

**当用户确认计划后，执行以下操作**：

1. 生成最终计划的 JSON 数据结构（包含讨论细节）：

\`\`\`json
{
  "plan_id": "${planId}",
  "task_id": "${taskId}",
  "created_at": "ISO时间",
  "updated_at": "ISO时间",
  "status": "pending_approval",
  "analysis": "任务分析说明（根据讨论总结）",
  "discussion_notes": "讨论过程中的关键决定和用户确认的细节",
  "user_confirmations": [
    "用户确认的第一个细节",
    "用户确认的第二个细节"
  ],
  "clarifications": "对任务需求的澄清说明",
  "steps": [
    {
      "id": 1,
      "type": "auto",
      "action": "步骤描述",
      "description": "详细说明",
      "status": "pending"
    }
  ],
  "current_step": 0,
  "execution_history": [
    {
      "timestamp": "ISO时间",
      "event": "plan_discussed",
      "details": "通过讨论优化了执行计划"
    }
  ]
}
\`\`\`

2. 使用 Node.js 命令保存计划到 ai-plans.json：

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

const newPlan = /* 这里放你生成的计划 JSON */;

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

3. 更新 task 的 ai_execution 字段（如果需要）：

\`\`\`bash
cd "${taskAgentDir.replace(/\\/g, '/')}" && node -e "
const fs = require('fs');
const path = 'data/tasks.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const task = data.tasks.find(t => t.id === '${taskId}');
if (task && task.ai_execution) {
  task.ai_execution.status = 'pending_approval';
  task.ai_execution.plan_id = '${planId}';
  task.ai_execution.current_action = '计划已优化，等待用户审批';
  task.ai_execution.last_update = new Date().toISOString();
}
fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log('Task updated successfully');
"
\`\`\`

**重要说明**：
- \u274c 不要执行任何代码编写、文件修改等操作
- \u274c 不要设置 task.completedAt
- \u2705 始终使用对话式语气，不要自说自话
- \u2705 等待用户输入和确认
- \u2705 记录讨论中用户确认的所有细节（放入 discussion_notes 和 user_confirmations）
- \u2705 在保存计划之前，向用户展示完整的计划（包括讨论细节）并询问是否满意
- \u2705 保存计划后告知用户已完成，状态设置为 'pending_approval'

现在，请先向用户问好，并询问他们对${existingPlan ? '现有计划' : '这个任务'}的看法！`;

    // 将 prompt 写入临时文件
    const promptFile = path.join(DATA_DIR, 'prompts', `discuss-${planId}.txt`);
    await fs.mkdir(path.dirname(promptFile), { recursive: true });
    await fs.writeFile(promptFile, prompt, 'utf-8');
    await log(`Prompt written to: ${promptFile}`);

    // 创建启动命令
    const startCommand = `Read ${promptFile.replace(/\\/g, '/')} and start the discussion`;

    await log(`Start command: ${startCommand}`);

    // PowerShell 脚本内容
    const psFile = path.join(DATA_DIR, 'prompts', `discuss-${planId}.ps1`);
    const psContent = `# Task Agent AI Plan Discussor
# Set console encoding to UTF-8
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Task Agent AI Plan Discussor" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Task: ${task.title.replace(/"/g, '`"')}" -ForegroundColor Yellow
Write-Host "Plan ID: ${planId}" -ForegroundColor Yellow
Write-Host "Mode: \u8ba8\u8bba\u4f18\u5316\u8ba1\u5212" -ForegroundColor Magenta
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Copy command to clipboard
$command = "${startCommand}"
Set-Clipboard -Value $command

Write-Host "READY TO DISCUSS PLAN!" -ForegroundColor Green
Write-Host ""
Write-Host "Command copied to clipboard:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  $command" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press ANY KEY to start Claude Code..." -ForegroundColor White -BackgroundColor DarkGreen
Write-Host "Then press Ctrl+V and Enter to start the discussion" -ForegroundColor Gray
Write-Host ""

# Wait for user confirmation
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host ""
Write-Host "Starting Claude Code..." -ForegroundColor Green
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
    await log('Launching Claude Code for plan discussion...');

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

    await log('Claude Code launched for plan discussion');
    await log(`Working directory: ${workingDir}`);
    await log(`Plan ID: ${planId}`);

  } catch (error) {
    await log(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
