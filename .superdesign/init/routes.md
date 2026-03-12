# Routes

Framework: Next.js 16 (App Router, file-based routing)

## Route Structure

| URL Path | Component | Layout |
|----------|-----------|--------|
| `/` | redirect to /flows | locale layout |
| `/flows` | projects page | flows layout |
| `/flows/projects` | projects page | flows layout |
| `/flows/agents` | **Agents page** (target) | flows layout |
| `/flows/dimensions` | dimensions page | flows layout |
| `/flows/context` | context page | flows layout |
| `/flows/docs` | docs index | flows layout |
| `/flows/docs/[key]` | docs detail | flows layout |
| `/flows/todos` | todos page | flows layout |
| `/flows/bitable` | bitable page | flows layout |
| `/flows/orchestrator` | orchestrator page | flows layout |
| `/flows/schedules` | schedules page | flows layout |
| `/flows/recycle-bin` | recycle bin page | flows layout |
| `/flows/butler` | butler page | flows layout |
| `/settings` | settings page | locale layout |

## Key Pages Summary

- **Agents** (`/flows/agents`): Agent management + chat. Left sidebar: Conversations tab (session list) / Agents tab (agent list). Right panel: chat or settings form. Supports multi-session tabs.
- **Projects** (`/flows/projects`): Project tree, sections, main flows hub.
- **TopNav**: Header with nav links, project switcher, AI assistant button.

## Layout Hierarchy

1. `src/app/[locale]/layout.tsx` — Root: html, body, Inter font, ThemeProvider, ProjectProvider
2. `src/app/[locale]/flows/layout.tsx` — Flows: TopNav, icon sidebar (Bot, Layers, etc.), expandable project panel, main content area
