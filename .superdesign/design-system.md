# ProjectPilot / develop-static — Design system (SuperDesign)

## Product context

- **Product**: ProjectPilot (PP) — desktop-first workspace for projects, agents, docs, and context assets.
- **This screen**: **文档** (`/flows/docs/:projectKey`) — unified library for **设计文档** and **上下文** assets: search, type/scope filters, list + detail/editor split, stats hero, project selector.
- **Shell**: `TopNav` + narrow icon **sidebar** (`w-13`) + `main` scroll area; optional right **Butler** panel (360px).

## Visual language (must not drift)

- **Font**: `system-ui, -apple-system, sans-serif` (see `globals.css` body).
- **Radius**: large soft cards — `rounded-2xl` / `rounded-3xl` on panels; inputs `rounded-2xl`.
- **Neutrals**: zinc scale — `zinc-50`…`zinc-950`, borders `border-zinc-200` / `dark:border-zinc-800`.
- **Accents**: doc type **violet**, context type **sky** (badges on list rows). Destructive actions **rose**.
- **Semantic CSS variables** (Tailwind v4 `@theme`): `--color-ai`, `--color-user`, etc. — use for AI assistant chip only where relevant; docs page is mostly zinc + violet/sky.

## Layout conventions

- **Page container**: `max-w-[1380px] mx-auto`, `px-6 py-8`, vertical `gap-6`.
- **Hero section**: single top card with title, subtitle, project `<select>`, two primary actions (新建设计文档 / 新建上下文), four stat tiles in a row.
- **Below**: two-column grid `xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]` — left list, right editor or empty state.
- **List rows**: full-width buttons, `rounded-2xl`, selected row inverts to `bg-zinc-950 text-white` (dark mode: `bg-zinc-100 text-zinc-950`).
- **Density**: marketing-style padding (`p-5`/`p-6`); **not** IDE-dense (redesign target may increase density).

## Components (reference)

- **SidebarIconButton**: 40×40, `rounded-lg`, active = filled zinc inverse.
- **TopNav**: `border-b`, `px-6 py-3`, segment nav pills.
- Docs page uses mostly native `<button>`, `<input>`, `<select>`, `<textarea>` with Tailwind — no heavy shadcn on this page.

## Redesign goal (for iteration prompts)

Explore **desktop application** patterns: fixed chrome, **master–detail** or **three-pane**, optional **toolbar**, **resizable** panes (visual suggestion), higher information density, less “landing page” hero — while **keeping** the existing color tokens and font stack above.
