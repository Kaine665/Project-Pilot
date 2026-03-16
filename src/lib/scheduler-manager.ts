/**
 * SchedulerManager — Agent 定时运行调度器。
 *
 * 进程级单例，使用 node-cron 管理所有 AgentSchedule。
 * 挂在 globalThis 上，在 dev 模式下存活 HMR。
 *
 * 工作流：
 *   1. init() 读取 agent-schedules.json，为每条 enabled 的规则注册 cron job
 *   2. 到点时调用 agentChatManager.start() 创建新会话（不等待结果）
 *   3. 新增/更新/删除规则时，重新注册对应的 cron job
 */

import * as cron from 'node-cron';
import { randomBytes } from 'crypto';
import { getSchedulesPath, getScheduleRunsPath, readJsonFile, modifyJsonFile } from './file-store';
import type { AgentSchedule, AgentSchedulesData, ScheduleRunRecord, ScheduleRunsData } from '@/types';

// ── Constants ──

/** 执行历史最多保留条数（每条调度规则） */
const MAX_RUNS_PER_SCHEDULE = 50;
/** 执行历史总量上限 */
const MAX_TOTAL_RUNS = 500;

// ── Helpers ──

function generateScheduleId(): string {
  const ts = Date.now();
  const rand = randomBytes(2).toString('hex');
  return `sched-${ts}-${rand}`;
}

function generateRunId(): string {
  const ts = Date.now();
  const rand = randomBytes(2).toString('hex');
  return `run-${ts}-${rand}`;
}

/** 计算 cron 表达式的下次执行时间（node-cron 无 nextDate API，暂返回 undefined） */
function calcNextRunAt(_cronExpr: string): string | undefined {
  return undefined;
}

// ── SchedulerManager ──

export class SchedulerManager {
  private jobs = new Map<string, cron.ScheduledTask>();

  /** 初始化：从磁盘加载所有调度规则并注册 cron job */
  async init(): Promise<void> {
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    for (const schedule of data.schedules) {
      if (schedule.enabled) {
        this._register(schedule);
      }
    }
    console.log(`[SchedulerManager] 初始化完成，共 ${this.jobs.size} 个活跃调度`);
  }

  /** 停止所有 cron job（供测试/清理使用） */
  destroy(): void {
    for (const [, task] of this.jobs) {
      task.stop();
    }
    this.jobs.clear();
  }

  /**
   * 注册或更新一条调度规则。
   * 如果已存在同 ID 的 job，先停止旧的再注册新的。
   */
  upsert(schedule: AgentSchedule): void {
    this._unregister(schedule.id);
    if (schedule.enabled) {
      this._register(schedule);
    }
  }

  /** 停止并移除一条调度规则 */
  remove(scheduleId: string): void {
    this._unregister(scheduleId);
  }

  private _register(schedule: AgentSchedule): void {
    if (!cron.validate(schedule.cron)) {
      console.warn(`[SchedulerManager] 无效的 cron 表达式：${schedule.cron}（id=${schedule.id}）`);
      return;
    }

    const task = cron.schedule(schedule.cron, () => {
      void this._fire(schedule.id, 'cron');
    });

    this.jobs.set(schedule.id, task);
  }

  private _unregister(scheduleId: string): void {
    const existing = this.jobs.get(scheduleId);
    if (existing) {
      existing.stop();
      this.jobs.delete(scheduleId);
    }
  }

  /** 构建 flowContext（如果绑定了项目） */
  private async _buildFlowContext(
    projectKey: string | undefined,
  ): Promise<import('./chat-managers/agent-chat-manager').FlowContext | undefined> {
    if (!projectKey) return undefined;

    const { getFlowDataPath, getFlowIndexPath, ensureDataDirV2Migrated } = await import('./file-store');
    await ensureDataDirV2Migrated();
    const flowDataPath = getFlowDataPath(projectKey);
    let projectName = projectKey;
    try {
      const { readJsonFile: rjf } = await import('./file-store');
      const idx = await rjf<{ projects: Array<{ key: string; name: string }> }>(
        getFlowIndexPath(), { projects: [] }
      );
      const found = idx.projects.find(p => p.key === projectKey);
      if (found) projectName = found.name;
    } catch { /* ignore */ }

    return { projectKey, projectName, flowDataPath };
  }

