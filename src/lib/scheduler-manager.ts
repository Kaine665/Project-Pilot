import * as cron from 'node-cron';
import { randomBytes } from 'crypto';
import {
  getScheduleRunsPath,
  getSchedulesPath,
  modifyJsonFile,
  readJsonFile,
} from './file-store';
import { dispatchTodoToAgent, readTodoById } from './todo-dispatch';
import type {
  AgentSchedule,
  AgentSchedulesData,
  ScheduleRunRecord,
  ScheduleRunsData,
  ScheduleTargetType,
} from '@/types';

const MAX_RUNS_PER_SCHEDULE = 50;
const MAX_TOTAL_RUNS = 500;

type ScheduleTrigger = 'cron' | 'manual';

function generateScheduleId(): string {
  return `sched-${Date.now()}-${randomBytes(2).toString('hex')}`;
}

function generateRunId(): string {
  return `run-${Date.now()}-${randomBytes(2).toString('hex')}`;
}

function calcNextRunAt(_cronExpr: string): string | undefined {
  return undefined;
}

function normalizeTargetType(targetType?: string): ScheduleTargetType {
  if (!targetType || targetType === 'message') return 'agent_message';
  if (targetType === 'agent_message' || targetType === 'todo') return targetType;
  throw new Error(`Unsupported schedule targetType: ${targetType}`);
}

function buildInitialTitle(schedule: AgentSchedule, trigger: ScheduleTrigger): string | undefined {
  const prefix = trigger === 'manual' ? '[Manual]' : '[Schedule]';
  if (schedule.label?.trim()) return `${prefix} ${schedule.label.trim()}`;
  if (schedule.targetType === 'todo') return `${prefix} Todo ${schedule.todoId ?? ''}`.trim();
  return schedule.agentId ? `${prefix} ${schedule.agentId}` : undefined;
}

async function hydrateTodoSnapshot(schedule: AgentSchedule): Promise<AgentSchedule> {
  if (!schedule.todoId) return schedule;
  const todo = await readTodoById(schedule.todoId);
  if (!todo) {
    throw new Error(`Todo ${schedule.todoId} does not exist`);
  }
  return {
    ...schedule,
    agentId: todo.agentId ?? schedule.agentId,
    projectKey: schedule.projectKey ?? todo.projectKey,
    label: schedule.label ?? todo.title,
  };
}

async function validateScheduleInput(schedule: AgentSchedule): Promise<AgentSchedule> {
  const targetType = normalizeTargetType(schedule.targetType);
  const normalized: AgentSchedule = {
    ...schedule,
    targetType,
  };

  if (!cron.validate(normalized.cron)) {
    throw new Error(`Invalid cron expression: ${normalized.cron}`);
  }

  if (targetType === 'agent_message') {
    if (!normalized.agentId?.trim()) {
      throw new Error('agentId is required for agent_message schedules');
    }
    if (!normalized.message?.trim()) {
      throw new Error('message is required for agent_message schedules');
    }
    return {
      ...normalized,
      agentId: normalized.agentId.trim(),
      message: normalized.message.trim(),
    };
  }

  if (!normalized.todoId?.trim()) {
    throw new Error('todoId is required for todo schedules');
  }

  return hydrateTodoSnapshot({
    ...normalized,
    todoId: normalized.todoId.trim(),
    message: undefined,
  });
}

export class SchedulerManager {
  private jobs = new Map<string, cron.ScheduledTask>();

  async init(): Promise<void> {
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    for (const schedule of data.schedules) {
      const normalized = { ...schedule, targetType: normalizeTargetType(schedule.targetType) };
      if (normalized.enabled) {
        this.register(normalized);
      }
    }
  }

  destroy(): void {
    for (const task of this.jobs.values()) {
      task.stop();
    }
    this.jobs.clear();
  }

  upsert(schedule: AgentSchedule): void {
    this.unregister(schedule.id);
    if (schedule.enabled) {
      this.register(schedule);
    }
  }

