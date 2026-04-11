# 在 weight-agent 仓库里用的提示词（复制下面整段）

把从 **「## 开始」** 到 **「## 结束」** 之间的内容复制到新聊天/新 Agent，并把仓库切到 **https://github.com/Kaine665/weight-agent**。

---

## 开始

你是资深 Android（Kotlin）工程师。工作仓库：**weight-agent**（https://github.com/Kaine665/weight-agent）。本项目与 ProjectPilot 无关。

### 权威规格（必须先读）

在仓库根目录或 `docs/` 下应有 **`SPEC.md`**（第一期：安卓本地录音 → 腾讯云 COS）。若尚未存在，请从 ProjectPilot 仓库复制同内容：`docs/external-projects/android-recording-cos-sync/SPEC.md`。

**实现与验收必须以 `SPEC.md` 为准**：Non-goals、两页 UI、同步状态机、DoD、10 条验收用例。不要扩展 Agent/MCP/转写/多云。

### 技术约束（摘要）

- **minSdk 34**（Android 14+）；中文 UI only。
- 录音来源：**系统录音机**，通过 **`MediaStore`** 列出音频；`READ_MEDIA_AUDIO` 等权限按规范处理。
- 上传目标：**仅腾讯云 COS**；配置页包含 SecretId、SecretKey、region、bucket、prefix；提供「测试连接」。
- 调度：**WorkManager**；不要求录完即传，但要「尽快 + 当日兜底」；断网/杀进程不静默丢队列（见 SPEC）。
- **密钥**：不打日志、不进 Git；提示用户子账号与最小权限。

### 当前任务

1. 若仓库只有文档：用 Android Studio 在本仓库根目录创建 **Empty Activity** 工程，**minSdk 34**，Kotlin，包名你定但写进 README。
2. 按 `SPEC.md` 实现 **录音列表页** + **COS 配置页**，列表展示每条录音的同步状态（未同步 / 上传中 / 已同步 / 失败可重试）。
3. 本地 Room/SQLite 存映射与队列状态；集成腾讯云 COS 官方 SDK 完成上传。
4. 根 `README.md` 补充：如何配置 COS、权限说明、已知限制（与 SPEC Non-goals 一致）。

每完成一个里程碑，对照 `SPEC.md` 第 7 节逐条说明覆盖了哪些验收用例；未覆盖的写明原因与后续计划。

## 结束

---

## 在 PP 里本文件的用途

- 你在 **ProjectPilot** 里打开：`docs/external-projects/android-recording-cos-sync/AGENT_PROMPT.md`
- 复制 **「## 开始」～「## 结束」** 到 **weight-agent** 仓库里的 Cursor 会话即可。

若 weight-agent 里还没有 `SPEC.md`，请把 PP 里同目录的 **`SPEC.md`** 一并复制过去（或从 weight-agent 远端拉取已推送的文档）。
