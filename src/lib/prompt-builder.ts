import fs from 'fs/promises';
import type { Task, ChatMessage, ProjectConfig, SessionPhase, ContextIndexData } from '@/types';
import { isLegacyFlowContext } from '@/types/flow-context';
import { getContextIndexPath, getContextFilePath, readJsonFile } from '@/lib/file-store';

export interface PromptContext {
  task: Task;
  project: ProjectConfig | null;
  history: ChatMessage[];
  newMessage: string;
  /** 实际检测到的默认分支名（由 ProcessManager 传入） */
  detectedBaseBranch?: string;
}

/**
 * Build the full prompt for claude -p, including task context,
 * conversation history, and the latest user message.
 *
 * Implements the 5-phase AI task workflow:
 * Phase 1: 确定任务四要素
 * Phase 2: 识别缺口 → 推断或提问 → 确认理解
 * Phase 3: 制定计划（AI 判断是否需要用户审核）
 * Phase 4: 执行（先创建 git 分支）
 * Phase 5: 总结与合并
 */
export function buildPrompt(ctx: PromptContext): Promise<string>;
export function buildPrompt(
  task: Task,
  project: ProjectConfig | null,
  history: ChatMessage[],
  newMessage: string,
): Promise<string>;
export async function buildPrompt(
  taskOrCtx: Task | PromptContext,
  project?: ProjectConfig | null,
  history?: ChatMessage[],
  newMessage?: string,
): Promise<string> {
  // Normalize to PromptContext
  const ctx: PromptContext = 'task' in taskOrCtx && 'newMessage' in taskOrCtx
    ? taskOrCtx as PromptContext
    : {
        task: taskOrCtx as Task,
        project: project ?? null,
        history: history ?? [],
        newMessage: newMessage ?? '',
      };

  const sections: string[] = [];

  // ── Section 1: System identity + workflow instructions ──
  sections.push(buildSystemInstructions());

  // ── Section 2: Task four elements (四要素) ──
  sections.push(await buildTaskContext(ctx));

  // ── Section 2.5: Phase reminder (阶段提醒) ──
  sections.push(buildPhaseReminder(ctx.task.phase));

  // ── Section 3: Git branch status ──
  {
    const baseBranch = ctx.project?.defaultBranch || ctx.detectedBaseBranch;
    if (ctx.task.gitBranch) {
      sections.push(`**Git 分支状态**：
当前任务分支：\`${ctx.task.gitBranch}\`${baseBranch ? `（基于 \`${baseBranch}\` 创建）` : ''}
所有代码改动应在此分支上进行。`);
    } else if (baseBranch) {
      sections.push(`**Git 分支状态**：
默认分支：\`${baseBranch}\`
系统将在执行阶段自动创建任务分支。`);
    }
  }

  // ── Section 4: Plan format instructions ──
  sections.push(buildPlanFormatInstructions());

  // ── Section 5: Conversation history ──
  if (ctx.history.length > 0) {
    sections.push(buildHistorySection(ctx.history));
  }

  // ── Section 6: Latest message ──
  sections.push(`**用户最新消息**：
${ctx.newMessage}

请回复用户的最新消息。`);

  return sections.join('\n\n---\n\n');
}

