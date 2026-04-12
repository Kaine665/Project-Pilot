# 在 weight-agent 仓库里用的提示词（复制下面整段）

把从 **「## 开始」** 到 **「## 结束」** 之间的内容复制到新聊天/新 Agent，并把仓库切到 **https://github.com/Kaine665/weight-agent**。

---

## 开始

工作仓库：**weight-agent**（https://github.com/Kaine665/weight-agent）。本项目与 ProjectPilot 无关。

### 本轮只做一件事（不要写代码）

请**完整阅读**本仓库里与第一期相关的文档，把上下文装进对话里，供后续再问。具体：

1. 打开并阅读 **`README.md`**（若存在）。
2. 打开并阅读 **`docs/SPEC.md`**；若仓库根目录有 **`SPEC.md`** 而没有 `docs/SPEC.md`，则读根目录那份即可。
3. 若上述文件缺失，**不要**开始实现或搭工程；只说明缺了哪些文件，并提示从 ProjectPilot 复制：`docs/external-projects/android-recording-cos-sync/SPEC.md`（及同目录 `README.md` 若需要）。

### 读完后请输出（中文）

- **范围复述**：用 5～10 句话概括产品做什么、不做什么（对照 SPEC 的 Non-goals）。
- **验收锚点**：列出 DoD 与 10 条验收用例的标题级清单（不必展开细节，便于以后对齐）。
- **待澄清问题**：最多 5 条你认为 SPEC 仍模糊、需要人类拍板的地方（没有则写「暂无」）。

**明确禁止**：新建模块、改 Gradle、集成 SDK、写 UI 代码——除非用户在下一轮消息里明确要求写代码。

## 结束

---

## 在 PP 里本文件的用途

- 你在 **ProjectPilot** 里打开：`docs/external-projects/android-recording-cos-sync/AGENT_PROMPT.md`
- 复制 **「## 开始」～「## 结束」** 到 **weight-agent** 仓库里的 Cursor 会话即可。

若 weight-agent 里还没有 `docs/SPEC.md`（或根目录 `SPEC.md`），请把 PP 里同目录的 **`SPEC.md`** 复制进 weight-agent 后再发本提示词（或从 weight-agent 远端拉取已推送的文档）。
