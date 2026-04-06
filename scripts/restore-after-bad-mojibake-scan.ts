/**
 * 一次性：从仓库内置模板恢复被 scripts/repair-pp-data-mojibake.ts 误伤的提示词；
 * 清理文档中的 NUL；自定义 Agent 若无备份曾写入占位（逻辑审查师可从会话 jsonl 恢复，勿重复跑覆盖）。
 *
 *   bun scripts/restore-after-bad-mojibake-scan.ts [DATA_DIR]
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { readBuiltinPrompt } from '../src/lib/builtin-defaults';
import { repairTextIfNeeded } from '../src/lib/text-repair';

const P7IZ_PLACEHOLDER_THRESHOLD_BYTES = 2500;

const DAMAGED_DOCS = [
  'doc-1772600003-pp03.md',
  'doc-1772674608733-kviq.md',
  'doc-1773823774521-agdl.md',
  'doc-ctx-ctx-1773730442227-qsbe.md',
];

async function main(): Promise<void> {
  const root = path.resolve(
    process.argv[2] ?? process.env.PROJECT_PILOT_DATA_DIR ?? path.join(os.homedir(), '.project-pilot'),
  );

  const agentsDir = path.join(root, 'prompts/agents');
  const historySelfDev = path.join(root, 'prompts/history/agent-builtin-self-dev/v_260320_191616.md');
  const contentDir = path.join(root, 'documents/content');

  const selfDev = await readBuiltinPrompt('agent-builtin-self-dev');
  if (selfDev) {
    await fs.mkdir(path.dirname(historySelfDev), { recursive: true });
    await fs.writeFile(historySelfDev, selfDev, 'utf-8');
    console.log('[restored] prompts/history/agent-builtin-self-dev/v_260320_191616.md');
  }

  const p7 = path.join(agentsDir, 'agent-1773817929408-p7iz.md');
  try {
    const st = await fs.stat(p7);
    if (st.size >= P7IZ_PLACEHOLDER_THRESHOLD_BYTES) {
      console.log('[skip] prompts/agents/agent-1773817929408-p7iz.md 已有完整内容');
    } else {
      console.warn(
        '[warn] agent-1773817929408-p7iz.md 过短；请从 sessions/messages/agent-chat-1773817853158-ndmh.jsonl 的 Write 工具参数恢复，勿用本脚本覆盖。',
      );
    }
  } catch {
    console.warn('[warn] agent-1773817929408-p7iz.md 不存在，请用会话 jsonl 或 Agents 界面重建');
  }

  for (const name of DAMAGED_DOCS) {
    const p = path.join(contentDir, name);
    try {
      const buf = await fs.readFile(p);
      let s = buf.toString('utf8').replace(/\0/g, '');
      s = repairTextIfNeeded(s) ?? s;
      await fs.writeFile(p, s, 'utf-8');
      console.log(`[sanitized] documents/content/${name}`);
    } catch {
      console.warn(`[missing] documents/content/${name}`);
    }
  }

  console.log('完成。文档已清理；逻辑审查师提示词若缺失请从会话 jsonl 提取。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
