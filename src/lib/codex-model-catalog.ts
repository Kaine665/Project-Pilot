import { spawnCodex } from '@/lib/codex-cli';
import { getProviderPreset } from '@/lib/provider-registry';
import type { OpenAIReasoningEffort } from '@/types';

const LIST_LIMIT = 100;
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

const SUPPORTED_EFFORTS: OpenAIReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const OPENAI_FALLBACK_MODELS: OpenAIModelSummary[] = getProviderPreset('openai').models.map((model, index) => ({
  id: model.id,
  model: model.id,
  displayName: model.label || model.id,
  isDefault: index === 0,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [...SUPPORTED_EFFORTS],
}));

type RpcId = number;

interface RpcRequest {
  id: RpcId;
  method: string;
  params: Record<string, unknown>;
}

interface RpcResult {
  id?: RpcId;
  result?: unknown;
  error?: { message?: string };
}

interface ModelListPage {
  data?: unknown[];
  nextCursor?: string | null;
}

export interface OpenAIModelSummary {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: OpenAIReasoningEffort;
  supportedReasoningEfforts: OpenAIReasoningEffort[];
}

export interface OpenAIModelCatalogResponse {
  models: OpenAIModelSummary[];
  fetchedAt: string;
  source: 'live' | 'cache';
}

interface OpenAIModelCacheState {
  models: OpenAIModelSummary[];
  fetchedAtMs: number;
}

let cacheState: OpenAIModelCacheState | null = null;
let inflightFetch: Promise<OpenAIModelSummary[]> | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toEffort(value: unknown): OpenAIReasoningEffort | null {
  return typeof value === 'string' && SUPPORTED_EFFORTS.includes(value as OpenAIReasoningEffort)
    ? (value as OpenAIReasoningEffort)
    : null;
}

function dedupeEfforts(values: unknown[]): OpenAIReasoningEffort[] {
  const seen = new Set<OpenAIReasoningEffort>();
  for (const raw of values) {
    const effort = toEffort(raw);
    if (effort) seen.add(effort);
  }
  return Array.from(seen);
}

function normalizeModel(raw: unknown): OpenAIModelSummary | null {
  if (!isObject(raw)) return null;

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;

  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : id;
  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim()
    ? raw.displayName.trim()
    : id;
  const isDefault = raw.isDefault === true;

  const rawSupported = Array.isArray(raw.supportedReasoningEfforts)
    ? raw.supportedReasoningEfforts
        .map((item) => (isObject(item) ? item.reasoningEffort : null))
        .filter((item): item is unknown => item !== null)
    : [];

  let supportedReasoningEfforts = dedupeEfforts(rawSupported);
  if (supportedReasoningEfforts.length === 0) {
    supportedReasoningEfforts = [...SUPPORTED_EFFORTS];
  }

  const defaultReasoningEffortRaw = toEffort(raw.defaultReasoningEffort);
  const defaultReasoningEffort = defaultReasoningEffortRaw && supportedReasoningEfforts.includes(defaultReasoningEffortRaw)
    ? defaultReasoningEffortRaw
    : (supportedReasoningEfforts.includes('medium') ? 'medium' : supportedReasoningEfforts[0]);

  return {
    id,
    model,
    displayName,
    isDefault,
    defaultReasoningEffort,
    supportedReasoningEfforts,
  };
}

function normalizeModelPage(page: ModelListPage): OpenAIModelSummary[] {
  const rows = Array.isArray(page.data) ? page.data : [];
  return rows
    .map(normalizeModel)
    .filter((model): model is OpenAIModelSummary => !!model);
}

function mergeWithFallbackModels(models: OpenAIModelSummary[]): OpenAIModelSummary[] {
  const merged = new Map<string, OpenAIModelSummary>();

  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    merged.set(id, { ...model, id, model: model.model?.trim() || id });
  }

  for (const fallback of OPENAI_FALLBACK_MODELS) {
    if (!merged.has(fallback.id)) {
      merged.set(fallback.id, fallback);
    }
  }

  return Array.from(merged.values());
}

