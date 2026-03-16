/**
 * 音频播放管理器
 * - 使用 Web Audio API 生成系统提示音（Windows 自带）
 * - 支持音量控制、重试机制
 */

export interface PlayOptions {
  volume?: number; // 0-1
  maxRetries?: number;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;

  /**
   * 初始化 AudioContext（延迟初始化）
   */
  private getAudioContext(): AudioContext {
    if (this.audioContext) {
      return this.audioContext;
    }

    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      throw new Error('Web Audio API 不可用');
    }

    // 使用全局 AudioContext（如果存在）或创建新的
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    return this.audioContext;
  }

  /**
   * 使用 Web Audio API 生成简单提示音（类似 Windows 通知音）
   * 生成两个频率的音调序列，形成典型的通知声音效果
   */
  async playSound(
    _soundPath: string,
    options: PlayOptions = {}
  ): Promise<void> {
    const { volume = 0.5, maxRetries = 2 } = options;

    // 服务端环境检查
    if (typeof window === 'undefined') {
      console.debug('[AudioPlayer] 服务端环境，跳过播放');
      return;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const ctx = this.getAudioContext();

        // 确保 AudioContext 处于运行状态
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // 创建音量控制
        const gainNode = ctx.createGain();
        gainNode.gain.value = Math.max(0, Math.min(1, volume));
        gainNode.connect(ctx.destination);

        // 生成两段提示音：
        // 1. 短的高频音（800Hz，200ms）
        // 2. 短的低频音（1200Hz，150ms）
        const now = ctx.currentTime;
        const duration1 = 0.2;
        const duration2 = 0.15;
        const silence = 0.05;

        // 第一段音频
        const osc1 = ctx.createOscillator();
        osc1.frequency.value = 800;
        osc1.type = 'sine';
        osc1.connect(gainNode);
        osc1.start(now);
        osc1.stop(now + duration1);

        // 第二段音频（有间隔）
        const osc2 = ctx.createOscillator();
        osc2.frequency.value = 1200;
        osc2.type = 'sine';
        osc2.connect(gainNode);
        osc2.start(now + duration1 + silence);
        osc2.stop(now + duration1 + silence + duration2);

        // 等待播放完成
        const totalDuration = duration1 + silence + duration2;
        await new Promise((resolve) => {
          setTimeout(resolve, totalDuration * 1000);
        });

        return;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.error('[AudioPlayer] 音频播放失败:', error);
        } else {
          // 重试
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    }
  }

  /**
   * 预加载（Web Audio API 不需要预加载）
   */
  async preload(_soundPath: string): Promise<void> {
    // Web Audio API 生成音频，无需预加载
    console.debug('[AudioPlayer] Web Audio API 无需预加载');
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // AudioContext 无需手动清理（全局共享）
  }
}