  remove(scheduleId: string): void {
    this.unregister(scheduleId);
  }

  private register(schedule: AgentSchedule): void {
    if (!cron.validate(schedule.cron)) {
      console.warn(`[SchedulerManager] skip invalid cron ${schedule.cron} (${schedule.id})`);
      return;
    }

    const task = cron.schedule(schedule.cron, () => {
      void this.fire(schedule.id, 'cron');
    });

    this.jobs.set(schedule.id, task);
  }

  private unregister(scheduleId: string): void {
    const task = this.jobs.get(scheduleId);
    if (!task) return;
    task.stop();
    this.jobs.delete(scheduleId);
  }

  private async fire(scheduleId: string, trigger: ScheduleTrigger): Promise<ScheduleRunRecord> {
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    const stored = data.schedules.find((item) => item.id === scheduleId);
    if (!stored) {
      throw new Error(`Schedule ${scheduleId} does not exist`);
    }

    const schedule = await validateScheduleInput(stored);
    if (trigger === 'cron' && !schedule.enabled) {
      throw new Error(`Schedule ${scheduleId} is disabled`);
    }

    const runRecord: ScheduleRunRecord = {
      id: generateRunId(),
      scheduleId,
      sessionId: '',
      trigger,
      sourceType: 'schedule',
      sourceId: scheduleId,
      todoId: schedule.todoId,
      startedAt: new Date().toISOString(),
      status: 'started',
    };

    try {
      if (schedule.targetType === 'todo') {
        const result = await dispatchTodoToAgent(schedule.todoId!, {
          projectKeyOverride: schedule.projectKey,
          initialTitle: buildInitialTitle(schedule, trigger),
          sourceType: 'schedule',
          sourceId: schedule.id,
        });
        runRecord.sessionId = result.sessionId;
      } else {
        const { agentChatManager, generateSessionId } = await import('./chat-managers/agent-chat-manager');
        const sessionId = generateSessionId();
        runRecord.sessionId = sessionId;
        await agentChatManager.start(
          sessionId,
          schedule.agentId!,
          schedule.message!,
          await this.buildFlowContext(schedule.projectKey),
          undefined,
          buildInitialTitle(schedule, trigger),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'schedule',
          schedule.id,
          schedule.todoId,
        );
      }

      await modifyJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] }, (current) => {
        const index = current.schedules.findIndex((item) => item.id === scheduleId);
        if (index >= 0) {
          current.schedules[index] = {
            ...current.schedules[index],
            targetType: schedule.targetType,
            agentId: schedule.agentId,
            projectKey: schedule.projectKey,
            label: schedule.label,
            lastRunAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return current;
      });
    } catch (error) {
      runRecord.status = 'failed';
      runRecord.error = error instanceof Error ? error.message : String(error);
    }

    await this.saveRunRecord(runRecord);

    if (runRecord.status === 'failed') {
      throw new Error(runRecord.error ?? 'Failed to trigger schedule');
    }

