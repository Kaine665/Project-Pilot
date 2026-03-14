/**
 * 音频播放管理器
 * - 处理 HTML Audio Element
 * - 重试机制、音量控制
 * - 预加载支持
 */

export interface PlayOptions {
  volume?: number; // 0-1
  maxRetries?: number;
}

export class AudioPlayer {
  private audioElement: HTMLAudioElement | null = null;
  private preloadedUrl: string | null = null;

  /**
   * 播放音频文件
   */
  async playSound(
    soundPath: string,
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
        // 创建或重用 audio 元素
        const audio = this.audioElement || new Audio();

        // 使用预加载 URL，或直接使用文件路径
        audio.src = this.preloadedUrl || soundPath;

        // 设置音量
        audio.volume = Math.max(0, Math.min(1, volume));

        // 尝试播放
        const playPromise = audio.play();
        if (playPromise) {
          await playPromise;
        }

        // 保存引用供后续重用
        this.audioElement = audio;
        return;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.error('[AudioPlayer] 音频播放失败:', error);
        } else {
          // 重试
          await new Promise((r) =>
            setTimeout(r, 50)
          );
        }
      }
    }
  }

  /**
   * 预加载音频文件到内存
   */
  async preload(soundPath: string): Promise<void> {
    if (typeof window === 'undefined') {
      console.debug('[AudioPlayer] 服务端环境，跳过预加载');
      return;
    }

    try {
      const response = await fetch(soundPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      this.preloadedUrl = URL.createObjectURL(blob);
      console.debug('[AudioPlayer] 音频预加载成功');
    } catch (error) {
      console.warn('[AudioPlayer] 音频预加载失败:', error);
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.preloadedUrl) {
      URL.revokeObjectURL(this.preloadedUrl);
      this.preloadedUrl = null;
    }
    if (this.audioElement) {
      this.audioElement.src = '';
      this.audioElement = null;
    }
  }
}
