/**
 * 音频播放管理器
 * - 支持多种内置合成音色
 * - 支持用户上传的短音频文件（Data URL）
 * - 自定义文件播放失败时自动回退到内置音色
 */

import type {
  BuiltInNotificationSoundId,
  NotificationSoundSource,
} from '@/types';
import { BUILT_IN_NOTIFICATION_TONES } from '@/lib/notification/notification-sound-presets';

export interface PlayOptions {
  volume?: number;
  maxRetries?: number;
}

export interface SoundPlaybackConfig {
  soundSource?: NotificationSoundSource;
  builtinSound?: BuiltInNotificationSoundId;
  customSoundDataUrl?: string;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private preloadedCustomAudio: HTMLAudioElement | null = null;
  private preloadedCustomAudioSrc: string | null = null;

  private getAudioContext(): AudioContext {
    if (this.audioContext) {
      return this.audioContext;
    }

    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      throw new Error('Web Audio API 不可用');
    }

    this.audioContext = new (window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext!)();
    return this.audioContext;
  }

  async playSound(
    config: SoundPlaybackConfig,
    options: PlayOptions = {},
  ): Promise<void> {
    const { volume = 0.5, maxRetries = 2 } = options;

    if (typeof window === 'undefined') {
      return;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (config.soundSource === 'custom' && config.customSoundDataUrl) {
          await this.playCustomAudio(config.customSoundDataUrl, volume);
          return;
        }

        await this.playBuiltInTone(config.builtinSound ?? 'classic', volume);
        return;
      } catch (error) {
        const shouldFallbackToBuiltin =
          config.soundSource === 'custom' && !!config.customSoundDataUrl;

        if (shouldFallbackToBuiltin) {
          console.warn('[AudioPlayer] 自定义通知音频播放失败，回退到内置音色:', error);
          await this.playBuiltInTone(config.builtinSound ?? 'classic', volume);
          return;
        }

        if (attempt === maxRetries - 1) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  async preload(config: SoundPlaybackConfig): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    if (config.soundSource !== 'custom' || !config.customSoundDataUrl) {
      this.clearPreloadedCustomAudio();
      return;
    }

    if (this.preloadedCustomAudioSrc === config.customSoundDataUrl) {
      return;
    }

    this.clearPreloadedCustomAudio();

    const audio = new Audio(config.customSoundDataUrl);
    audio.preload = 'auto';
    audio.load();

    this.preloadedCustomAudio = audio;
    this.preloadedCustomAudioSrc = config.customSoundDataUrl;
  }

  cleanup(): void {
    this.clearPreloadedCustomAudio();
  }

  private clearPreloadedCustomAudio(): void {
    if (this.preloadedCustomAudio) {
      this.preloadedCustomAudio.pause();
      this.preloadedCustomAudio.src = '';
      this.preloadedCustomAudio = null;
    }
    this.preloadedCustomAudioSrc = null;
  }

  private async playCustomAudio(src: string, volume: number): Promise<void> {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = clampVolume(volume);

    await waitForAudioPlayback(audio);
  }

  private async playBuiltInTone(
    presetId: BuiltInNotificationSoundId,
    volume: number,
  ): Promise<void> {
    const ctx = this.getAudioContext();

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const gainNode = ctx.createGain();
    gainNode.gain.value = clampVolume(volume);
    gainNode.connect(ctx.destination);

    const preset = BUILT_IN_NOTIFICATION_TONES[presetId] ?? BUILT_IN_NOTIFICATION_TONES.classic;
    let cursor = ctx.currentTime;

    for (const step of preset) {
      const osc = ctx.createOscillator();
      const stepGain = ctx.createGain();
      const duration = step.durationMs / 1000;
      const baseGain = gainNode.gain.value * (step.gain ?? 1);

      osc.type = step.type ?? 'sine';
      osc.frequency.value = step.frequency;
      osc.connect(stepGain);
      stepGain.connect(gainNode);

      stepGain.gain.setValueAtTime(0.0001, cursor);
      stepGain.gain.exponentialRampToValueAtTime(Math.max(baseGain, 0.0001), cursor + 0.01);
      stepGain.gain.exponentialRampToValueAtTime(0.0001, cursor + duration);

      osc.start(cursor);
      osc.stop(cursor + duration);

      cursor += duration + ((step.gapAfterMs ?? 0) / 1000);
    }

    const totalMs = Math.max(0, (cursor - ctx.currentTime) * 1000);
    await new Promise((resolve) => setTimeout(resolve, totalMs));
  }
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.5;
  return Math.min(1, Math.max(0, volume));
}

async function waitForAudioPlayback(audio: HTMLAudioElement): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('abort', handleAbort);
    };

    const handleEnded = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(audio.error ?? new Error('Custom sound playback failed'));
    };

    const handleAbort = () => {
      cleanup();
      reject(new Error('Custom sound playback aborted'));
    };

    audio.addEventListener('ended', handleEnded, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    audio.addEventListener('abort', handleAbort, { once: true });

    audio.play().catch((error) => {
      cleanup();
      reject(error);
    });
  }).finally(() => {
    audio.pause();
    audio.currentTime = 0;
  });
}
