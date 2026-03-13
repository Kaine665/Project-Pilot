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
import { buildClaudeEnv, buildClaudeModelArgs } from '@/lib/settings-manager';
import { StreamParser, LineBuffer } from '@/lib/claude-stream-parser';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Make a one-shot lightweight AI call via Claude CLI.
 * Returns the raw text response, or null on failure/timeout.
 */
export async function callLightweightAI(
  prompt: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise(async (resolve) => {
    let env: NodeJS.ProcessEnv;
    let modelArgs: string[];

    try {
      env = await buildClaudeEnv();
      modelArgs = await buildClaudeModelArgs();
    } catch {
      return resolve(null);
    }

    const claude = spawnClaude([
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      ...modelArgs,
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

      resolve(code === 0 ? fullText.trim() || null : null);
    });

    claude.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    claude.stdin?.write(prompt);
    claude.stdin?.end();
  });
}
