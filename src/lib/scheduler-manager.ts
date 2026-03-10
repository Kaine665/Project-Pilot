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
import { getSchedulesPath, readJsonFile, modifyJsonFile } from './file-store';
import type { AgentSchedule, AgentSchedulesData } from '@/types';

// ── Helpers ──

function generateScheduleId(): string {
  const ts = Date.now();
  const rand = randomBytes(2).toString('hex');
  return `sched-${ts}-${rand}`;
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
      void this._fire(schedule.id);
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

  private async _fire(scheduleId: string): Promise<void> {
    try {
      // 重新读取最新配置（防止 cron job 创建后规则已被修改或禁用）
      const data = await readJsonFile<AgentSchedulesData>(getSchedulesPath(), { schedules: [] });
      const schedule = data.schedules.find(s => s.id === scheduleId);
      if (!schedule || !schedule.enabled) {
        console.log(`[SchedulerManager] 调度 ${scheduleId} 已禁用或不存在，跳过本次触发`);
        return;
      }

      console.log(`[SchedulerManager] 触发调度 ${scheduleId}（${schedule.label ?? schedule.agentId}）`);

      // 动态导入，避免循环依赖（SchedulerManager 在 agentChatManager 初始化之前加载）
      const { agentChatManager, generateSessionId } = await import('./chat-managers/agent-chat-manager');

      // 构建 flowContext（如果绑定了项目）
      let flowContext: import('./chat-managers/agent-chat-manager').FlowContext | undefined;
      if (schedule.projectKey) {
        const { getFlowDataPath, getFlowIndexPath, ensureFlowsMigrated } = await import('./file-store');
        await ensureFlowsMigrated();
        const flowDataPath = getFlowDataPath(schedule.projectKey);
        let projectName = schedule.projectKey;
        try {
          const { readJsonFile: rjf } = await import('./file-store');
          const idx = await rjf<{ projects: Array<{ key: string; name: string }> }>(
            getFlowIndexPath(), { projects: [] }
          );
          const found = idx.projects.find(p => p.key === schedule.projectKey);
          if (found) projectName = found.name;
        } catch { /* ignore */ }
        flowContext = { projectKey: schedule.projectKey, projectName, flowDataPath };
      }

      const sessionId = generateSessionId();
      await agentChatManager.start(
        sessionId,
        schedule.agentId,
        schedule.message,
        flowContext,
        undefined, // images
        `[定时] ${schedule.label ?? schedule.agentId}`, // initialTitle
      );

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
      console.error(`[SchedulerManager] 触发调度 ${scheduleId} 失败：`, err);
    }
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
