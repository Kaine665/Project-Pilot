/**
 * Lightweight AI call utility for satellite tasks.
 *
 * Uses the existing session-health-guard's CLI-based approach
 * (claude -p with stream-json output) for a one-shot AI call.
 * This avoids the heavier SDK query() path and keeps satellite
 * calls cheap and fast.
 */

import { spawnClaude } from '@/lib/claude-cli';
import { getAppWorkingDir } from '@/lib/app-paths';
import { buildClaudeEnv } from '@/lib/settings-manager';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';

const LOG = '[LightweightAI]';
const DEFAULT_TIMEOUT_MS = 30_000;
// 卫星任务统一使用最便宜的模型，不跟随用户的主模型设置
const CHEAP_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Make a one-shot lightweight AI call via Claude CLI.
 * Always uses Haiku (cheapest model) regardless of user's main model setting.
 * Returns the raw text response, or null on failure/timeout.
 */
export async function callLightweightAI(
  prompt: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise(async (resolve) => {
    let env: NodeJS.ProcessEnv;

    try {
      env = await buildClaudeEnv();
    } catch (err) {
      console.warn(`${LOG} Failed to build env:`, err instanceof Error ? err.message : err);
      return resolve(null);
    }

    console.log(`${LOG} Spawning claude -p --model ${CHEAP_MODEL} (timeout: ${timeoutMs}ms)`);

    const claude = spawnClaude([
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', CHEAP_MODEL,
    ], {
      cwd: getAppWorkingDir(),
      shell: false,
      env,
    });

    const lineBuffer = new LineBuffer();
    const streamParser = new StreamParser();
    let fullText = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        claude.kill('SIGTERM');
        resolve(null);
      }
    }, timeoutMs);

    claude.stdout?.on('data', (chunk: Buffer) => {
      for (const line of lineBuffer.feed(chunk.toString('utf-8'))) {
        for (const event of streamParser.parse(line)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }
    });

    claude.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;

      // Flush remaining
      const remaining = lineBuffer.flush();
      if (remaining) {
        for (const event of streamParser.parse(remaining)) {
          if (event.type === 'text_delta') {
            fullText += event.text;
          }
        }
      }

      const text = fullText.trim() || null;
      if (code === 0 && text) {
        console.log(`${LOG} Success (${text.length} chars)`);
      } else {
        console.warn(`${LOG} CLI exited code=${code}, text=${text ? text.length + ' chars' : 'empty'}`);
      }
      resolve(code === 0 ? text : null);
    });

    claude.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        console.error(`${LOG} Spawn error:`, err.message);
        resolve(null);
      }
    });

    claude.stdin?.write(prompt);
    claude.stdin?.end();
  });
}
