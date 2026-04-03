# 数据目录规范说明

## 作用

`docs/data-spec/` 不承担「本机磁盘上当前树长什么样」的完整正文。

它现在只负责三件事：
- 解释数据目录规范的设计方法
- 指向真实权威规范所在位置（含本机文件与仓库文档）
- 记录目标状态、迁移策略与实现差距

## 真相模型

- **真实真相**：真实文件夹、真实文件、真实代码、真实运行行为  
- **文档真相**：对这些对象的说明

**分层权威**：

| 层次 | 位置 | 内容 |
|------|------|------|
| 目录目标规范 | 本机 `~/.project-pilot/README.md` | 一级域、目标结构（不在 Git） |
| 迁移与现实 | 本机 `~/.project-pilot/数据文件夹现状.md` | 各域是否已迁、备份、代码是否适配（不在 Git） |
| 代码默认根与环境变量 | **[`docs/data-storage.md`](../data-storage.md)** + `src/lib/file-store.ts` | `PROJECT_PILOT_DATA_DIR`；未设置时默认 **`~/.project-pilot`**（不再使用 `~/.project-pilot/data` 作为默认根） |

**对齐日期**：2026-03-31。

各域子目录内的 `README.md`（如 `agents/README.md`）以本机 `.project-pilot/` 下实际文件为准；路径随机器变化，仓库不镜像全文。

## 为什么这里只保留索引

规范更偏向目标状态，而实现经常处在变化中。
因此仓库里的 `docs/data-spec/` 更适合扮演：

- 设计入口
- 迁移记录
- 差距追踪
- 导航索引

而不是再复制一整套与真实目录并列的规范正文。

## 规则

- **磁盘布局与迁移进度**：以本机 **`数据文件夹现状.md`**（及 `~/.project-pilot/README.md`）为准。  
- **环境变量与未设置时的默认 `DATA_DIR`**：以 [`docs/data-storage.md`](../data-storage.md) 与 `file-store.ts` 为准。  
- 本目录追踪「代码实现 vs 本机目标」的差距，须标注日期。

## 后续用途

后续如果我们需要记录这些内容，优先放在这里：

- 当前实现与目标状态的差距
- 迁移计划
- 兼容期说明
- 代码路径与真实目录的映射关系

## 域规范索引（仓库内）

| 域 | 文档 |
|----|------|
| **projects**（`projects/index.json`） | **[projects/README.md](./projects/README.md)** |

## 当前建模共识

设计向「单对象单文件」收敛；**具体域名与相对路径**以本机 `README.md` / **`数据文件夹现状.md`** 为准（例如 todo 可能已在 `todos/entries/`，而非旧式 `tasks/todos.json`）。

- 对顶级业务对象，优先采用 `xxxs/<xxxId>.json`（或域内 `entries/<id>.json` 等，以规范为准）

示例（示意，非强制等同本机当前树）：

- `agents/definitions/<agentId>.json`
- `agents/bindings/<bindingId>.json`
- `todos/entries/<todoId>.json`（若已按域迁移）

如果对象主体是大文本、转录或附件，则采用：

- 一个对象元数据文件
- 若干 sidecar 内容文件

也就是：

- 对象本体尽量 JSON 化
- 大文本正文和附件独立存放