async function fetchLiveOpenAIModels(): Promise<OpenAIModelSummary[]> {
  const child = spawnCodex(['app-server', '--listen', 'stdio://'], {
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    env: { ...process.env },
  });

  const pending = new Map<RpcId, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }>();
  let nextRequestId = 1;
  let stdoutBuf = '';
  let stderrBuf = '';
  let closed = false;

  const rejectAll = (reason: Error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
  };

  const cleanup = () => {
    if (!closed) {
      closed = true;
      child.stdin!.end();
      child.kill('SIGTERM');
    }
  };

  const request = (method: string, params: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
    if (closed) {
      reject(new Error('Codex app-server already closed'));
      return;
    }

    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex app-server request timeout: ${method}`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    const payload: RpcRequest = { id, method, params };
    child.stdin!.write(`${JSON.stringify(payload)}\n`);
  });

  child.stdout!.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8');
    let newlineIndex = stdoutBuf.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutBuf.slice(0, newlineIndex).trim();
      stdoutBuf = stdoutBuf.slice(newlineIndex + 1);
      newlineIndex = stdoutBuf.indexOf('\n');
      if (!line) continue;

      let parsed: RpcResult;
      try {
        parsed = JSON.parse(line) as RpcResult;
      } catch {
        continue;
      }

      if (typeof parsed.id !== 'number') continue;
      const record = pending.get(parsed.id);
      if (!record) continue;

      clearTimeout(record.timer);
      pending.delete(parsed.id);

      if (parsed.error) {
        record.reject(new Error(parsed.error.message || 'Codex app-server request failed'));
        continue;
      }
      record.resolve(parsed.result);
    }
  });

  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8');
  });

  const exitPromise = new Promise<void>((resolve) => {
    child.on('close', () => {
      closed = true;
      if (pending.size > 0) {
        rejectAll(new Error(`Codex app-server exited before responding${stderrBuf ? `: ${stderrBuf.trim()}` : ''}`));
      }
      resolve();
    });
    child.on('error', (err) => {
      closed = true;
      rejectAll(new Error(`Failed to start codex app-server: ${err.message}`));
      resolve();
    });
  });

  try {
    await request('initialize', {
      clientInfo: {
        name: 'project-pilot',
        version: '1.0.0',
      },
    });

    const allModels: OpenAIModelSummary[] = [];
    let cursor: string | null = null;

    do {
      const result = await request('model/list', {
        includeHidden: false,
        limit: LIST_LIMIT,
        cursor,
      });
      const page = (isObject(result) ? result : {}) as ModelListPage;
      allModels.push(...normalizeModelPage(page));
      cursor = typeof page.nextCursor === 'string' && page.nextCursor.trim() ? page.nextCursor : null;
    } while (cursor);

    return mergeWithFallbackModels(allModels);
  } finally {
    cleanup();
    await exitPromise;
  }
}

function nowMs(): number {
  return Date.now();
}

function isCacheFresh(state: OpenAIModelCacheState | null): state is OpenAIModelCacheState {
  return !!state && (nowMs() - state.fetchedAtMs) < CACHE_TTL_MS;
}

export async function listOpenAIModels(options: { forceRefresh?: boolean } = {}): Promise<OpenAIModelCatalogResponse> {
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && isCacheFresh(cacheState)) {
    return {
      models: cacheState.models,
      fetchedAt: new Date(cacheState.fetchedAtMs).toISOString(),
      source: 'cache',
    };
  }

  if (!forceRefresh && inflightFetch) {
    const models = await inflightFetch;
    return {
      models,
      fetchedAt: new Date(cacheState?.fetchedAtMs || nowMs()).toISOString(),
      source: 'cache',
    };
  }

  inflightFetch = fetchLiveOpenAIModels()
    .then((models) => {
      cacheState = {
        models,
        fetchedAtMs: nowMs(),
      };
      return models;
    })
    .finally(() => {
      inflightFetch = null;
    });

  const models = await inflightFetch;
  return {
    models,
    fetchedAt: new Date(cacheState?.fetchedAtMs || nowMs()).toISOString(),
    source: 'live',
  };
}

export function clearOpenAIModelCatalogCache(): void {
  cacheState = null;
}

export function resolveOpenAIEffortForModel(
  model: OpenAIModelSummary | null,
  desired: OpenAIReasoningEffort,
): { effort: OpenAIReasoningEffort; fallbacked: boolean } {
  const supported = model?.supportedReasoningEfforts || SUPPORTED_EFFORTS;
  if (supported.includes(desired)) {
    return { effort: desired, fallbacked: false };
  }
  if (supported.includes('high')) {
    return { effort: 'high', fallbacked: true };
  }
  const defaultEffort = model?.defaultReasoningEffort;
  if (defaultEffort && supported.includes(defaultEffort)) {
    return { effort: defaultEffort, fallbacked: true };
  }
  return { effort: supported[0] || 'high', fallbacked: true };
}
