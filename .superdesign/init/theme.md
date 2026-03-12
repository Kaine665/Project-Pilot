# Theme & Design Tokens

## globals.css (Tailwind v4)

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --animate-blink-waiting: blink-waiting 1.5s ease-in-out infinite;
  --animate-blink-confirm: blink-confirm 1.5s ease-in-out infinite;
  --color-user: var(--color-user);
  --color-user-subtle: var(--color-user-subtle);
  --color-ai: var(--color-ai);
  --color-ai-subtle: var(--color-ai-subtle);
  --color-guest: var(--color-guest);
  --color-guest-subtle: var(--color-guest-subtle);
  --color-success: var(--color-success);
  --color-warning: var(--color-warning);
  --color-info: var(--color-info);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --color-user: #3b82f6;
  --color-user-subtle: #dbeafe;
  --color-ai: #7c3aed;
  --color-ai-subtle: #f5f3ff;
  --color-guest: #b45309;
  --color-guest-subtle: #fffbeb;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-info: #2563eb;
}

.dark {
  --background: oklch(0.16 0 0);
  --foreground: oklch(0.85 0 0);
  --card: oklch(0.19 0 0);
  --card-foreground: oklch(0.85 0 0);
  --popover: oklch(0.19 0 0);
  --popover-foreground: oklch(0.85 0 0);
  --primary: oklch(0.85 0 0);
  --primary-foreground: oklch(0.19 0 0);
  --secondary: oklch(0.23 0 0);
  --secondary-foreground: oklch(0.85 0 0);
  --muted: oklch(0.23 0 0);
  --muted-foreground: oklch(0.63 0 0);
  --accent: oklch(0.23 0 0);
  --accent-foreground: oklch(0.85 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 8%);
  --input: oklch(1 0 0 / 10%);
  --ring: oklch(0.5 0 0);
  --color-user: #3b82f6;
  --color-user-subtle: rgba(30, 64, 175, 0.2);
  --color-ai: #a78bfa;
  --color-ai-subtle: rgba(109, 40, 217, 0.15);
  --color-guest: #fbbf24;
  --color-guest-subtle: rgba(180, 83, 9, 0.15);
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-info: #60a5fa;
}
```

## Font

- Inter (via next/font/google, CSS variable `--font-inter`)
- body: `font-sans antialiased`

## Color Usage (Agents page)

- Zinc scale: primary grays (zinc-50, zinc-100, zinc-200, zinc-400, zinc-500, zinc-600, zinc-700, zinc-800, zinc-900, zinc-950)
- Blue: built-in badge (bg-blue-50, text-blue-600)
- Amber: global badge (bg-amber-50, text-amber-600)
- Red: destructive, unread badge
