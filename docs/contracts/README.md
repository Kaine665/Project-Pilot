# contracts（设计契约）

某一迭代的**范围、差分、验收、非目标**。协作时优先引用 **active** 契约，避免口头需求漂移。

## 文件

- [`TEMPLATE.md`](./TEMPLATE.md)：新建契约时复制。
- [`examples/`](./examples/)：已完成示范（可仿结构，勿当真实任务源）。
- **`archive/`**（可选）：将 `completed` / `superseded` 契约移入，保留 Git 历史外的一层可读归档。

## 状态

- `draft`：起草中。  
- `active`：执行中。  
- `completed`：已交付，as-is 已核对。  
- `superseded`：由下一份契约替代，`supersedes` / 反向链接写清。