  /**
   * 触发一条调度规则（cron 定时触发或手动触发共用）。
   */
  private async _fire(scheduleId: string, trigger: 'cron' | 'manual'): Promise<ScheduleRunRecord> {
    // 重新读取最新配置（防止 cron job 创建后规则已被修改或禁用）
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    const schedule = data.schedules.find(s => s.id === scheduleId);

    if (!schedule) {
      throw new Error(`调度规则 ${scheduleId} 不存在`);
    }

    // cron 触发时检查 enabled，手动触发不检查
    if (trigger === 'cron' && !schedule.enabled) {
      console.log(`[SchedulerManager] 调度 ${scheduleId} 已禁用，跳过本次触发`);
      throw new Error(`调度规则 ${scheduleId} 已禁用`);
    }

    console.log(`[SchedulerManager] ${trigger === 'manual' ? '手动' : '定时'}触发调度 ${scheduleId}（${schedule.label ?? schedule.agentId}）`);

    const runRecord: ScheduleRunRecord = {
      id: generateRunId(),
      scheduleId,
      sessionId: '',
      trigger,
      startedAt: new Date().toISOString(),
      status: 'started',
    };

    try {
      // 动态导入，避免循环依赖
      const { agentChatManager, generateSessionId } = await import('./chat-managers/agent-chat-manager');

      const flowContext = await this._buildFlowContext(schedule.projectKey);

      const sessionId = generateSessionId();
      runRecord.sessionId = sessionId;

      const titlePrefix = trigger === 'manual' ? '[手动]' : '[定时]';
      await agentChatManager.start(
        sessionId,
        schedule.agentId,
        schedule.message,
        flowContext,
        undefined, // images
        `${titlePrefix} ${schedule.label ?? schedule.agentId}`, // initialTitle
      );

      runRecord.status = 'started'; // 会话已启动（不等待完成）

      // 更新 lastRunAt
      await modifyJsonFile<AgentSchedulesData>(
        getSchedulesPath(),
        { schedules: [] },
        (d) => {
          const idx = d.schedules.findIndex(s => s.id === scheduleId);
          if (idx !== -1) {
            d.schedules[idx].lastRunAt = new Date().toISOString();
            d.schedules[idx].updatedAt = new Date().toISOString();
          }
          return d;
        },
      );
    } catch (err) {
      runRecord.status = 'failed';
      runRecord.error = (err as Error).message;
      console.error(`[SchedulerManager] 触发调度 ${scheduleId} 失败：`, err);
    }

    // 记录执行历史
    await this._saveRunRecord(runRecord);

    if (runRecord.status === 'failed') {
      throw new Error(runRecord.error ?? '触发失败');
    }

    return runRecord;
  }

  /** 手动触发一次调度规则（不检查 enabled 状态） */
  async triggerNow(scheduleId: string): Promise<ScheduleRunRecord> {
    return this._fire(scheduleId, 'manual');
  }

  // ── 执行历史 ──

  /** 保存一条执行记录，自动清理旧记录 */
  private async _saveRunRecord(record: ScheduleRunRecord): Promise<void> {
    await modifyJsonFile<ScheduleRunsData>(
      getScheduleRunsPath(),
      { runs: [] },
      (d) => {
        d.runs.push(record);

        // 按 scheduleId 分组清理，每组最多保留 MAX_RUNS_PER_SCHEDULE 条
        const grouped = new Map<string, ScheduleRunRecord[]>();
        for (const r of d.runs) {
          const group = grouped.get(r.scheduleId) ?? [];
          group.push(r);
          grouped.set(r.scheduleId, group);
        }
        const trimmed: ScheduleRunRecord[] = [];
        for (const [, group] of grouped) {
          // 按 startedAt 降序，保留最新的
          group.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
          trimmed.push(...group.slice(0, MAX_RUNS_PER_SCHEDULE));
        }
        // 全局上限
        trimmed.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        d.runs = trimmed.slice(0, MAX_TOTAL_RUNS);

        return d;
      },
    );
  }

