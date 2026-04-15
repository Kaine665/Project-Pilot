# Git Worktree 教程

## 一句话理解

**一个仓库，多个工作目录。** 每个目录可以 checkout 不同分支，互不干扰，同时工作。

## 核心概念

### 先理解三个东西

```
分支 (Branch)   → 逻辑概念，一个指向 commit 的指针
工作树 (Worktree) → 物理概念，磁盘上的一个文件夹，包含某个分支的实际文件
.git 仓库       → 存储所有历史的数据库，所有 worktree 共享同一个
```

默认情况下，你只有一个 worktree（项目根目录）。想看另一个分支的代码，必须 `git switch`，当前文件就被替换了。

`git worktree add` 的作用就是：**再开一个文件夹，让两个分支的文件同时存在于磁盘上。**

### 类比

| 类比 | 分支 | Worktree |
|------|------|----------|
| 电视 | 频道（内容线） | 电视机（物理屏幕） |
| 问题 | 频道有很多 | 默认只有一台电视，同时只能看一个 |
| worktree | — | 多搬一台电视，两个频道同时看 |

## 基本操作

### 创建 worktree

```bash
# 从当前 HEAD 创建新分支 + 新 worktree
git worktree add ../my-feature -b my-feature-branch

# 基于已有分支创建 worktree
git worktree add ../hotfix hotfix-branch

# 在指定路径创建（不一定要在上级目录）
git worktree add .claude/worktrees/dev -b dev
```

创建后，目标路径就是一个完整的工作目录，可以 `cd` 进去正常开发。

### 查看所有 worktree

```bash
git worktree list
```

输出：

```
D:/projects/my-repo          abc1234 [main]
D:/projects/my-repo-feature  def5678 [feature-x]
```

### 删除 worktree

```bash
# 规范方式（推荐）
git worktree remove ../my-feature

# 如果已经手动删了文件夹，清理残留引用
git worktree prune
```

> **不要直接 `rm -rf`**。虽然不会损坏仓库，但 `.git/worktrees/` 里会留残余记录，需要 `prune` 清理。

### Windows 文件锁与目录删除

Windows 上删除 worktree 目录经常遇到文件锁（npm 产生的 `.node` 原生模块被系统锁住），导致 `git worktree remove` 或 `rd /s /q` 失败。

ProjectPilot 的 `removeWorktreeDirectory()`（`src/lib/worktree-ports.ts`）采用三级递进策略：

1. **直接删除**：`rd /s /q` 尝试整个目录（快速路径）
2. **逐个击破**：递归遍历每个文件/子目录，能删就删，被锁就跳过，继续删下一个
3. **移到垃圾桶**：把删不掉的残留（此时只剩被锁的少量文件）整体 rename 到 `_trashs/`

`_trashs/` 位于仓库根目录（与 `src/` 等同级），在每次 cleanup 时尝试清理。

### 完整生命周期

```bash
# 1. 创建
git worktree add ../fix-bug -b fix-bug

# 2. 进去开发
cd ../fix-bug
npm install
npm run dev

# 3. 改代码、提交
git add .
git commit -m "fix: something"

# 4. 回主目录合并
cd ../my-repo
git merge fix-bug

# 5. 清理
git worktree remove ../fix-bug
git branch -d fix-bug
```

## 和其他方案的对比

### vs 手动复制文件夹

| 维度 | git worktree | 手动复制 |
|------|-------------|---------|
| Git 历史 | 共享，commit 实时可见 | 独立仓库，需要 remote + fetch |
| 磁盘占用 | 只多一份工作文件 | 完整复制（含 `.git`） |
| 合并代码 | 直接 `git merge` | 需要配置 remote，麻烦 |
| refs 同步 | 实时 | 手动 fetch |

### vs git stash + switch

