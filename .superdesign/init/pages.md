# Docs flow — component dependency tree

## /flows/docs/:projectKey (文档)

**Entry**: `src/app/[locale]/flows/docs/[projectKey]/page.tsx`

**Dependencies**:

- `@/client/i18n/routing` — `useRouter`
- `@/components/project-context` — `useProject`
- `@/types` — `ContextEntry`, `DocEntry`, `DocStatus`
- `lucide-react` — icons
- Parent layout (not imported by page, but wraps content):
  - `src/client/routes/flows-layout.tsx`
    - `@/components/top-nav`
    - `@/components/sidebar-icon-button`
    - `@/components/ui/tooltip`
    - `@/components/project-context`
    - `@/client/i18n/routing`

## /flows/docs (index)

**Entry**: `src/app/[locale]/flows/docs/page.tsx` — redirect / empty only.
