# Git 分支策略与 GitHub 权限（维护者清单）

[中文](#中文) | [English](#english)

---

## 中文

本文约定 **ProjectPilot 主仓库** 的分支语义，以及如何在 GitHub 上**用规则限制越权推送**，使「文档里写的流程」与「平台上能做的事」一致。

**贡献者日常怎么拉分支、往哪开 PR**：见 **[`CONTRIBUTING.md`](../CONTRIBUTING.md)**。

### 1. 分支语义（统一使用）

| 分支 | 含义 |
|------|------|
| **`main`** | **稳定、可对外说明的版本**（可打 tag / 发 release）。不作为日常堆砌提交的集成线。 |
| **`next`** | **日常集成线**：当前迭代的功能合并到这里；CI 应在此保持通过。 |
| **`feature/<简述>`** | 单个功能或任务；**从 `next` 拉出**，完成后 **PR → `next`**。 |
| **`hotfix/<简述>`** | **稳定线紧急修复**：**从 `main` 拉出**，修复后 **PR → `main`**，**同一修复必须再进入 `next`**（merge 或 cherry-pick，二选一由维护者记录）。 |

**不推荐使用**：名为 `test`、`dev`、`develop` 等语义模糊、与上表重复的长期分支（避免「到底哪条是集成线」的歧义）。

### 2. 日常开发流程（与远端一致）

1. `git fetch origin`
2. `git checkout next && git pull origin next`
3. `git checkout -b feature/short-description`
4. 开发与本地自测后：`git push -u origin feature/short-description`
5. 在 GitHub 上开 PR：**base = `next`**（除非本条为 hotfix，见下）
6. 合并后：可删除远端 `feature/*`（可选）

**Hotfix**：从 `main` 拉 `hotfix/...` → PR **into `main`** → 再将该提交合入 **`next`**，避免下一版丢修复。

**发版**：将已验收的 `next` **合并入 `main`**（或 PR `next` → `main`），在 `main` 上打 tag（与现有 [`release.yml`](../.github/workflows/release.yml) 的 `v*` tag 流程一致）。

### 2.1 `main` 与 `next` 对齐（避免协作各说各话）

日常改动落在 **`next`** 时，若 **`main` 长期不更新**，会出现「有人以 `main` 为准、有人以 `next` 为准」的割裂。**应在里程碑或发版前把 `next` 合入 `main`**，并在团队内说明当前以哪条线为默认参照。

当 **`main` 受 Rulesets 限制、禁止直推**（`Changes must be made through a pull request`）时，**不能** `git push origin main`。可选用：

1. **GitHub 上直接 PR**：**base = `main`**，**compare = `next`**（无不可合并冲突时，这是最简路径）。
2. **本地合并再推临时分支**：`git fetch origin && git checkout main && git pull origin main && git merge origin/next`，再执行  
   `git push origin main:chore/sync-main-from-next-<日期>`，  
   然后对 **`main`** 开 PR（将临时分支合入 `main`）。

**默认分支（GitHub）**：若日常协作以 **`next`** 为真·集成线，可在 **Settings → General → Default branch** 把默认分支设为 **`next`**，让新克隆、新 PR 的直觉基线与文档一致；**`main`** 仍可作为稳定 / 发版线保留，二者职责不矛盾。

### 3. GitHub 上建议开启的约束（防越权）

以下在 **Settings → Rules → Rulesets**（推荐）或 **Settings → Branches → Branch protection rules**（经典）中配置。团队规模小时也建议尽早打开，避免误推。

#### 3.1 `main`

建议全部勾选（按仓库实际情况微调）：

- **Restrict pushes**：禁止直接 push；仅允许通过 **Pull Request** 合并进入 `main`。
- **Require a pull request before merging**
  - **Required approvals**：至少 **1**（核心维护者可按需要设为 2）。
  - **Dismiss stale pull request approvals when new commits are pushed**：建议开启。
- **Require status checks to pass**（若已有 CI）：勾选具体 job（如 `build` / `lint` / `test`）。
- **Require conversation resolution before merging**（可选）：有 review 对话时全部 resolved 才能合并。
- **Require linear history**（可选）：偏好清晰历史时开启；注意与 merge commit 策略的取舍。
- **Include administrators**：建议 **开启**，否则 Owner 仍可绕过，规则形同虚设。
- **Allow force pushes**：**关闭**
- **Allow deletions**：**关闭**

#### 3.2 `next`

与 `main` 类似，可略放宽：

- **Restrict pushes**：同样建议禁止直推，**一律经 PR 合并**（单人团队若效率不足，可仅保护 `main`，但需在团队内约定 `next` 也不直推）。
- **Require pull request**：建议开启；审批人数可为 **0～1**（小团队可 0，仍保留 PR 留痕）。
- **Require status checks**：强烈建议与 `main` 或子集一致，避免集成线长期红。
- **Force push / deletion**：**关闭**

#### 3.3 `feature/*` 与 `hotfix/*`

- 一般不单独建「分支保护规则」（否则推送都成问题）。
- 通过 **PR 目标分支**（`next` 或 `main`）受保护，即可约束最终入库路径。

#### 3.4 仓库级其它设置（建议核对）

| 设置路径 | 建议 |
|----------|------|
| **Settings → General → Collaborators** | 仅邀请需要写权限的成员；外部贡献者用 **Fork + PR**，默认无写权限。 |
| **Settings → Actions → General** | 明确 **Workflow permissions**（如 `GITHUB_TOKEN` 只读或按需写）；避免随意 `contents: write` 扩散。 |
| **Settings → Actions → Fork pull request workflows** | Fork PR 是否跑 CI：按需开启；注意密钥不要泄漏给不可信 fork。 |
| **Organization / Repo rulesets** | 若使用 Org，可用 **org 级 ruleset** 统一多条仓库的 `main` 规则。 |

#### 3.5 可选：合并方式

在仓库 **Settings → General → Pull Requests**：

- **Allow merge commits** / **Squash** / **Rebase**：团队选一种默认即可；与「线性历史」规则配合时需注意兼容性。

### 4. 落地检查清单（维护者自检）

- [ ] 远端已存在 `next`，且与团队说明「默认集成线」一致。
- [ ] `main`、`next` 已配置 ruleset 或 branch protection（含 **Include administrators**）。
- [ ] 默认 PR 基分支在团队习惯上指向 **`next`**（GitHub 可在开 PR 时选；文档与模板已写明）。
- [ ] Hotfix 流程已口头或文档约定：**合 `main` 后必回灌 `next`**。
- [ ] Release/tag 仍从 **`main`**（或与 tag 指向的 commit 一致）触发。

### 5. 变更记录

| 日期 | 摘要 |
|------|------|
| 2026-03-31 | 初版：`main` / `next` / `feature/*` / `hotfix/*` 与 GitHub 权限清单 |
| 2026-03-31 | 增补英文对照节 |
| 2026-03-31 | 增加 §2.1：`main` 受保护时与 `next` 对齐、默认分支说明 |

---

## English

This document defines **branch semantics** for the **ProjectPilot** main repository and **how to configure GitHub** so written workflow matches what people can actually do on the platform.

**Contributor day-to-day branching and PR targets**: see **[`CONTRIBUTING.md`](../CONTRIBUTING.md)**.

### 1. Branch semantics

| Branch | Meaning |
|--------|---------|
| **`main`** | **Stable, releasable** (tags/releases). Not the day-to-day integration line. |
| **`next`** | **Integration line** for the current iteration; CI should stay green here. |
| **`feature/<short-name>`** | **Branch from `next`**, finish work via **PR → `next`**. |
| **`hotfix/<short-name>`** | **Branch from `main`**, **PR → `main`**, then **land the same fix on `next`** (merge or cherry-pick—record the choice). |

**Avoid** vague long-lived branches such as `test`, `dev`, or `develop` that duplicate the role of `next`.

### 2. Daily workflow (remote-aligned)

1. `git fetch origin`
2. `git checkout next && git pull origin next`
3. `git checkout -b feature/short-description`
4. After local work: `git push -u origin feature/short-description`
5. Open a PR on GitHub: **base = `next`** (except hotfixes—see below)
6. Optionally delete remote `feature/*` after merge

**Hotfix**: branch `hotfix/...` **from `main`** → PR **into `main`** → **merge/cherry-pick into `next`** so the next release does not drop the fix.

**Release**: merge reviewed **`next` into `main`** (or PR `next` → `main`), tag on `main` (consistent with [`release.yml`](../.github/workflows/release.yml) `v*` tags).

### 2.1 Keep `main` aligned with `next` (shared baseline)

If day-to-day work lands on **`next`** but **`main` is left behind**, people will disagree on the source of truth. **Before milestones or releases, merge `next` into `main`** and tell the team which branch is the default reference.

When **`main` is protected** and rejects direct pushes (`Changes must be made through a pull request`), you **cannot** `git push origin main`. Options:

1. **PR on GitHub**: **base = `main`**, **compare = `next`** (simplest when GitHub allows a clean merge).
2. **Merge locally, then push a side branch**: `git fetch origin && git checkout main && git pull origin main && git merge origin/next`, then  
   `git push origin main:chore/sync-main-from-next-<date>`  
   and open a PR **into `main`** from that branch.

**Default branch (GitHub)**: If **`next`** is the real integration line, set **Settings → General → Default branch** to **`next`** so clones and PRs match your docs. **`main`** can remain the stable/release line; roles stay distinct.

### 3. Recommended GitHub constraints (prevent bypass)

Configure via **Settings → Rules → Rulesets** (preferred) or **Settings → Branches → Branch protection rules**.

#### 3.1 `main`

Recommended (tune as needed):

- **Restrict pushes**: no direct pushes; changes land via **pull requests**.
- **Require a pull request before merging**
  - **Required approvals**: at least **1** (2 for stricter teams).
  - **Dismiss stale approvals on new pushes**: recommended.
- **Require status checks to pass** when CI exists (`build` / `lint` / `test`, etc.).
- **Require conversation resolution** (optional).
- **Require linear history** (optional; watch merge strategy interaction).
- **Include administrators**: **on**—otherwise owners can bypass and rules are weak.
- **Allow force pushes**: **off**
- **Allow deletions**: **off**

#### 3.2 `next`

Similar to `main`, can be slightly looser:

- **Restrict pushes**: still recommend **PR-only** (tiny teams may protect only `main`—then agree socially not to push to `next`).
- **Require pull request**: yes; approvals **0–1** for small teams.
- **Require status checks**: strongly recommended.
- **Force push / deletion**: **off**

#### 3.3 `feature/*` and `hotfix/*`

- Usually **no** separate protection rules (would block pushes).
- Protection on **`next` / `main`** as merge targets enforces the real gate.

#### 3.4 Other repository settings

| Location | Recommendation |
|----------|----------------|
| **Settings → General → Collaborators** | Grant write only where needed; external contributors **fork + PR**. |
| **Settings → Actions → General** | Tight **workflow permissions** for `GITHUB_TOKEN`; avoid unnecessary `contents: write`. |
| **Settings → Actions → Fork PR workflows** | Enable fork CI only if acceptable; protect secrets from untrusted forks. |
| **Org rulesets** | Use org-level rulesets to standardize `main` across repos. |

#### 3.5 Merge button styles

**Settings → General → Pull Requests**: pick **merge / squash / rebase** defaults consciously alongside linear-history rules.

### 4. Maintainer rollout checklist

- [ ] Remote **`next`** exists and the team agrees it is the integration line.
- [ ] **`main`** and **`next`** use rulesets or branch protection (**include administrators**).
- [ ] Default PR base in practice is **`next`** (GitHub UI + docs/templates aligned).
- [ ] Hotfix policy documented: **after `main`, backport to `next`**.
- [ ] Releases/tags still trace to **`main`** (or the tagged commit policy you use).

### 5. Change log

| Date | Summary |
|------|---------|
| 2026-03-31 | First version: branch model + GitHub permissions |
| 2026-03-31 | Added English section |
| 2026-03-31 | §2.1: sync `main` with `next` when protected; default branch note |
