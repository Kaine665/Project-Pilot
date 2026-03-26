import { randomBytes } from 'crypto';
import {
  getEventTriggerRunsPath,
  getEventTriggersPath,
  getEventTriggerStatesPath,
  modifyJsonFile,
  readJsonFile,
  readProjectIndex,
} from './file-store';
import { agentChatManager, generateSessionId } from '@/lib/agent-chat-manager';
import { buildFlowContext } from '@/lib/todo-dispatch';
import type {
  EventTrigger,
  EventTriggerAction,
  EventTriggerPullSnapshot,
  EventTriggerRunRecord,
  EventTriggerRunsData,
  EventTriggerStateEntry,
  EventTriggerStatesData,
  EventTriggersData,
} from '@/types/event-trigger';
import type { ProjectEntry } from '@/types';

const DEFAULT_TRIGGERS: EventTriggersData = { triggers: [] };
const DEFAULT_STATES: EventTriggerStatesData = { states: {} };
const DEFAULT_RUNS: EventTriggerRunsData = { runs: [] };
const MAX_RUNS_PER_TRIGGER = 50;
const MAX_TOTAL_RUNS = 500;
const MIN_POLL_INTERVAL_SEC = 30;
const MAX_POLL_INTERVAL_SEC = 3600;

interface GitHubPullRequestApiItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  user?: { login?: string | null } | null;
  base?: { ref?: string | null } | null;
  head?: { ref?: string | null; sha?: string | null } | null;
  labels?: Array<{ name?: string | null }> | null;
}

interface TriggerMatchEvent {
  dedupeKey: string;
  summary: string;
  pull: EventTriggerPullSnapshot;
}

function generateTriggerId(): string {
  return `evt-${Date.now()}-${randomBytes(2).toString('hex')}`;
}

function generateRunId(): string {
  return `evrun-${Date.now()}-${randomBytes(2).toString('hex')}`;
}

