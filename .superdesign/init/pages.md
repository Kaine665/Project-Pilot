# Page Dependency Trees

## /flows/agents (Agents Page)

Entry: `src/app/[locale]/flows/agents/page.tsx`

Dependencies:
- src/components/agent-chat-panel.tsx
  - src/components/ui/button.tsx
  - src/components/chat-bubble.tsx
  - src/components/chat-input.tsx
  - src/components/chat-notification-banners.tsx
  - src/components/save-knowledge-dialog.tsx
  - src/components/session-dropdown.tsx
  - src/components/guest-agent-overlay.tsx
  - src/components/session-config-panel.tsx
  - src/components/plan-viewer-panel.tsx
  - src/components/session-compress-dialog.tsx
  - src/components/agent-session-utils.ts
- src/components/agent-form.tsx
  - src/components/project-context.tsx
  - src/lib/provider-registry.ts
- src/components/agent-session-utils.ts
- src/components/project-context.tsx
- src/lib/provider-registry.ts

Parent layout (wraps agents page):
- src/app/[locale]/flows/layout.tsx
  - src/components/top-nav.tsx
    - src/components/project-context.tsx
    - src/components/language-switcher.tsx
    - src/lib/utils.ts
  - src/components/sidebar-icon-button.tsx
    - src/components/ui/tooltip.tsx
  - src/components/sortable-project-tree.tsx (dynamic, not shown on agents page)

Root layout:
- src/app/[locale]/layout.tsx
- src/app/globals.css

**Required context files for agents page design:**
- src/app/[locale]/flows/agents/page.tsx
- src/app/[locale]/flows/layout.tsx
- src/components/top-nav.tsx
- src/components/sidebar-icon-button.tsx
- src/components/agent-form.tsx (AgentIcon, SettingsForm UI)
- src/components/agent-chat-panel.tsx (simplified: header, input area, message list area)
- src/components/ui/button.tsx
- src/components/ui/tooltip.tsx
- src/app/globals.css
- src/lib/utils.ts