function buildSystemInstructions(): string {
  return `你是 ProjectPilot 的 AI 助手，正在通过对话帮助用户完成编程任务。

**你的工作流程**（严格按顺序执行）：

**Phase 1 - 确定任务四要素**：
拿到任务后，必须从四个角度理解任务：
1. **哪个项目** — 决定了工作范围和环境
2. **具体做什么** — 任务的动作是什么（分析数据？改代码？写文档？）
3. **为什么做** — 上层目标，决定了方向
4. **交付物是什么** — 产出的形式（一份报告？代码变更？口头汇报？）

这些信息已在下方"当前任务"中提供。检查哪些已明确、哪些不清楚。
如果下方有"链路上下文"，利用它来推导四要素：
- 项目 → projectKey + projectName
- 做什么 → taskContent（短语，需要你展开细节）
- 为什么 → flowName + nodeName + nodeDescription 拼成目标链
- 交付物 → 根据 taskContent + 项目类型 + 信号词推断

同环节的已完成任务说明哪些功能已存在；前置环节说明用户旅程中之前发生了什么；跨领域约束影响实现方案。

不在这个阶段做的事：读代码、查文件、分析技术栈。这些是后续阶段按需获取的。

**Phase 2 - 识别缺口 → 推断或提问**：
基于四要素，判断哪些还不清楚。处理缺口的方式（优先级从高到低）：
1. **推断后审查**：如果能合理推断，给出推断结论让用户确认
2. **带选项提问**：如果有多种合理可能，给出 2-3 个具体选项

不做的事：
- 不问泛泛的开放式问题（"你想让我做什么？"）
- 不问能自己查到的东西
- 不一次问 5 个问题，只问关键缺口

**不管四要素是否都清楚，都必须向用户复述确认你的理解**：
> "我理解这个任务是：在 XXX 项目中，做 YYY，目的是 ZZZ，产出 AAA。对吗？"
用户确认后，用 \`\`\`json:understanding 格式输出你的理解，系统会自动提取并推进到下一阶段。

**Phase 3 - 制定计划**：
制定执行计划。是否需要用户审核取决于你的判断：
- 自己能办好、风险不大 → 直接开始执行，不需等用户审核
- 有风险、不确定、涉及破坏性操作 → 展示计划，等用户确认后再执行
不管是否审核，计划都要用 \`\`\`json:plan 格式输出，系统会自动保存。

**Phase 4 - 执行**：
- 系统已自动创建 git 分支，你无需创建分支。所有代码改动在当前分支上进行。
- 按计划逐步执行，每步先简要说明要做什么
- 遇到意外情况暂停，向用户报告

**Phase 5 - 总结**：
执行完成后报告完成情况，列出改动的文件和结果。
用户会决定是否将分支合并到目标分支。

**对话规则**：
1. 用中文回复
2. 每次回复后等待用户输入，不要自说自话连续执行多个步骤
3. 如果需要执行操作（修改文件、运行命令），先告知用户你打算做什么

**严禁**：
- 不要修改 ProjectPilot 自身的数据文件（data/ 目录下的 tasks.json、conversations/、task-artifacts/ 等）
- 不要调用 ProjectPilot 的 API（/api/tasks、/api/ai-chat 等）
- 不要修改任务状态、不要标记任务完成——这些由系统和用户控制，不是你的职责
- 你的工作范围仅限于用户任务所指定的目标项目，不要操作 ProjectPilot 本身`;
}

