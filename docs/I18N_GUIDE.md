# 国际化 (i18n) 使用指南

## 概述

本项目使用 `next-intl` 实现中英文双语支持。

## 已实现功能

- ✅ 中英文切换
- ✅ 路由国际化 (`/zh/*`, `/en/*`)
- ✅ 完整的翻译文件（220+ 条翻译）
- ✅ 语言切换 UI 组件
- ✅ 示例组件实现

## 目录结构

```
├── messages/               # 翻译文件
│   ├── zh.json            # 中文翻译
│   └── en.json            # 英文翻译
├── src/
│   ├── i18n.ts            # i18n 配置
│   ├── middleware.ts      # 语言路由中间件
│   ├── app/
│   │   └── [locale]/      # 国际化路由
│   │       ├── layout.tsx # 国际化布局
│   │       ├── flows/     # 流程页面
│   │       └── tasks/     # 任务页面
│   └── components/
│       └── language-switcher.tsx  # 语言切换组件
```

## 使用方法

### 1. 在客户端组件中使用

```tsx
'use client';

import { useTranslations, useLocale } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('tasks');  // 指定命名空间
  const locale = useLocale();          // 获取当前语言 'zh' | 'en'

  return (
    <div>
      {/* 基础用法 */}
      <h1>{t('title')}</h1>

      {/* 嵌套属性 */}
      <p>{t('filters.active')}</p>

      {/* 带参数 */}
      <p>{t('flows.overdueByDays', { days: 5 })}</p>

      {/* 带路由跳转 */}
      <Link href={`/${locale}/tasks`}>Tasks</Link>
    </div>
  );
}
```

### 2. 在服务端组件中使用

```tsx
import { getTranslations } from 'next-intl/server';

export default async function ServerComponent() {
  const t = await getTranslations('tasks');

  return <h1>{t('title')}</h1>;
}
```

### 3. 添加新的翻译

在 `messages/zh.json` 和 `messages/en.json` 中添加对应的键值对：

```json
// messages/zh.json
{
  "myFeature": {
    "title": "我的功能",
    "description": "这是描述"
  }
}

// messages/en.json
{
  "myFeature": {
    "title": "My Feature",
    "description": "This is description"
  }
}
```

## 翻译命名空间

翻译文件按功能模块组织：

- **nav** - 导航相关
- **status** - 状态标签
- **actions** - 操作按钮
- **tasks** - 任务模块
- **flows** - 流程模块
- **projects** - 项目管理
- **plans** - 执行计划
- **artifacts** - 产物/变更文件
- **logs** - 日志
- **chat** - 聊天对话
- **taskAgent** - 任务代理
- **suggestions** - 建议

## 带参数的翻译

翻译文本中可以使用 `{paramName}` 作为占位符：

```json
{
  "flows": {
    "overdueByDays": "已超期 {days} 天",
    "daysRemaining": "还有 {days} 天"
  }
}
```

使用时传入参数：

```tsx
t('flows.overdueByDays', { days: 5 })  // "已超期 5 天"
```

## 语言切换

用户点击右上角的语言切换按钮（地球图标 🌐）即可切换语言。

切换时会：
1. 更新 URL 路径（`/zh/*` ↔ `/en/*`）
2. 重新加载对应语言的翻译
3. 保持当前页面状态

## 需要更新的组件

以下组件包含中文文本，需要按照上述方法更新：

- [ ] artifact-viewer.tsx
- [ ] log-viewer.tsx
- [ ] plan-list.tsx
- [ ] project-registry.tsx
- [ ] plan-card.tsx
- [ ] plan-renderer.tsx
- [ ] suggestion-card.tsx
- [ ] flow-editor.tsx
- [ ] planner-chat-panel.tsx
- [ ] artifact-panel.tsx
- [ ] miller-columns.tsx
- [ ] conversation-tabs.tsx
- [ ] chat-bubble.tsx
- [ ] chat-panel.tsx
- [ ] task-detail.tsx
- [ ] flow-shared.tsx
- [ ] flow-chain.tsx

所有这些组件的翻译文本已经添加到翻译文件中。

## 示例参考

已完成 i18n 集成的组件：
- ✅ [top-nav.tsx](../src/components/top-nav.tsx)
- ✅ [task-list.tsx](../src/components/task-list.tsx)
- ✅ [flows/page.tsx](../src/app/[locale]/flows/page.tsx)

## 最佳实践

1. **始终使用翻译键**：不要在组件中硬编码文本
2. **命名规范**：使用小驼峰命名，语义清晰
3. **组织结构**：相关翻译放在同一命名空间下
4. **参数化**：动态内容使用参数传递
5. **同步更新**：中英文翻译同步维护

## 路由说明

- 中文路由：`/zh/flows`, `/zh/tasks/{id}`
- 英文路由：`/en/flows`, `/en/tasks/{id}`
- 默认语言：中文（访问 `/` 自动重定向到 `/zh`）

## 测试

启动开发服务器：
```bash
npm run dev
```

访问：
- 中文：http://localhost:4000/zh
- 英文：http://localhost:4000/en

点击右上角语言切换按钮测试切换功能。
