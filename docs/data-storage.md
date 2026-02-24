# 数据存储位置

## 概述

ProjectPilot 的用户数据默认存储在**用户目录**，与代码分离，符合软件分发规范。

## 数据位置

### 默认位置

- **Windows**: `C:\Users\<用户名>\.project-pilot\data\`
- **macOS**: `/Users/<用户名>/.project-pilot/data/`
- **Linux**: `/home/<用户名>/.project-pilot/data/`

### 自定义位置

可通过环境变量 `PROJECT_PILOT_DATA_DIR` 自定义数据目录：

```bash
# .env 文件
PROJECT_PILOT_DATA_DIR=/path/to/custom/data/dir
```

## 数据迁移

### 从旧版本（v0.1.0 之前）迁移

旧版本数据存储在项目根目录的 `data/` 文件夹，需要手动迁移：

```bash
npm run migrate:data
```

迁移脚本会：
1. 检查旧数据目录是否存在
2. 将数据复制到新位置
3. **不会自动删除旧数据**（需手动确认后删除）

### 手动迁移

如果迁移脚本失败，可手动操作：

**Windows**:
```cmd
xcopy /E /I /Y data C:\Users\<用户名>\.project-pilot\data
```

**macOS/Linux**:
```bash
cp -r data ~/.project-pilot/data/
```

## 数据结构

```
.project-pilot/
└── data/
    ├── projects.json          # 项目列表
    ├── tasks.json             # 任务列表
    ├── ai-plans.json          # AI 计划
    ├── conversations/         # 对话历史
    ├── task-artifacts/        # 任务产物
    ├── artifacts/             # 其他产物
    ├── prompts/               # Prompt 记录
    └── logs/                  # 日志文件
```

## 注意事项

1. **数据隔离** — 每个用户有独立的数据目录
2. **版本控制** — 数据目录不纳入 Git 管理（已在 `.gitignore` 中排除旧位置）
3. **备份建议** — 定期备份 `~/.project-pilot/data/` 目录
4. **权限问题** — 确保应用有读写用户目录的权限

## 故障排查

### 应用无法读取数据

1. 检查数据目录是否存在：
   ```bash
   ls ~/.project-pilot/data/
   ```

2. 检查环境变量（如果自定义了位置）：
   ```bash
   echo $PROJECT_PILOT_DATA_DIR
   ```

3. 检查文件权限：
   ```bash
   ls -la ~/.project-pilot/data/
   ```

### 数据丢失

如果旧数据还在项目目录：
```bash
# 重新运行迁移脚本
npm run migrate:data
```

## 相关文件

- [src/lib/file-store.ts](../src/lib/file-store.ts) — 数据存储逻辑
- [scripts/migrate-data.js](../scripts/migrate-data.js) — 迁移脚本
- [.env.example](../.env.example) — 环境变量示例
