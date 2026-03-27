# Routes (SPA — React Router in `src/client/App.tsx`)

| Path | Page component |
|------|----------------|
| `/flows/docs` | `src/app/[locale]/flows/docs/page.tsx` — redirects to first project or empty state |
| `/flows/docs/:projectKey` | `src/app/[locale]/flows/docs/[projectKey]/page.tsx` — main 文档 UI |
| `/flows/*` | Wrapped in `src/client/routes/flows-layout.tsx` |

Full router: see `src/client/App.tsx` (lazy imports for each flow page).
