'use client';

/**
 * 通知管理 Hook
 * - 初始化通知系统（权限检查、音频预加载）
 * - 触发完成通知
 */

import { useEffect, useMemo } from 'react';
import { completionNotifier } from '@/lib/completion-notifier';
import { BrowserNotifier } from '@/lib/notification/browser-notification';

export function useNotificationManager() {
  const notifier = useMemo(() => completionNotifier, []);

  useEffect(() => {
    // 初始化音频预加载
    notifier.preloadSound();

    // 清理函数
    return () => {
      notifier.cleanup();
    };
  }, [notifier]);

  return {
    notifier,
    isSupported: BrowserNotifier.isSupported(),
    getPermission: BrowserNotifier.getPermission(),
    notifyCompletion: notifier.notifyCompletion.bind(notifier),
  };
}
