# Layout Components

## Root Layout — `src/app/[locale]/layout.tsx`

Wraps all pages. Provides html, body, Inter font, ThemeProvider, ProjectProvider.

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ThemeProvider } from '@/components/theme-provider';
import { ProjectProvider } from '@/components/project-context';
import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <NextIntlClientProvider messages={messages}>
            <ProjectProvider>
              {children}
            </ProjectProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

## Flows Layout — `src/app/[locale]/flows/layout.tsx`

Main app shell for /flows/* pages. Structure:
- TopNav (header bar)
- Icon sidebar (w-13, vertical icon strip: FolderKanban, Bot, Layers, BookOpen, FileText, ListTodo, Table2, Network, Timer, Trash2)
- Expandable project panel (when not on sub-route)
- Main content area
- Right AI Planner panel (optional)

Key classes:
- Sidebar: `flex w-13 flex-col items-center border-r border-zinc-200 bg-zinc-50 py-2 gap-1 dark:border-zinc-800 dark:bg-zinc-950`
- Main: `flex-1 overflow-auto`
- On agents page: `isSubRoute=true`, project panel hidden, main shows agents page full width

## TopNav — `src/components/top-nav.tsx`

Header bar: nav links (Projects, Settings), ProjectSwitcher dropdown, AI Assistant button, LanguageSwitcher.

```tsx
<header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
  <nav>...</nav>
  <ProjectSwitcher />
  <button>AI Assistant</button>
  <LanguageSwitcher />
</header>
```

## SidebarIconButton — `src/components/sidebar-icon-button.tsx`

Single icon button in flows sidebar. Active: `bg-zinc-200 text-zinc-900`. Inactive: `text-zinc-500 hover:bg-zinc-200`.

```tsx
<button
  className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
    isActive
      ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
      : 'text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200'
  }`}
>
  <Icon className="h-5 w-5" />
</button>
```

## Agents Page Layout (self-contained)

The agents page itself has a layout:
- Left sidebar: w-72, flex flex-col, border-r
  - Tab switcher: 对话 | Agents
  - Tab content: session list OR agent list
- Right panel: flex-1, flex flex-col
  - Creating: SettingsForm or expanded prompt textarea
  - Agent selected: header + AgentChatPanel or SettingsForm
  - Session selected: session header + AgentChatPanel
  - Empty: centered message + "新建对话" button