async function buildTaskContext(ctx: PromptContext): Promise<string> {
  const lines: string[] = [];
  const fc = ctx.task.flowContext;

  lines.push('**当前任务（四要素）**：');
  lines.push('');

  // Element 1: Which project
  if (ctx.project) {
    lines.push(`**1. 哪个项目**：${ctx.project.name}`);
    if (ctx.project.description) {
      lines.push(`   项目描述：${ctx.project.description}`);
    }
    lines.push(`   项目类型：${ctx.project.type}`);
    lines.push(`   工作目录：${ctx.project.path}`);
    if (ctx.project.defaultBranch) {
      lines.push(`   合并目标分支：${ctx.project.defaultBranch}`);
    }
  } else if (fc) {
    lines.push(`**1. 哪个项目**：${fc.projectName}（key: ${fc.projectKey}）`);
  } else if (ctx.task.projectKey) {
    lines.push(`**1. 哪个项目**：${ctx.task.projectKey}（未找到项目配置）`);
  } else {
    lines.push(`**1. 哪个项目**：(未指定，需要推断或询问用户)`);
  }

  // Element 2: What to do
  lines.push('');
  lines.push(`**2. 具体做什么**：`);
  lines.push(`   任务标题：${ctx.task.title}`);
  if (fc) {
    lines.push(`   链路任务内容：${fc.taskContent}`);
    if (fc.taskDescription) {
      lines.push(`   任务补充描述：${fc.taskDescription}`);
    }
  }
  lines.push(`   任务描述：${ctx.task.content || '(无详细描述，需要推断或询问用户)'}`);

  // Element 3: Why — try to derive from flowContext
  lines.push('');
  lines.push(`**3. 为什么做（上层目标）**：`);
  if (fc) {
    if (isLegacyFlowContext(fc)) {
      // 旧格式 flowContext（已有 Session）
      lines.push(`   所属流程：${fc.flowName}（${fc.flowDescription}）`);
      lines.push(`   所属环节：${fc.nodeName}（${fc.nodeDescription}）`);
    } else {
      // 新格式 flowContext
      lines.push(`   所属板块：${fc.sectionName}${fc.sectionDescription ? `（${fc.sectionDescription}）` : ''}`);
      if (fc.ancestors?.length > 0) {
        lines.push(`   上层路径：${fc.ancestors.map(a => a.content).join(' → ')}`);
      }
    }
  } else {
    lines.push(`   (需要根据任务描述和上下文推断，或询问用户)`);
  }

  // Element 4: Deliverable
  lines.push('');
  lines.push(`**4. 交付物是什么**：`);
  lines.push(`   (需要根据任务描述和上下文推断，或询问用户)`);

  // FlowContext extra: sibling tasks, predecessors, cross-cutting
  if (fc) {
    lines.push('');
    lines.push('**链路上下文（自动采集）**：');

    if (isLegacyFlowContext(fc)) {
      // 旧格式
      if (fc.siblingTasks?.length > 0) {
        lines.push('  同环节任务：');
        for (const s of fc.siblingTasks) {
          lines.push(`    - ${s.content}（${s.status}）`);
        }
      }
      if (fc.predecessorNodes?.length > 0) {
        lines.push('  前置环节：');
        for (const p of fc.predecessorNodes) {
          lines.push(`    - ${p.name}（${p.status}）`);
        }
      }
      if (fc.crossCutting?.length > 0) {
        lines.push('  跨领域约束：');
        for (const c of fc.crossCutting) {
          lines.push(`    - ${c.name}（${c.status}）`);
        }
      }
    } else {
      // 新格式
      if (fc.siblings?.length > 0) {
        lines.push('  同级任务：');
        for (const s of fc.siblings) {
          lines.push(`    - ${s.content}（${s.status}）`);
        }
      }
      if (fc.otherSections?.length > 0) {
        lines.push('  其他板块：');
        for (const s of fc.otherSections) {
          lines.push(`    - ${s.name}${s.description ? `（${s.description}）` : ''}`);
        }
      }
    }

    if (fc.cycleDeadline) {
      lines.push(`  周期截止：${fc.cycleDeadline}`);
    }

    if (!isLegacyFlowContext(fc) && fc.customContext?.length) {
      lines.push('');
      lines.push('**用户附加上下文**：');
      for (const ci of fc.customContext) {
        lines.push(`  - **${ci.label}**：${ci.content}`);
      }
    }

    // ── 全局上下文直接注入 ──
    // 与 buildContextSection()（agent-chat-manager.ts）的区别：
    //   buildContextSection() = 索引表，列出所有条目，AI 自行 cat 按需读取
    //   这里 = 用户在任务级别明确选中的条目，内容直接内联到 prompt
    // 两者共存：选中的条目内容在这里注入，未选中的仍在索引表里供 AI 按需读取
    if (!isLegacyFlowContext(fc) && fc.globalContextIds?.length) {
      const contextIndex = await readJsonFile<ContextIndexData>(getContextIndexPath(), { entries: [] });
      const loadedEntries: { label: string; description: string; content: string; sourcePath?: string }[] = [];
      for (const gid of fc.globalContextIds) {
        const entry = contextIndex.entries.find(e => e.id === gid);
        if (!entry) continue;
        try {
          const filePath = getContextFilePath(entry.fileName);
          const content = await fs.readFile(filePath, 'utf-8');
          if (content) loadedEntries.push({ label: entry.label, description: entry.description, content, sourcePath: entry.sourcePath });
        } catch {
          // file missing — skip silently
        }
      }
      if (loadedEntries.length > 0) {
        lines.push('');
        lines.push('**用户指定上下文（全局）**：');
        for (const e of loadedEntries) {
          lines.push('');
          const heading = e.sourcePath
            ? `### ${e.label}（${e.description}）\n> 原始文件路径：\`${e.sourcePath}\``
            : `### ${e.label}（${e.description}）`;
          lines.push(heading);
          lines.push(e.content);
        }
      }
    }
  }

  // Extra metadata
  lines.push('');
  lines.push(`任务 ID：${ctx.task.id}`);
  lines.push(`任务状态：${ctx.task.status}`);

  return lines.join('\n');
}

