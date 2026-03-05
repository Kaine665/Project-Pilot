/**
 * call-agent CLI — Invoke another ProjectPilot Agent via REST API.
 *
 * Designed to be called from within an Agent's Bash tool to delegate
 * sub-tasks to other system-defined Agents.
 *
 * Usage:
 *   npx tsx src/lib/call-agent.ts --agent-id <ID> --message "指令" [options]
 *
 * Options:
 *   --agent-id         Required. Target agent ID
 *   --message          Required. The message/task to send
 *   --project          Optional. Project key for flow context
 *   --parent-session   Optional. Parent session ID for traceability
 *   --port             Optional. Server port (default: 4000 or PROJECT_PILOT_PORT)
 *   --timeout          Optional. Timeout in seconds (default: 300)
 *   --depth            Optional. Current call depth for recursion guard (default: 0, max: 3)
 *
 * Stdout: Sub-agent's accumulated text response (clean, no SSE framing)
 * Stderr: Diagnostic messages (session lifecycle, errors)
 * Exit code: 0 on success, 1 on error
 */

import http from 'http';

// ── Constants ──

const MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_S = 300;
const DEFAULT_PORT = 4000;
const POST_TIMEOUT_MS = 15_000;

// ── Types ──

interface CallAgentOptions {
  agentId: string;
  message: string;
  projectKey?: string;
  parentSessionId?: string;
  port: number;
  timeoutSeconds: number;
  depth: number;
}

// ── Core logic ──

async function callAgent(opts: CallAgentOptions): Promise<string> {
  const { agentId, message, projectKey, parentSessionId, port, timeoutSeconds, depth } = opts;

  // Recursion guard
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Sub-agent call depth ${depth} exceeds maximum ${MAX_DEPTH}. ` +
      `This prevents infinite recursion (A calls B calls A...). ` +
      `Consider restructuring the task to avoid deep nesting.`
    );
  }

  // Step 1: POST /api/agent-chat to start the session
  const body = JSON.stringify({
    agentId,
    message,
    projectKey: projectKey || undefined,
    parentSessionId: parentSessionId || undefined,
  });

  const postResult = await httpRequest({
    method: 'POST',
    hostname: '127.0.0.1',
    port,
    path: '/api/agent-chat',
    headers: { 'Content-Type': 'application/json' },
    body,
    timeoutMs: POST_TIMEOUT_MS,
  });

  if (postResult.statusCode !== 200) {
    throw new Error(`POST /api/agent-chat failed: HTTP ${postResult.statusCode} — ${postResult.body}`);
  }

  let sessionId: string;
  try {
    const parsed = JSON.parse(postResult.body);
    sessionId = parsed.sessionId;
  } catch {
    throw new Error(`Invalid JSON response from POST /api/agent-chat: ${postResult.body}`);
  }

  if (!sessionId) {
    throw new Error('No sessionId returned from POST /api/agent-chat');
  }

  process.stderr.write(`[call-agent] Session started: ${sessionId} (depth=${depth})\n`);

  // Step 2: GET /api/agent-chat/stream — consume SSE until done
  const fullText = await consumeSSEStream({
    hostname: '127.0.0.1',
    port,
    path: `/api/agent-chat/stream?sessionId=${encodeURIComponent(sessionId)}&since=0`,
    timeoutMs: timeoutSeconds * 1000,
  });

  process.stderr.write(`[call-agent] Session completed. Response length: ${fullText.length} chars\n`);
  return fullText;
}

// ── HTTP helpers ──

interface HttpResult {
  statusCode: number;
  body: string;
}

function httpRequest(opts: {
  method: string;
  hostname: string;
  port: number;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
      },
    );

    req.setTimeout(opts.timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function consumeSSEStream(opts: {
  hostname: string;
  port: number;
  path: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullText = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        req.destroy();
        reject(new Error(`SSE stream timed out after ${opts.timeoutMs / 1000}s`));
      }
    }, opts.timeoutMs);

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        fn();
      }
    };

    const req = http.get(
      {
        hostname: opts.hostname,
        port: opts.port,
        path: opts.path,
        headers: { Accept: 'text/event-stream' },
      },
      (res) => {
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Parse SSE frames: "data: {...}\n\n"
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            for (const line of frame.split('\n')) {
              if (!line.startsWith('data: ')) continue;

              const jsonStr = line.slice(6);
              try {
                const event = JSON.parse(jsonStr);

                if (event.type === 'text_delta' && typeof event.text === 'string') {
                  fullText += event.text;
                } else if (event.type === 'done') {
                  settle(() => {
                    req.destroy();
                    resolve(fullText);
                  });
                  return;
                } else if (event.type === 'error') {
                  process.stderr.write(`[call-agent] Error event: ${event.message ?? JSON.stringify(event)}\n`);
                }
              } catch {
                // Ignore non-JSON lines (e.g. SSE comments)
              }
            }
          }
        });

        res.on('end', () => {
          settle(() => resolve(fullText));
        });

        res.on('error', (err) => {
          settle(() => reject(err));
        });
      },
    );

    req.on('error', (err) => {
      settle(() => reject(err));
    });
  });
}

// ── CLI entry ──

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const agentId = opts['agent-id'];
  const message = opts['message'];

  if (!agentId || !message) {
    process.stderr.write(
      'Usage: npx tsx src/lib/call-agent.ts --agent-id <ID> --message "指令" ' +
      '[--project KEY] [--parent-session SID] [--port 4000] [--timeout 300] [--depth 0]\n',
    );
    process.exit(1);
  }

  const port = parseInt(opts['port'] || process.env.PROJECT_PILOT_PORT || String(DEFAULT_PORT), 10);
  const timeoutSeconds = parseInt(opts['timeout'] || String(DEFAULT_TIMEOUT_S), 10);
  const depth = parseInt(opts['depth'] || '0', 10);

  try {
    const result = await callAgent({
      agentId,
      message,
      projectKey: opts['project'],
      parentSessionId: opts['parent-session'],
      port,
      timeoutSeconds,
      depth,
    });

    // Output ONLY the response text to stdout (no framing, no metadata)
    process.stdout.write(result);
  } catch (err) {
    process.stderr.write(`[call-agent] FAILED: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

// Run when invoked directly
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('call-agent');
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`[call-agent] ${err.message}\n`);
    process.exit(1);
  });
}
