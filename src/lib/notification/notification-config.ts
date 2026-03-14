/**
 * 通知系统配置常数
 */

export const NOTIFICATION_CONFIG = {
  // 通知 tag 前缀（用于去重）
  TAG_PREFIX: 'agent-complete',

  // 默认图标（相对路径）
  DEFAULT_ICON: '/favicon.ico',

  // 通知超时时间（毫秒，0 = 系统默认）
  AUTO_CLOSE_TIMEOUT: 0,

  // 通知文本
  MESSAGES: {
    TITLE: 'Agent 已完成回复',
    BODY_TEMPLATE: '{agentName} 在会话 "{sessionTitle}" 中已完成回复',
  },
};

export const AUDIO_CONFIG = {
  // 音频文件路径
  DEFAULT_SOUND_PATH: '/sounds/agent-complete.mp3',

  // 默认音量（0-1）
  DEFAULT_VOLUME: 0.5,

  // 音频重试次数
  MAX_RETRIES: 2,

  // 重试延迟（毫秒）
  RETRY_DELAY: 50,
};
