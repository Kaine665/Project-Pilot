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
    // 初始化：请求通知权限（如果需要）
    if (BrowserNotifier.isSupported()) {
      const permission = BrowserNotifier.getPermission();
      console.debug('[useNotificationManager] 当前通知权限:', permission);

      if (permission === 'default') {
        // 尝试请求权限（用户交互上下文中）
        Notification.requestPermission()
          .then((perm) => {
            console.debug('[useNotificationManager] 权限请求结果:', perm);
          })
          .catch((err) => {
            console.warn('[useNotificationManager] 权限请求错误:', err);
          });
      }
    }

    // 初始化音频预加载
    notifier
      .preloadSound()
      .then(() => {
        console.debug('[useNotificationManager] 音频预加载成功');
      })
      .catch((err) => {
        console.warn('[useNotificationManager] 音频预加载错误:', err);
      });

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
