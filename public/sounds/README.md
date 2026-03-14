# Agent 通知音频文件

此目录应包含 `agent-complete.mp3` 文件。

## 音频规格

- **文件名**：`agent-complete.mp3`
- **格式**：MP3
- **时长**：1-2 秒（避免过长干扰）
- **音量**：-3dB（适中，不刺耳）
- **采样率**：44.1kHz
- **文件大小**：< 50KB

## 生成方式

你可以使用以下方式生成或获取通知音频：

1. **使用 ffmpeg**：
   ```bash
   # 生成一个简单的 1 秒钟的 DTMF 音调
   ffmpeg -f lavfi -i sine=f=800:d=0.5 -c:a libmp3lame -q:a 4 agent-complete.mp3
   ```

2. **使用在线音频编辑器**：
   - [Audacity](https://www.audacityteam.org/) - 免费开源
   - [AudioTrim](https://audiotrim.com/) - 在线编辑

3. **购买或下载免费音效**：
   - [Zapsplat](https://www.zapsplat.com/)
   - [Freesound](https://freesound.org/)

## 注意事项

- 音频文件应该清晰、简洁，避免过于刺耳
- 确保文件格式为 MP3（浏览器和 Electron 兼容性最好）
- 文件位置务必是 `public/sounds/agent-complete.mp3`
