# 示例项目

这个目录包含了适合用于演示和学习的示例项目。

## 📂 可用示例

### 1. 个人技术博客开发 (`personal-blog/`)

一个完整的博客开发项目示例，展示了如何用 ProjectPilot 管理整个开发流程。

**包含内容**:
- ✅ 完整的 Flow 结构（4个节点，14个任务）
- ✅ 3个已完成的 Session（展示五阶段工作流）
- ✅ 真实的开发场景和任务描述

**适合用于**:
- 录制产品 Demo
- 向他人展示 ProjectPilot 的能力
- 学习如何使用 ProjectPilot

## 🚀 快速开始

### 方法 1: 一键导入（推荐）

```bash
# 导入示例数据
npm run demo:load

# 启动应用
npm run dev

# 访问 http://localhost:4000，查看 "个人技术博客开发" Flow
```

### 方法 2: 手动复制

```bash
# 复制示例数据到 data 目录
cp examples/personal-blog/demo-data.json data/flows/demo-blog.json

# 启动应用
npm run dev
```

### 方法 3: 手动创建（适合录制 demo）

按照 `personal-blog/USAGE.md` 中的步骤，手动创建 Flow 和任务。
这种方式更适合录制 demo 视频，因为可以展示实际的操作流程。

## 📹 录制 Demo 指南

详细的录制指南请查看: [`personal-blog/USAGE.md`](personal-blog/USAGE.md)

**快速提示**:
1. 使用 [ScreenToGif](https://www.screentogif.com/) 或 [Kap](https://getkap.co/) 录制
2. 控制时长在 30-60 秒
3. 突出核心价值：可视化管理 + AI 自动执行
4. 文件大小控制在 5MB 以内

## 🎯 示例项目的用途

### 对外展示
- 添加到 README 作为 Demo
- 用于社交媒体推广
- Product Hunt 展示页面

### 内部学习
- 了解如何组织项目结构
- 学习如何描述任务
- 理解五阶段工作流

### 用户引导
- 新用户 onboarding
- 功能教程
- 最佳实践示范

## 📝 创建自己的示例

如果你想创建新的示例项目，可以参考 `personal-blog/` 的结构：

```
your-example/
├── README.md           # 项目说明
├── USAGE.md            # 使用指南
└── demo-data.json      # 示例数据
```

### 示例数据格式

```json
{
  "flow": {
    "id": "unique-id",
    "name": "项目名称",
    "description": "项目描述",
    "nodes": [
      {
        "id": "node-1",
        "name": "节点名称",
        "tasks": [
          {
            "id": "task-1-1",
            "content": "任务描述",
            "status": "completed | in_progress | pending",
            "sessionId": "session-id" // 可选
          }
        ]
      }
    ]
  },
  "sessions": [
    {
      "id": "session-id",
      "taskId": "task-1-1",
      "phase": "completed",
      "understanding": { /* ... */ },
      "plan": { /* ... */ },
      "result": { /* ... */ }
    }
  ]
}
```

## 🌟 推荐示例场景

以下是一些适合创建示例的场景：

1. **Web 开发**
   - ✅ 个人博客（已提供）
   - 待开发：电商网站
   - 待开发：Dashboard 应用

2. **问题诊断**
   - 待开发：Bug 修复流程
   - 待开发：性能优化项目

3. **学习路径**
   - 待开发：React 学习计划
   - 待开发：TypeScript 入门

4. **自动化任务**
   - 待开发：数据爬取项目
   - 待开发：API 集成

## 🤝 贡献示例

如果你创建了有价值的示例项目，欢迎提交 PR！

要求：
- 场景真实、通用
- 包含完整的说明文档
- 数据结构清晰
- 适合对外展示

## 📚 相关文档

- [主 README](../README.md)
- [贡献指南](../CONTRIBUTING.md)
- [开源项目发展路线图](../docs/ROADMAP_TO_STARS.md)
