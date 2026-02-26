# affected_files 交叉检测方案

## 背景

这是[我的系统如何做到不交叉](./我的系统如何做到不交叉.md)中"方案 3：Planning 阶段声明 affected_files"的实施方案。

核心思路：让 AI 在 Planning 阶段声明预计修改的文件列表，系统自动比对兄弟任务之间有没有重叠，在 Executing 之前给用户预警。Execution 结束后，记录实际改动，与预期对比。

## 两层记录

### 第一层：预期改动（Plan 阶段产出）

Planning prompt 要求 AI 输出 `affected_files` 字段：

```json
{
  "steps": [...],
  "affected_files": ["src/api/user.ts", "src/types/user.ts"],
  "affected_modules": ["api", "types"]
}
```

这不是额外负担——AI 做 Planning 本身就在调查要改哪些文件，只是要求它显式输出。

### 第二层：实际改动（Execution 结束后记录）

Execution 完成后，用 `git diff --stat` 拿到实际改动的文件列表和行数变化。这几乎是免费的，不依赖 AI。

```json
{
  "actual_files": ["src/api/user.ts", "src/types/user.ts", "src/utils/validate.ts"],
  "line_changes": { "src/api/user.ts": { "added": 12, "removed": 3 }, ... }
}
```

## 两个检测点

### 检测点 1：执行前 — 兄弟任务交叉检测

**时机**：所有兄弟任务的 Planning 完成后、Executing 开始前。

**逻辑**：
1. 收集同一层级兄弟任务的 `affected_files`
2. 两两求交集
3. 交集非空 → UI 上标记警告："Task A 和 Task B 都要改 `user.ts`"
4. 用户自己决定：串行做，还是接受风险并行

这是纯代码逻辑（集合交集），不依赖 AI 判断。

### 检测点 2：执行后 — 预期 vs 实际对比

**时机**：Execution 完成后。

**逻辑**：
1. 比较 `affected_files`（预期）和 `actual_files`（实际）
2. `actual_files - affected_files` = 预期之外的改动
3. 如果有超出范围的文件 → 标记偏离

**价值**：
- 让"执行偏离计划"从隐性问题变成可观测问题
- 积累数据后可以发现哪类任务偏离率高，针对性优化

## 实施步骤

1. **Planning prompt 改造** — 让 AI 输出 `affected_files`
2. **兄弟任务交叉检测** — 比对 affected_files 交集，UI 展示警告
3. **Execution 后实际改动记录 + 对比** — git diff stat + 集合差集
