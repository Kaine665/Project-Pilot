# Superdesign：Agents 工作区整页聊天（会话条为视觉焦点）

用于对照 **左侧栏 + Agent 头 + 会话条 + 消息区 + 输入区** 的整体布局。在项目画布中可对比多版分支。

## 项目

**Superdesign 项目（所有稿在同一项目里）：**  
https://app.superdesign.dev/teams/b30159c0-63e0-465f-ac9f-9e3f38c45ee7/projects/37ee0e98-7a5b-4bc8-bfe6-578cc3f0199e

## 稿一览（预览链接）

| # | 稿名（平台生成） | 方向说明（迭代 prompt 意图） | 预览 |
|---|------------------|------------------------------|------|
| 0 | 智能体对话工作空间 | 首版：侧栏 + Agent 头 + 独立会话条 + 消息 + 输入 | [预览](https://p.superdesign.dev/draft/243632ea-976d-4094-a944-346eb29fbf4e) |
| A1 | 智能体编辑器风格工作空间 | IDE 式密工具条 / 偏开发者密度 | [预览](https://p.superdesign.dev/draft/35015f85-97c8-479b-80e1-622ca7617151) |
| A2 | 精简对话状态栏 | 单行极简：标题 + 下拉 + 右侧图标按钮 | [预览](https://p.superdesign.dev/draft/188fbbdd-a8b2-4ed0-ad1c-dff8e9f54039) |
| A3 | 智能体对话工作空间 - 优化顶部状态栏 | 会话信息并入 Agent 头、去掉独立第二行（方向） | [预览](https://p.superdesign.dev/draft/99c9e0fd-b91c-4ba2-94fe-2a6e6c93c630) |
| A4 | 智能体对话工作空间 - 多会话标签页 | 浏览器式多 Tab | [预览](https://p.superdesign.dev/draft/335a0cc2-2565-4235-8f9b-e24c7ab7e091) |
| B1 | 智能体对话工作空间 - 暗色模式 | 深色 + 玻璃感会话条 | [预览](https://p.superdesign.dev/draft/97674ff9-27ff-427d-9e9a-aeb89bb209d5) |
| B2 | iOS 风格智能工作空间 | 大标题、分组圆角、导航栏式标题区 | [预览](https://p.superdesign.dev/draft/613d68d8-984f-4243-a48d-df3a4f4184c9) |
| B3 | Linear 极简智能工作空间 | 黑白极简、小写大写标签 | [预览](https://p.superdesign.dev/draft/2287e55b-63c2-4089-bc9a-73fb4a74d3d1) |
| B4 | Slack风格智能体对话空间 | 频道头 + topic 式会话标题 | [预览](https://p.superdesign.dev/draft/5de93f5a-bafa-4f7e-8e69-c2f39454cb40) |

> 说明：A1–A4、B1–B4 为从 **#0** 分支迭代生成；具体版式以预览为准，标题由平台自动命名，可能与 prompt 略有偏差。

## 其他说明

- CLI 带 `--context-file "src/app/[locale]/flows/agents/page.tsx"` 时当前环境曾返回 400，这些稿多为 **纯 prompt** 生成。
- 产品实现以仓库 `src/app/[locale]/flows/agents/page.tsx` 与 `messages/*.json` 为准。

## 变更记录

- 2026-04-03：新建项目与首版整页 draft（#0）。
- 2026-04-03：从 #0 **branch** 两轮共 **8** 个变体（结构/密度一条线 + 参考产品风格一条线），并更新本表。