| 场景 | stash + switch | worktree |
|------|---------------|----------|
| 临时看另一个分支 | 够用 | 杀鸡用牛刀 |
| 两个分支同时跑 dev server | 做不到 | 正好解决 |
| 改到一半要紧急修 bug | stash 容易忘/冲突 | 各改各的 |
| 频繁在两个分支间切换 | 每次都要 stash/pop | 两个终端各开一个 |

### vs git clone（克隆第二份）

| 维度 | git worktree | 再 clone 一份 |
|------|-------------|--------------|
| 历史共享 | 是 | 否，独立副本 |
| 合并 | 直接 merge | 需要 fetch origin + merge |
| 磁盘 | 共享 .git 对象库 | 两份完整 .git |
| 适合场景 | 同一人并行开发 | 完全隔离的实验 |

## 关键规则

### 1. 分支互斥

**同一个分支不能同时被两个 worktree checkout。**

```bash
# 主目录在 main 上
git worktree add ../test main
# ❌ fatal: 'main' is already checked out
```

这是保护机制——防止两边同时 commit 到同一个分支导致状态混乱。

### 2. commit 实时同步

worktree A 里 commit 了，worktree B 里 `git log that-branch` 立刻能看到。因为它们共享同一个 `.git` 数据库，没有网络延迟。

### 3. node_modules 各自独立

每个 worktree 是独立的文件系统目录，`node_modules` 不共享。新建 worktree 后需要：

```bash
cd ../new-worktree
npm install    # 或 pnpm install / bun install
```

### 4. .gitignore 共享

因为 `.gitignore` 是仓库文件的一部分，所有 worktree 的忽略规则一致。

## 实战场景

### 场景 1：改自身项目的前端（ProjectPilot 工作流）

主实例跑在 `config/dev-server.json` 所设前端端口（当前默认 4287），直接改源码会触发 HMR 影响使用。

```bash
# 创建 worktree
git worktree add .claude/worktrees/dev -b dev

# 进入、安装、启动
cd .claude/worktrees/dev
npm install
PORT=4010 npm run dev

# 在 4010 端口验证改动...

# 改好后回主目录合并
cd /path/to/projct-pilot
git merge dev
git worktree remove .claude/worktrees/dev
git branch -d dev
```

### 场景 2：紧急修 bug

正在 feature 分支开发新功能，突然要修一个线上 bug：

```bash
# 不需要 stash，直接开 worktree
git worktree add ../hotfix -b hotfix/critical-bug origin/main

cd ../hotfix
# 修 bug、测试、commit、push
git push origin hotfix/critical-bug

# 回来继续开发，feature 分支的代码从头到尾没动过
cd ../my-repo
git worktree remove ../hotfix
```

### 场景 3：同时对比两个分支的运行效果

```bash
git worktree add ../branch-a branch-a
git worktree add ../branch-b branch-b

# 终端 1
cd ../branch-a && npm run dev -- --port 3001

# 终端 2
cd ../branch-b && npm run dev -- --port 3002

# 浏览器同时打开两个端口对比
```

## 常见问题

### Q: 删了 worktree 的文件夹怎么办？

```bash
git worktree prune   # 清理无效引用
```

### Q: worktree 里能执行所有 git 命令吗？

能。`commit`、`push`、`pull`、`rebase`、`log` 全部正常。它就是一个普通的工作目录，只是 `.git` 指向共享的仓库。

### Q: worktree 数量有限制吗？

没有硬限制，想开多少开多少。但每个都要独立 `npm install`，磁盘和内存要考虑。

### Q: 主 worktree 能删吗？

不能。主 worktree（最初 clone/init 的那个目录）不能被 remove，只能删除附加的 worktree。

## 速查

```bash
git worktree add <path> -b <branch>   # 创建新分支 + worktree
git worktree add <path> <branch>      # 用已有分支创建 worktree
git worktree list                      # 查看所有 worktree
git worktree remove <path>            # 删除 worktree
git worktree prune                    # 清理无效引用
```

## 另见

- [UI 工作流程对比实验（Agents）](./ui-workflow-experiment.md) — 用多个 worktree 并行试不同设计流程终点并截图评估。
