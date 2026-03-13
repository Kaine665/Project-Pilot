/**
 * Lightweight AI call utility for satellite tasks.
 *
 * Uses Claude Agent SDK query() with all tools disabled — pure text in/out.
 * Shared by satellite tasks that need AI judgment (e.g. health-guard).
 *
 * Note: title-generation uses its own provider chain + CLI fallback,
 * so it doesn't go through this module.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getAppWorkingDir } from '@/lib/app-paths';
import { buildSdkQueryOptions } from '@/lib/settings-manager';
import { SdkEventAdapter } from '@/lib/sdk-event-adapter';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Make a one-shot AI call with all tools disabled.
 * Returns the full text response, or throws on timeout/error.
 */
export async function callLightweightAI(
  prompt: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const abortController = new AbortController();

  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    const sdkOpts = await buildSdkQueryOptions({
      capabilities: {
        bash: false,
        fileAccess: false,
        web: false,
        subAgent: false,
        skipReview: false,
        todoRead: false,
        exposePromptPath: false,
        dataStore: false,
      },
      cwd: getAppWorkingDir(),
    });

    const adapter = new SdkEventAdapter();
    let fullText = '';

    const sdkQuery = query({
      prompt,
      options: { ...sdkOpts, abortController },
    });

    for await (const msg of sdkQuery) {
      for (const event of adapter.adapt(msg)) {
        if (event.type === 'text_delta') {
          fullText += event.text;
        }
      }
    }

    return fullText.trim();
  } finally {
    clearTimeout(timeoutHandle);
  }
}