function normalizeOptional(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizePull(item: GitHubPullRequestApiItem): EventTriggerPullSnapshot | null {
  const title = normalizeOptional(item.title);
  const url = normalizeOptional(item.html_url);
  const baseBranch = normalizeOptional(item.base?.ref ?? undefined);
  const headBranch = normalizeOptional(item.head?.ref ?? undefined);
  const headSha = normalizeOptional(item.head?.sha ?? undefined);
  const updatedAt = normalizeOptional(item.updated_at);
  if (!title || !url || !baseBranch || !headBranch || !headSha || !updatedAt) {
    return null;
  }

  return {
    id: item.id,
    number: item.number,
    title,
    url,
    author: normalizeOptional(item.user?.login ?? undefined),
    baseBranch,
    headBranch,
    headSha,
    updatedAt,
    labels: Array.isArray(item.labels)
      ? item.labels.map((label) => normalizeOptional(label.name ?? undefined)).filter(Boolean) as string[]
      : [],
  };
}

function filterPulls(trigger: EventTrigger, pulls: EventTriggerPullSnapshot[]): EventTriggerPullSnapshot[] {
  const filters = trigger.filters ?? {};
  return pulls.filter((pull) => {
    if (filters.baseBranch && pull.baseBranch !== filters.baseBranch) return false;
    if (filters.headBranch && pull.headBranch !== filters.headBranch) return false;
    if (filters.author && pull.author !== filters.author) return false;
    if (filters.label && !pull.labels.includes(filters.label)) return false;
    return true;
  });
}

function buildActionPrompt(trigger: EventTrigger, pull: EventTriggerPullSnapshot): string {
  const lines = [
    'A GitHub event matched an event trigger.',
    `Trigger: ${trigger.name}`,
    `Event: ${trigger.event}`,
    `Repository: ${trigger.sourceConfig.owner}/${trigger.sourceConfig.repo}`,
    `Pull Request: #${pull.number} ${pull.title}`,
    `URL: ${pull.url}`,
    `Author: ${pull.author ?? 'unknown'}`,
    `Base Branch: ${pull.baseBranch}`,
    `Head Branch: ${pull.headBranch}`,
    `Head SHA: ${pull.headSha}`,
    `Updated At: ${pull.updatedAt}`,
  ];

  if (pull.labels.length > 0) {
    lines.push(`Labels: ${pull.labels.join(', ')}`);
  }

  const extraPrompt = normalizeOptional(trigger.action.prompt);
  if (extraPrompt) {
    lines.push('', 'Operator Instructions:', extraPrompt);
  }

  return lines.join('\n');
}

function buildRunSummary(trigger: EventTrigger, pull: EventTriggerPullSnapshot): string {
  return `${trigger.sourceConfig.owner}/${trigger.sourceConfig.repo}#${pull.number} ${trigger.event}`;
}

async function readProject(projectKey?: string): Promise<ProjectEntry | null> {
  if (!projectKey) return null;
  const index = await readProjectIndex();
  return index.projects.find((project) => project.key === projectKey) ?? null;
}

function resolveTokenEnvVar(trigger: EventTrigger, project: ProjectEntry | null): string | undefined {
  return normalizeOptional(trigger.sourceConfig.tokenEnvVar)
    ?? normalizeOptional(project?.access?.tokenEnvVar);
}

function validateAction(action: EventTriggerAction): EventTriggerAction {
  if (action.type !== 'start_agent') {
    throw new Error(`Unsupported action type: ${action.type}`);
  }
  return {
    type: 'start_agent',
    agentId: requireNonEmpty(action.agentId, 'action.agentId'),
    prompt: normalizeOptional(action.prompt),
  };
}

function validateTrigger(input: Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>): Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'> {
  if (input.source !== 'github_polling') {
    throw new Error(`Unsupported source: ${input.source}`);
  }
  if (input.event !== 'pull_request.opened' && input.event !== 'pull_request.synchronized') {
    throw new Error(`Unsupported event: ${input.event}`);
  }

  const pollIntervalSec = Number(input.sourceConfig.pollIntervalSec);
  if (!Number.isFinite(pollIntervalSec) || pollIntervalSec < MIN_POLL_INTERVAL_SEC || pollIntervalSec > MAX_POLL_INTERVAL_SEC) {
    throw new Error(`pollIntervalSec must be between ${MIN_POLL_INTERVAL_SEC} and ${MAX_POLL_INTERVAL_SEC}`);
  }

  return {
    name: requireNonEmpty(input.name, 'name'),
    enabled: input.enabled !== false,
    projectKey: normalizeOptional(input.projectKey),
    source: 'github_polling',
    event: input.event,
    sourceConfig: {
      owner: requireNonEmpty(input.sourceConfig.owner, 'sourceConfig.owner'),
      repo: requireNonEmpty(input.sourceConfig.repo, 'sourceConfig.repo'),
      pollIntervalSec,
      tokenEnvVar: normalizeOptional(input.sourceConfig.tokenEnvVar),
    },
    filters: {
      baseBranch: normalizeOptional(input.filters?.baseBranch),
      headBranch: normalizeOptional(input.filters?.headBranch),
      author: normalizeOptional(input.filters?.author),
      label: normalizeOptional(input.filters?.label),
    },
    action: validateAction(input.action),
  };
}

