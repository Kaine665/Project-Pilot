# Extractable components

## TopNav
- Source: `src/components/top-nav.tsx`
- Category: layout
- Description: Top bar with nav, project switcher, AI assistant, locale
- Extractable props: plannerOpen (boolean)
- Hardcoded: labels via i18n, structure, classes

## SidebarIconButton
- Source: `src/components/sidebar-icon-button.tsx`
- Category: basic
- Description: Icon rail button with tooltip
- Extractable props: isActive (boolean)
- Hardcoded: size, radius, icon slot

## FlowsLayout shell (sidebar rail)
- Source: `src/client/routes/flows-layout.tsx`
- Category: layout
- Description: Icon sidebar + main outlet
- Extractable props: active route indicators (conceptual)
- Hardcoded: icon set, routing targets
