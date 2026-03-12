# Extractable Components

## Layout Components

### TopNav
- Source: `src/components/top-nav.tsx`
- Category: layout
- Description: Main header with nav links, project switcher, AI assistant button
- Extractable props: activeItem (string), showPlanner (boolean)
- Hardcoded: Logo, nav items text, icon names, all CSS

### SidebarIconButton
- Source: `src/components/sidebar-icon-button.tsx`
- Category: layout
- Description: Single icon button in flows sidebar strip
- Extractable props: isActive (boolean), tooltip (string)
- Hardcoded: Icon component, all CSS

### AgentsSidebar
- Source: `src/app/[locale]/flows/agents/page.tsx` (lines 531-702)
- Category: layout
- Description: Left sidebar with Conversations/Agents tabs, session list, agent list
- Extractable props: sidebarTab (conversations|agents), activePanel (agent|session|null)
- Hardcoded: Tab labels, list item structure, icons

## Basic Components

### AgentIcon
- Source: `src/components/agent-form.tsx`
- Category: basic
- Description: Renders agent icon by key (Bot, Brain, etc.)
- Extractable props: iconKey (string)
- Hardcoded: ICON_MAP, icon components

### AgentCard (inline in agents list)
- Source: `src/app/[locale]/flows/agents/page.tsx` (lines 668-699)
- Category: basic
- Description: Agent list item with icon, name, badges, description
- Extractable props: active (boolean), name, description, builtIn, projectKey, activeKey
- Hardcoded: ChevronRight, border styles

### SessionListItem
- Source: `src/app/[locale]/flows/agents/page.tsx` (lines 603-634)
- Category: basic
- Description: Session list item with agent icon, title, agent name, unread badge, archive button
- Extractable props: isActive (boolean), archived (boolean), unreadCount (number)
- Hardcoded: Archive/ArchiveRestore icons, structure
