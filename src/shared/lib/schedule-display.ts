/**
 * 定时任务列表 / 详情共用：cron 与下次运行的人读文案
 */

/** 列表用：带 ~ 表示计划时刻可能抖动（与产品文案一致） */
export function cronSummaryHumanZh(cron: string): string {
  const m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) {
    const mm = Number(m[1]) < 10 ? `0${m[1]}` : m[1];
    return `每天约 ~${m[2]}:${mm}`;
  }
  if (cron === '0 * * * *') return '每小时';
  const w = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+1$/);
  if (w) {
    const mm = Number(w[1]) < 10 ? `0${w[1]}` : w[1];
    return `每周一约 ~${w[2]}:${mm}`;
  }
  if (cron === '*/30 * * * *') return '约每 30 分钟';
  return '按自定义计划运行';
}

/** 详情侧栏等：可读 cron，无 ~ */
export function cronSummaryZh(cron: string): string {
  const m = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m) {
    const mm = Number(m[1]) < 10 ? `0${m[1]}` : m[1];
    return `每天约 ${m[2]}:${mm}`;
  }
  if (cron === '0 * * * *') return '每小时';
  const w = cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+1$/);
  if (w) {
    const mm = Number(w[1]) < 10 ? `0${w[1]}` : w[1];
    return `每周一约 ${w[2]}:${mm}`;
  }
  return cron;
}

export function formatNextRunZh(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const runDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((runDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    const t = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (diffDays === 0) return `今天 ${t}`;
    if (diffDays === 1) return `明天 ${t}`;
    if (diffDays === 2) return `后天 ${t}`;
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function formatNextRunLine(iso?: string): string {
  return `下次运行 ${formatNextRunZh(iso)}`;
}
