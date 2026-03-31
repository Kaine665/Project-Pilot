# develop-static — Design system (settings / AI)

## Product
Desktop-style web app: zinc neutral palette, light/dark, cards with border + shadow-sm.

## Typography
- UI: system / sans, `text-sm` body, `text-xs` hints, `text-lg font-semibold` card titles.

## Colors (Tailwind zinc + semantic)
- Background: `bg-white` / `dark:bg-zinc-950`
- Borders: `border-zinc-200` / `dark:border-zinc-800`
- Muted text: `text-zinc-500`, secondary `text-zinc-600` / `dark:text-zinc-400`
- Active pill/button: `bg-zinc-900 text-white` / `dark:bg-zinc-100 dark:text-zinc-900`
- Inactive outline control: `border border-zinc-200 text-zinc-600 hover:bg-zinc-50` + dark variants
- Success: `text-green-600 dark:text-green-400`
- Error: `text-red-600 dark:text-red-400`
- AI accent (top nav CTA only): `bg-ai-subtle text-ai` (purple family from CSS vars)

## Components
- **Card**: `rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950`
- **CardHeader**: `p-4`, **CardTitle**: `text-lg font-semibold`, **CardContent**: `p-4 pt-0 space-y-*`
- **Input**: h-9, rounded-md, border zinc, px-3, text-sm
- **Button outline**: border zinc, sm size h-7 text-xs
- **Settings layout**: `max-w-[1100px] mx-auto px-6 py-8`, left nav `w-52`, content `pl-8 border-l border-zinc-200`, vertical `space-y-6`

## Icons
Lucide outline, h-4 w-4 in nav, h-5 w-5 in card titles.

## Rules for this task
- Do **not** introduce new fonts, neon colors, or gradients outside zinc + existing semantic colors.
- **Fixed chrome** (must match current app): full-width top header with border-b; settings page title「设置」; left sidebar section list with icons; right column top border-l; bottom save row when on AI section.
- **Change area only**: the blocks for **AI 供应商选择** and **默认模型** (and their immediate helper text / sub-controls visible in the reference). Authentication card and advanced base URL may stay as in reference unless the variation explicitly redesigns provider+model strip only.