/**
 * Build a minimal prompt for Phase 0 (branching).
 * One-shot: reads task title + content, outputs a branch name slug.
 */
export function buildBranchingPrompt(title: string, content?: string): string {
  return `你是一个 Git 分支命名助手。根据以下任务信息，生成一个简短的英文 kebab-case 分支名 slug。

任务标题：${title}
${content ? `任务描述：${content}` : ''}

要求：
- 输出一个简短的英文 kebab-case slug（如 "fix-login-redirect"、"add-dark-mode"、"refactor-auth-module"）
- 最多 5 个单词，用连字符连接
- 只包含小写字母、数字和连字符
- 准确描述任务核心内容
- 如果任务是中文，翻译为英文后生成 slug

用以下格式输出：

\`\`\`json:branch
{
  "slug": "your-branch-slug"
}
\`\`\``;
}

function buildPhaseReminder(phase: SessionPhase | undefined): string {
  const effective = phase ?? 'understanding';

  switch (effective) {
    case 'branching':
      return `**当前阶段：Phase 0（分支创建）**
系统正在自动创建 git 分支，请稍候。`;

    case 'understanding':
      return `**⚠ 当前阶段：Phase 1-2（理解任务）**
你正在理解阶段。请：
1. 检查四要素哪些已明确、哪些需要推断或提问
2. 向用户复述确认你的理解
3. 用户确认后，用 \`\`\`json:understanding 格式输出四要素

**重要：本阶段你没有工具权限，无法读取代码或文件。这是设计如此——先理解任务，后续阶段再看代码。**`;

    case 'planning':
      return `**当前阶段：Phase 3（制定计划）**
用户已确认理解。现在制定执行计划。
你有完整的工具权限，可以阅读代码、查看文件结构来制定更准确的计划。
计划用 \`\`\`json:plan 格式输出。`;

    case 'executing':
      return `**当前阶段：Phase 4（执行）**
按计划执行。Git 分支已由系统自动创建，你无需创建分支。你有完整的工具权限。
按计划逐步执行，每步先简要说明要做什么。`;

    case 'summarizing':
      return `**当前阶段：Phase 5（总结）**
执行已完成。总结结果，列出改动的文件和结果。
用 \`\`\`json:result 格式输出执行结果。`;
  }
}

function buildPlanFormatInstructions(): string {
  return `**输出格式说明**：

**理解确认**（Phase 1-2 完成时输出）：
\`\`\`json:understanding
{
  "project": "项目名",
  "action": "具体要做的事",
  "goal": "上层目标/为什么做",
  "deliverable": "交付物描述",
  "branchSlug": "fix-login-button"
}
\`\`\`
branchSlug 规则：简短的英文 kebab-case，描述任务内容，如 "add-dark-mode"、"fix-auth-redirect"。

**执行计划**（Phase 3 输出）：
\`\`\`json:plan
{
  "analysis": "任务分析...",
  "steps": [
    { "id": 1, "type": "auto", "action": "步骤名", "description": "详细说明", "status": "pending", "risk_level": "low" }
  ],
  "expected_results": "预期结果...",
  "risks": "风险评估..."
}
\`\`\`

**重要：JSON 格式规则**
- 字符串值中的双引号必须转义：使用 \\" 而不是 "
- 示例错误：\`"description": "显示"添加图片"按钮"\` ❌
- 示例正确：\`"description": "显示\\"添加图片\\"按钮"\` ✅
- 或使用中文引号：\`"description": "显示「添加图片」按钮"\` ✅

**执行结果**（Phase 5 输出）：
\`\`\`json:result
{
  "status": "completed",
  "summary": "完成情况概述",
  "files_changed": [
    { "path": "文件路径", "action": "created|modified|deleted" }
  ]
}
\`\`\`

注意：使用 \`\`\`json:xxx 标记（冒号后的标识符），系统会自动提取对应产物。`;
}

function buildHistorySection(history: ChatMessage[]): string {
  const historyLines = history.map((msg) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    // Truncate very long messages to avoid token explosion
    const raw = msg.content ?? '';
    const content = raw.length > 4000
      ? raw.slice(0, 4000) + '\n...(truncated)'
      : raw;
    return `${role}: ${content}`;
  });
  return `**对话历史**：
${historyLines.join('\n\n')}`;
}
