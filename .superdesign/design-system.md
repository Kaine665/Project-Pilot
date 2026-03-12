# ProjectPilot Design System

## Product Context

- **Product**: ProjectPilot — AI-powered project management and execution pilot
- **Key pages**: Projects, Agents, Dimensions, Context, Docs, Todos, Bitable, Orchestrator, Schedules, Recycle Bin, Butler
- **Target page for redesign**: Agents (`/flows/agents`) — Agent management + chat interface

## Key Features (Agents Page)

- **Conversations tab**: Session list grouped by day, new session button (agent picker), archive toggle
- **Agents tab**: Agent list with create/import, agent cards (name, description, built-in/global badges)
- **Right panel**: Chat (AgentChatPanel) or Settings form, or empty state
- **Multi-session**: Multiple chat sessions can be opened, switched via sidebar

## Branding & Styling

### Colors
- **Primary grays**: Zinc scale (50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950)
- **Primary action**: zinc-900 / zinc-100 (dark/light)
- **Built-in badge**: blue-50 / blue-600 (light), blue-900/30 / blue-400 (dark)
- **Global badge**: amber-50 / amber-600 (light), amber-900/30 / amber-400 (dark)
- **Destructive**: red-500, red-50 hover
- **AI accent**: purple (color-ai: #7c3aed, color-ai-subtle: #f5f3ff)

### Typography
- **Font**: Inter (--font-inter)
- **Body**: font-sans antialiased
- **Sizes**: text-xs (10px, 12px), text-sm (14px), text-lg

### Spacing
- **Radius**: --radius 0.625rem, rounded-md (6px), rounded-lg (8px)
- **Padding**: px-2, px-3, px-4, py-1.5, py-2, py-2.5, py-3
- **Gap**: gap-1, gap-1.5, gap-2, gap-2.5, gap-3

### Layout
- **Sidebar width**: w-72 (288px) for agents page left sidebar
- **Icon strip**: w-13 (52px)
- **Border**: border-zinc-200 dark:border-zinc-800

### Components
- **Buttons**: rounded-md, p-1.5 for icon buttons, transition-colors
- **Inputs**: rounded-md border border-zinc-300, focus:ring-1 focus:ring-zinc-500
- **Cards**: rounded-lg border border-zinc-200 shadow-sm
- **Badges**: rounded-full px-1.5 py-0.5 text-[10px] font-medium

## Motion
- transition-colors for hover/active states
- No heavy animations on agents page

## Constraints for Iteration
- Use ONLY Inter font
- Use ONLY zinc/blue/amber/red palette as defined
- Keep sidebar + main panel structure
- Preserve Conversations | Agents tab structure
- Do NOT introduce serif fonts, neon colors, or purple gradients outside design system
