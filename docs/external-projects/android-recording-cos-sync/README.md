# 安卓录音 → 腾讯云 COS（独立项目说明）

本目录**不是** ProjectPilot 的一部分，也不参与 PP 的构建与发布。这里只放一份**可复制到新 GitHub 仓库**的规格与初始化步骤，避免与主仓库产品文档混淆。

## 在 GitHub 上新开仓库（在你本机或浏览器操作）

1. 在 GitHub 新建空仓库（建议名：`android-recording-cos-sync` 或自定），**不要**勾选自动添加 README（便于后续 `git init` 推送）。
2. 本地执行（先把本目录的 `SPEC.md` 与 `README.md` 拷进新目录，再 `git init`）：

```bash
mkdir android-recording-cos-sync && cd android-recording-cos-sync
# 将 ProjectPilot 中的本目录两个文件拷到此处（路径按你本机调整）
# cp <Project-Pilot>/docs/external-projects/android-recording-cos-sync/SPEC.md .
# cp <Project-Pilot>/docs/external-projects/android-recording-cos-sync/README.md .
git init
mkdir -p docs && cp SPEC.md docs/SPEC.md
# 用 Android Studio 在本目录新建项目：Empty Activity，minSdk 34，包名自定
# …完成首轮代码后再：
git add .
git commit -m "chore: initial Android MVP scaffold and spec"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

## 文档

- 第一期验收与边界：见同目录 **[SPEC.md](./SPEC.md)**。
- 在 **weight-agent** 里开新对话时用的可复制提示词：**[AGENT_PROMPT.md](./AGENT_PROMPT.md)**（打开后复制其中「开始～结束」整段）。

## 与 PP 仓库的关系

开发、Issue、CI 均在**新仓库**进行；ProjectPilot 仓库无需引用该 Android 项目。