  /** 查询某条调度规则的执行历史 */
  async listRuns(scheduleId: string, limit = 20): Promise<ScheduleRunRecord[]> {
    const data = await readJsonFile<ScheduleRunsData>(getScheduleRunsPath(), { runs: [] });
    return data.runs
      .filter(r => r.scheduleId === scheduleId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  /** 查询所有执行历史 */
  async listAllRuns(limit = 50): Promise<ScheduleRunRecord[]> {
    const data = await readJsonFile<ScheduleRunsData>(getScheduleRunsPath(), { runs: [] });
    return data.runs
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  // ── 数据 CRUD（供 API 路由调用） ──

  async listSchedules(): Promise<AgentSchedule[]> {
    const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
    return data.schedules;
  }

  async createSchedule(input: {
    agentId: string;
    cron: string;
    message: string;
    projectKey?: string;
    label?: string;
    enabled?: boolean;
  }): Promise<AgentSchedule> {
    if (!cron.validate(input.cron)) {
      throw new Error(`无效的 cron 表达式：${input.cron}`);
    }

    const now = new Date().toISOString();
    const schedule: AgentSchedule = {
      id: generateScheduleId(),
      agentId: input.agentId,
      cron: input.cron,
      message: input.message,
      projectKey: input.projectKey,
      label: input.label,
      enabled: input.enabled ?? true,
      nextRunAt: calcNextRunAt(input.cron),
      createdAt: now,
      updatedAt: now,
    };

    await modifyJsonFile<AgentSchedulesData>(
      getSchedulesPath(),
      { schedules: [] },
      (d) => { d.schedules.push(schedule); return d; },
    );

    this.upsert(schedule);
    return schedule;
  }

  async updateSchedule(
    scheduleId: string,
    patch: Partial<Pick<AgentSchedule, 'cron' | 'message' | 'label' | 'enabled' | 'projectKey'>>,
  ): Promise<AgentSchedule | null> {
    if (patch.cron !== undefined && !cron.validate(patch.cron)) {
      throw new Error(`无效的 cron 表达式：${patch.cron}`);
    }

    let updated: AgentSchedule | null = null;

    await modifyJsonFile<AgentSchedulesData>(
      getSchedulesPath(),
      { schedules: [] },
      (d) => {
        const idx = d.schedules.findIndex(s => s.id === scheduleId);
        if (idx === -1) return d;
        d.schedules[idx] = {
          ...d.schedules[idx],
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        updated = d.schedules[idx];
        return d;
      },
    );

    if (updated) {
      this.upsert(updated);
    }
    return updated;
  }

  async deleteSchedule(scheduleId: string): Promise<boolean> {
    let deleted = false;

    await modifyJsonFile<AgentSchedulesData>(
      getSchedulesPath(),
      { schedules: [] },
      (d) => {
        const before = d.schedules.length;
        d.schedules = d.schedules.filter(s => s.id !== scheduleId);
        deleted = d.schedules.length < before;
        return d;
      },
    );

    if (deleted) {
      this.remove(scheduleId);
    }
    return deleted;
  }
}

// ── Singleton ──

const globalForSched = globalThis as unknown as {
  __schedulerManager?: SchedulerManager;
};

export const schedulerManager: SchedulerManager =
  globalForSched.__schedulerManager ?? new SchedulerManager();

if (process.env.NODE_ENV !== 'production') {
  globalForSched.__schedulerManager = schedulerManager;
}
