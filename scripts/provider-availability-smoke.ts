/**
 * 供应商可用性「真探测」：读取 provider-test.env（及同名环境变量），对每个已填 Key
 * 调用与设置页相同的 probeSupplierLive，向上游发真实请求。
 *
 * 本地：在项目根填写 provider-test.env（已 .gitignore）
 * CI：在仓库 Secrets 中配置同名变量（如 PP_PROVIDER_TEST_MINIMAX），workflow 注入环境
 *
 * 用法：
 *   bun run test:provider-smoke
 *   REQUIRE_PROVIDER_SMOKE=1 bun run test:provider-smoke   # 未配置任何 Key 时 exit 1（用于 CI）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeSupplierLive } from '@/lib/aggregate-models-live';
import type { ProviderId } from '@/types';

const PREFIX = 'PP_PROVIDER_TEST_';

/** Env 文件中的键 -> ProviderId 或 ollama 特例 */
function envKeyToProviderId(envKey: string): { pid: ProviderId; isOllamaUrl: boolean } | null {
  if (!envKey.startsWith(PREFIX)) return null;
  const rest = envKey.slice(PREFIX.length);
  if (rest === 'OLLAMA_BASE_URL') return { pid: 'ollama', isOllamaUrl: true };
  const id = rest.toLowerCase().replace(/_/g, '-') as ProviderId;
  const allowed = new Set<string>([
    'anthropic',
    'openai',
    'deepseek',
    'qwen',
    'zhipu',
    'minimax',
    'kimi',
    'moonshot',
    'siliconflow',
    'zenmux',
    'volcengine',
    'arkcoding',
    'openrouter',
    'ollama',
    'custom',
  ]);
  if (!allowed.has(id)) return null;
  return { pid: id as ProviderId, isOllamaUrl: false };
}

function loadEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(process.cwd(), 'provider-test.env');
  if (!existsSync(path)) return out;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const raw = line.trimEnd();
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k.startsWith(PREFIX) && v) out[k] = v;
  }
  return out;
}

function mergedTestVars(): Record<string, string> {
  const fromFile = loadEnvFile();
  const merged: Record<string, string> = { ...fromFile };
  for (const k of Object.keys(process.env)) {
    if (!k?.startsWith(PREFIX)) continue;
    const v = process.env[k];
    if (v !== undefined && String(v).trim() !== '') merged[k] = String(v).trim();
  }
  return merged;
}

async function main(): Promise<void> {
  /** 仅当显式设置时：未配置任何 PP_PROVIDER_TEST_* 则 exit 1（供本仓库 CI 使用） */
  const requireSmoke = process.env.REQUIRE_PROVIDER_SMOKE === '1';
  const vars = mergedTestVars();
  const tasks: Array<{ name: string; fn: () => Promise<{ ok: boolean; detail: string }> }> = [];

  for (const [key, value] of Object.entries(vars)) {
    const mapped = envKeyToProviderId(key);
    if (!mapped || !value.trim()) continue;
    const { pid, isOllamaUrl } = mapped;
    if (isOllamaUrl) {
      tasks.push({
        name: `${key} -> ollama`,
        fn: async () => {
          const r = await probeSupplierLive('ollama', null, { ollamaBaseUrl: value.trim() });
          const ok = r.row.status === 'ok';
          return {
            ok,
            detail: `${r.row.status}${r.row.reasonKey ? ` (${r.row.reasonKey})` : ''} models=${r.modelItems.length}`,
          };
        },
      });
      continue;
    }
    tasks.push({
      name: `${key} -> ${pid}`,
      fn: async () => {
        const r = await probeSupplierLive(pid, value.trim());
        const ok = r.row.status === 'ok';
        return {
          ok,
          detail: `${r.row.status}${r.row.reasonKey ? ` (${r.row.reasonKey})` : ''} models=${r.modelItems.length}`,
        };
      },
    });
  }

  if (tasks.length === 0) {
    const msg =
      `[provider-smoke] 未找到任何 ${PREFIX}* 变量（请配置 provider-test.env 或 CI Secrets）。` +
      (requireSmoke
        ? ' 本运行要求 REQUIRE_PROVIDER_SMOKE=1 / CI，已失败。'
        : ' 跳过（未配置时不失败）。');
    console.warn(msg);
    if (requireSmoke) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`[provider-smoke] 将执行 ${tasks.length} 个真实上游探测…`);
  let failed = false;
  for (const t of tasks) {
    try {
      const { ok, detail } = await t.fn();
      if (ok) {
        console.log(`  OK  ${t.name}: ${detail}`);
      } else {
        failed = true;
        console.error(`  FAIL ${t.name}: ${detail}`);
      }
    } catch (e) {
      failed = true;
      console.error(`  FAIL ${t.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log('[provider-smoke] 全部通过。');
  }
}

void main();
