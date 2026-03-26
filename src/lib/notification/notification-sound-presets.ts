import {
  BUILT_IN_NOTIFICATION_SOUND_IDS,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '@/types';
import type {
  BuiltInNotificationSoundId,
  NotificationSettings,
  NotificationSoundSource,
} from '@/types';

export const NOTIFICATION_SOUND_SOURCE_OPTIONS: Array<{
  id: NotificationSoundSource;
  label: string;
  description: string;
}> = [
  {
    id: 'builtin',
    label: '内置音色',
    description: '浏览器内合成，体积最小，开箱即用。',
  },
  {
    id: 'custom',
    label: '自定义文件',
    description: '上传一段短音频，保存在本地设置里。',
  },
];

export const BUILT_IN_NOTIFICATION_SOUND_OPTIONS: Array<{
  id: BuiltInNotificationSoundId;
  label: string;
  description: string;
}> = [
  { id: 'classic', label: 'Classic', description: '标准双音提示，接近系统通知感。' },
  { id: 'glass', label: 'Glass', description: '更清亮，尾音更轻。' },
  { id: 'soft', label: 'Soft', description: '频率更低，打扰感更弱。' },
  { id: 'pulse', label: 'Pulse', description: '短促三连音，识别度更高。' },
];

export const MAX_CUSTOM_SOUND_BYTES = 512 * 1024;
export const MAX_CUSTOM_SOUND_DATA_URL_LENGTH = 900 * 1024;

export interface NotificationToneStep {
  frequency: number;
  durationMs: number;
  gapAfterMs?: number;
  type?: OscillatorType;
  gain?: number;
}

export const BUILT_IN_NOTIFICATION_TONES: Record<
  BuiltInNotificationSoundId,
  NotificationToneStep[]
> = {
  classic: [
    { frequency: 880, durationMs: 150, gapAfterMs: 35, type: 'sine', gain: 0.95 },
    { frequency: 1320, durationMs: 130, type: 'sine', gain: 0.75 },
  ],
  glass: [
    { frequency: 1175, durationMs: 110, gapAfterMs: 30, type: 'triangle', gain: 0.9 },
    { frequency: 1568, durationMs: 160, type: 'sine', gain: 0.65 },
  ],
  soft: [
    { frequency: 698, durationMs: 160, gapAfterMs: 45, type: 'sine', gain: 0.7 },
    { frequency: 932, durationMs: 180, type: 'triangle', gain: 0.55 },
  ],
  pulse: [
    { frequency: 784, durationMs: 85, gapAfterMs: 28, type: 'square', gain: 0.55 },
    { frequency: 988, durationMs: 85, gapAfterMs: 28, type: 'square', gain: 0.5 },
    { frequency: 1319, durationMs: 110, type: 'triangle', gain: 0.6 },
  ],
};

export function normalizeNotificationSettings(
  settings?: NotificationSettings | null,
): NotificationSettings {
  const merged: NotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(settings ?? {}),
  };

  merged.soundSource = isValidSoundSource(merged.soundSource)
    ? merged.soundSource
    : DEFAULT_NOTIFICATION_SETTINGS.soundSource;
  merged.builtinSound = isValidBuiltInSoundId(merged.builtinSound)
    ? merged.builtinSound
    : DEFAULT_NOTIFICATION_SETTINGS.builtinSound;

  if (
    typeof merged.customSoundDataUrl !== 'string'
    || !merged.customSoundDataUrl.startsWith('data:audio/')
    || merged.customSoundDataUrl.length > MAX_CUSTOM_SOUND_DATA_URL_LENGTH
  ) {
    merged.customSoundDataUrl = undefined;
    merged.customSoundName = undefined;
  }

  if (typeof merged.customSoundName !== 'string' || merged.customSoundName.length === 0) {
    merged.customSoundName = undefined;
  }

  return merged;
}

export function isValidSoundSource(value: unknown): value is NotificationSoundSource {
  return value === 'builtin' || value === 'custom';
}

export function isValidBuiltInSoundId(value: unknown): value is BuiltInNotificationSoundId {
  return typeof value === 'string'
    && BUILT_IN_NOTIFICATION_SOUND_IDS.includes(value as BuiltInNotificationSoundId);
}

