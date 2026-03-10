/**
 * Next.js instrumentation hook — 服务端启动时执行一次。
 * 用于初始化进程级单例（SchedulerManager）。
 *
 * 文档：https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 仅在 Node.js 运行时初始化（跳过 Edge Runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { schedulerManager } = await import('./src/lib/scheduler-manager');
    await schedulerManager.init();
  }
}
