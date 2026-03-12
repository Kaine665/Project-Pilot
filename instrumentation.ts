/**
 * Next.js instrumentation hook — 服务端启动时执行一次。
 * 在 Next.js 启动时预热 Agent Sidecar 进程（若未运行则自动启动）。
 *
 * SchedulerManager 现在运行在 sidecar 进程中，Next.js 无需直接初始化。
 *
 * 文档：https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 仅在 Node.js 运行时（跳过 Edge Runtime）
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureSidecar } = await import('./src/lib/sidecar-bridge');
    try {
      await ensureSidecar();
      console.log('[instrumentation] Agent sidecar ready');
    } catch (err) {
      // 启动失败不阻塞 Next.js 启动，sidecar 会在首次 API 请求时重试
      console.error('[instrumentation] Failed to start agent sidecar:', err);
    }
  }
}