class EventTriggerManager {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const data = await readJsonFile<EventTriggersData>(getEventTriggersPath(), DEFAULT_TRIGGERS);
    for (const trigger of data.triggers) {
      this.arm(trigger);
    }
  }

  private arm(trigger: EventTrigger): void {
    this.disarm(trigger.id);
    if (!trigger.enabled) return;

    const intervalMs = trigger.sourceConfig.pollIntervalSec * 1000;
    const timer = setInterval(() => {
      void this.pollTrigger(trigger.id);
    }, intervalMs);
    this.timers.set(trigger.id, timer);

    void this.pollTrigger(trigger.id);
  }

  private disarm(triggerId: string): void {
    const timer = this.timers.get(triggerId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(triggerId);
    }
  }

  async listTriggers(): Promise<EventTrigger[]> {
    const data = await readJsonFile<EventTriggersData>(getEventTriggersPath(), DEFAULT_TRIGGERS);
    return data.triggers;
  }

  async createTrigger(input: Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>): Promise<EventTrigger> {
    const normalized = validateTrigger(input);
    const now = new Date().toISOString();
    const trigger: EventTrigger = {
      id: generateTriggerId(),
      createdAt: now,
      updatedAt: now,
      ...normalized,
    };

    await modifyJsonFile<EventTriggersData>(getEventTriggersPath(), DEFAULT_TRIGGERS, (data) => {
      data.triggers.push(trigger);
      return data;
    });

    this.arm(trigger);
    return trigger;
  }

  async updateTrigger(
    triggerId: string,
    patch: Partial<Omit<EventTrigger, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<EventTrigger | null> {
    const data = await readJsonFile<EventTriggersData>(getEventTriggersPath(), DEFAULT_TRIGGERS);
    const current = data.triggers.find((trigger) => trigger.id === triggerId);
    if (!current) return null;

    const normalized = validateTrigger({
      ...current,
      ...patch,
      sourceConfig: {
        ...current.sourceConfig,
        ...(patch.sourceConfig ?? {}),
      },
      filters: {
        ...current.filters,
        ...(patch.filters ?? {}),
      },
      action: {
        ...current.action,
        ...(patch.action ?? {}),
      } as EventTriggerAction,
    });

    const updated: EventTrigger = {
      ...current,
      ...normalized,
      updatedAt: new Date().toISOString(),
    };

    await modifyJsonFile<EventTriggersData>(getEventTriggersPath(), DEFAULT_TRIGGERS, (next) => {
      const index = next.triggers.findIndex((trigger) => trigger.id === triggerId);
      if (index !== -1) {
        next.triggers[index] = updated;
      }
      return next;
    });

    this.arm(updated);
    return updated;
  }

  async deleteTrigger(triggerId: string): Promise<boolean> {
    let deleted = false;
    await modifyJsonFile<EventTriggersData>(getEventTriggersPath(), DEFAULT_TRIGGERS, (data) => {
      const before = data.triggers.length;
      data.triggers = data.triggers.filter((trigger) => trigger.id !== triggerId);
      deleted = data.triggers.length < before;
      return data;
    });

    if (!deleted) return false;

    this.disarm(triggerId);
    await modifyJsonFile<EventTriggerStatesData>(getEventTriggerStatesPath(), DEFAULT_STATES, (data) => {
      delete data.states[triggerId];
      return data;
    });
    return true;
  }

  async listRuns(triggerId: string, limit = 20): Promise<EventTriggerRunRecord[]> {
    const data = await readJsonFile<EventTriggerRunsData>(getEventTriggerRunsPath(), DEFAULT_RUNS);
    return data.runs.filter((run) => run.triggerId === triggerId).slice(-limit).reverse();
  }

  async pollNow(triggerId: string): Promise<EventTriggerRunRecord[]> {
    return this.pollTrigger(triggerId, true);
  }

  private async pollTrigger(triggerId: string, manual = false): Promise<EventTriggerRunRecord[]> {
    if (this.inFlight.has(triggerId)) {
      return [];
    }
    this.inFlight.add(triggerId);

    try {
      const triggers = await this.listTriggers();
      const trigger = triggers.find((item) => item.id === triggerId);
      if (!trigger) {
        throw new Error('Event trigger not found');
      }
      if (!manual && !trigger.enabled) {
        return [];
      }

      const project = await readProject(trigger.projectKey);
      const tokenEnvVar = resolveTokenEnvVar(trigger, project);
      const token = tokenEnvVar ? normalizeOptional(process.env[tokenEnvVar]) : undefined;
      const pulls = await this.fetchPullRequests(trigger, token);
      const filteredPulls = filterPulls(trigger, pulls);

      const states = await readJsonFile<EventTriggerStatesData>(getEventTriggerStatesPath(), DEFAULT_STATES);
      const currentState = states.states[trigger.id] ?? { pulls: [] };
      const now = new Date().toISOString();
      const matches = this.detectMatches(trigger, currentState, filteredPulls);

      await modifyJsonFile<EventTriggerStatesData>(getEventTriggerStatesPath(), DEFAULT_STATES, (data) => {
        data.states[trigger.id] = {
          initializedAt: currentState.initializedAt ?? now,
          lastPolledAt: now,
          pulls: filteredPulls,
        };
        return data;
      });

      if (!currentState.initializedAt) {
        return [];
      }

      const runs: EventTriggerRunRecord[] = [];
      for (const match of matches) {
        const run = await this.fireTrigger(trigger, match);
        runs.push(run);
      }
      return runs;
    } finally {
      this.inFlight.delete(triggerId);
    }
  }

  private detectMatches(
    trigger: EventTrigger,
    state: EventTriggerStateEntry,
    currentPulls: EventTriggerPullSnapshot[],
  ): TriggerMatchEvent[] {
    const previous = new Map(state.pulls.map((pull) => [String(pull.id), pull]));
    const matches: TriggerMatchEvent[] = [];

    for (const pull of currentPulls) {
      const old = previous.get(String(pull.id));
      if (!old && trigger.event === 'pull_request.opened') {
        matches.push({
          dedupeKey: `${trigger.id}:${trigger.event}:${pull.id}:${pull.headSha}`,
          summary: buildRunSummary(trigger, pull),
          pull,
        });
        continue;
      }

      if (old && old.headSha !== pull.headSha && trigger.event === 'pull_request.synchronized') {
        matches.push({
          dedupeKey: `${trigger.id}:${trigger.event}:${pull.id}:${pull.headSha}`,
          summary: buildRunSummary(trigger, pull),
          pull,
        });
      }
    }

    return matches;
  }

  private async fetchPullRequests(trigger: EventTrigger, token?: string): Promise<EventTriggerPullSnapshot[]> {
    const url = new URL(`https://api.github.com/repos/${trigger.sourceConfig.owner}/${trigger.sourceConfig.repo}/pulls`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', '50');
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('direction', 'desc');

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ProjectPilot-EventTrigger',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub polling failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json() as GitHubPullRequestApiItem[];
    return data.map(normalizePull).filter(Boolean) as EventTriggerPullSnapshot[];
  }

  private async fireTrigger(trigger: EventTrigger, match: TriggerMatchEvent): Promise<EventTriggerRunRecord> {
    const run: EventTriggerRunRecord = {
      id: generateRunId(),
      triggerId: trigger.id,
      source: trigger.source,
      event: trigger.event,
      dedupeKey: match.dedupeKey,
      startedAt: new Date().toISOString(),
      status: 'matched',
      summary: match.summary,
      projectKey: trigger.projectKey,
      prNumber: match.pull.number,
      prTitle: match.pull.title,
      prUrl: match.pull.url,
    };

    try {
      const sessionId = generateSessionId();
      const flowContext = await buildFlowContext(trigger.projectKey);
      const initialTitle = `[Event] ${trigger.name}`;
      const message = buildActionPrompt(trigger, match.pull);

      if (trigger.action.type !== 'start_agent') {
        throw new Error(`Unsupported action type: ${trigger.action.type}`);
      }

      await agentChatManager.start(
        sessionId,
        trigger.action.agentId,
        message,
        flowContext,
        undefined,
        initialTitle,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'event',
        trigger.id,
      );

      run.sessionId = sessionId;
    } catch (error) {
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
    }

    await modifyJsonFile<EventTriggerRunsData>(getEventTriggerRunsPath(), DEFAULT_RUNS, (data) => {
      data.runs.push(run);
      const perTrigger = data.runs.filter((item) => item.triggerId === trigger.id);
      if (perTrigger.length > MAX_RUNS_PER_TRIGGER) {
        const overflow = perTrigger.length - MAX_RUNS_PER_TRIGGER;
        let removed = 0;
        data.runs = data.runs.filter((item) => {
          if (item.triggerId !== trigger.id) return true;
          if (removed < overflow) {
            removed += 1;
            return false;
          }
          return true;
        });
      }
      if (data.runs.length > MAX_TOTAL_RUNS) {
        data.runs = data.runs.slice(-MAX_TOTAL_RUNS);
      }
      return data;
    });

    return run;
  }
}

const globalKey = '__projectPilotEventTriggerManager__';
export const eventTriggerManager: EventTriggerManager =
  (globalThis as Record<string, unknown>)[globalKey] as EventTriggerManager
  ?? new EventTriggerManager();

(globalThis as Record<string, unknown>)[globalKey] = eventTriggerManager;