    return runRecord;
  }

  private async buildFlowContext(projectKey?: string) {
    if (!projectKey) return undefined;
    const { ensureDataDirV2Migrated, getFlowDataPath, getFlowIndexPath, readJsonFile: readJson } = await import('./file-store');
    await ensureDataDirV2Migrated();

    let projectName = projectKey;
    try {
      const index = await readJson<{ projects: Array<{ key: string; name: string }> }>(getFlowIndexPath(), { projects: [] });
      const found = index.projects.find((project) => project.key === projectKey);
      if (found) projectName = found.name;
    } catch {
      // Ignore index errors.
    }

    return {
      projectKey,
      projectName,
      flowDataPath: getFlowDataPath(projectKey),
    };
  }

  async triggerNow(scheduleId: string): Promise<ScheduleRunRecord> {
    return this.fire(scheduleId, 'manual');
  }

  private async saveRunRecord(record: ScheduleRunRecord): Promise<void> {
    await modifyJsonFile<ScheduleRunsData>(getScheduleRunsPath(), { runs: [] }, (data) => {
      data.runs.push(record);

      const grouped = new Map<string, ScheduleRunRecord[]>();
      for (const run of data.runs) {
        const group = grouped.get(run.scheduleId) ?? [];
        group.push(run);
        grouped.set(run.scheduleId, group);
      }

      const trimmed: ScheduleRunRecord[] = [];
      for (const group of grouped.values()) {
        group.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        trimmed.push(...group.slice(0, MAX_RUNS_PER_SCHEDULE));
      }

      trimmed.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      data.runs = trimmed.slice(0, MAX_TOTAL_RUNS);
      return data;
    });
  }

  async listRuns(scheduleId: string, limit = 20): Promise<ScheduleRunRecord[]> {
    const data = await readJsonFile<ScheduleRunsData>(getScheduleRunsPath(), { runs: [] });
    return data.runs
      .filter((run) => run.scheduleId === scheduleId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  async listAllRuns(limit = 50): Promise<ScheduleRunRecord[]> {
    const data = await readJsonFile<ScheduleRunsData>(getScheduleRunsPath(), { runs: [] });
    return data.runs
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  async listSchedules(): Promise<AgentSchedule[]> {
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    return data.schedules.map((schedule) => ({
      ...schedule,
      targetType: normalizeTargetType(schedule.targetType),
    }));
  }

  async createSchedule(input: {
    targetType?: ScheduleTargetType | 'message';
    agentId?: string;
    todoId?: string;
    cron: string;
    message?: string;
    projectKey?: string;
    label?: string;
    enabled?: boolean;
  }): Promise<AgentSchedule> {
    const now = new Date().toISOString();
    const candidate: AgentSchedule = {
      id: generateScheduleId(),
      targetType: normalizeTargetType(input.targetType),
      agentId: input.agentId,
      todoId: input.todoId,
      cron: input.cron,
      message: input.message,
      projectKey: input.projectKey,
      enabled: input.enabled ?? true,
      label: input.label,
      nextRunAt: calcNextRunAt(input.cron),
      createdAt: now,
      updatedAt: now,
    };

    const schedule = await validateScheduleInput(candidate);

    await modifyJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] }, (data) => {
      data.schedules.push(schedule);
      return data;
    });

    this.upsert(schedule);
    return schedule;
  }

  async updateSchedule(
    scheduleId: string,
    patch: Partial<Omit<Pick<AgentSchedule, 'targetType' | 'agentId' | 'todoId' | 'cron' | 'message' | 'label' | 'enabled' | 'projectKey'>, 'targetType'>> & { targetType?: ScheduleTargetType | 'message' },
  ): Promise<AgentSchedule | null> {
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    const current = data.schedules.find((schedule) => schedule.id === scheduleId);
    if (!current) return null;

    const validated = await validateScheduleInput({
      ...current,
      ...patch,
      targetType: patch.targetType !== undefined
        ? normalizeTargetType(patch.targetType)
        : current.targetType,
      updatedAt: new Date().toISOString(),
    });

    await modifyJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] }, (data) => {
      const index = data.schedules.findIndex((schedule) => schedule.id === scheduleId);
      if (index >= 0) {
        data.schedules[index] = validated!;
      }
      return data;
    });

    this.upsert(validated);
    return validated;
  }

  async deleteSchedule(scheduleId: string): Promise<boolean> {
    let deleted = false;

    await modifyJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] }, (data) => {
      const before = data.schedules.length;
      data.schedules = data.schedules.filter((schedule) => schedule.id !== scheduleId);
      deleted = data.schedules.length < before;
      return data;
    });

    if (deleted) {
      this.remove(scheduleId);
    }
    return deleted;
  }
}

const globalForSched = globalThis as unknown as {
  __schedulerManager?: SchedulerManager;
};

export const schedulerManager = globalForSched.__schedulerManager ?? new SchedulerManager();

if (process.env.NODE_ENV !== 'production') {
  globalForSched.__schedulerManager = schedulerManager;
}
