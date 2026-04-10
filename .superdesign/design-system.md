# ProjectPilot Dashboard — Design System

## Product Context

ProjectPilot is an AI project advancement system. Its core value: **AI gets smarter about YOUR project over time, so each interaction builds on the last.**

The Dashboard is the "home screen" — the first thing a developer sees when they open PP. It must answer in <5 seconds: "Where is my project? What happened? What's next?"

### Key Pages & Architecture
- **Dashboard (this design)**: Project overview, recent memory, progress, next steps
- **Agent Chat**: Where actual AI coding work happens
- **Memory/Knowledge**: Browse accumulated project understanding

### Target User
Solo developers or small teams using AI to build software projects. Technical, value efficiency, hate visual noise.

### Key Features (Dashboard)
1. **Yesterday Summary**: What was accomplished, decisions made, issues resolved
2. **Project Progress**: Task status, completion %, blockers
3. **Recent Memory**: Auto-accumulated knowledge entries (decisions, conventions, pitfalls)
4. **Next Steps**: AI-recommended next actions based on progress + priority
5. **Active Sessions**: Currently running or paused agent sessions
6. **Knowledge Growth**: Visual indicator of how much the AI "knows" about the project

## Branding & Visual Direction

### Philosophy
"Functional elegance" — feels like a well-designed developer tool, not a marketing page. Every pixel earns its place. Information density is high but never cluttered.

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0F1117` | Main background (dark) |
| `--bg-secondary` | `#161922` | Card/panel backgrounds |
| `--bg-tertiary` | `#1C2030` | Hover states, elevated surfaces |
| `--border` | `#2A2E3B` | Default borders |
| `--border-subtle` | `#1E2231` | Subtle dividers |
| `--text-primary` | `#E8EAED` | Primary text |
| `--text-secondary` | `#8B8FA3` | Secondary/muted text |
| `--text-tertiary` | `#5C6070` | Timestamps, metadata |
| `--accent-blue` | `#3B82F6` | Primary actions, active states |
| `--accent-green` | `#22C55E` | Success, completed, growth |
| `--accent-amber` | `#F59E0B` | Warnings, in-progress |
| `--accent-red` | `#EF4444` | Errors, blockers |
| `--accent-purple` | `#A855F7` | AI/memory related elements |

### Typography

| Element | Font | Size | Weight | Tracking |
|---------|------|------|--------|----------|
| Page title | Inter | 24px | 600 | -0.02em |
| Section header | Inter | 14px | 600 | 0 |
| Card title | Inter | 13px | 500 | 0 |
| Body text | Inter | 13px | 400 | 0 |
| Metadata/label | Inter | 11px | 500 | 0.02em |
| Code/mono | JetBrains Mono | 12px | 400 | 0 |
| Stat number | Inter | 28px | 700 | -0.02em |

### Spacing & Layout

- Base unit: 4px
- Card padding: 16px (compact) / 20px (standard)
- Card gap: 12px
- Section gap: 24px
- Border radius: 8px (cards), 6px (buttons/badges), 4px (tags)
- Max content width: 1200px

### Component Patterns

#### Cards
- Background: `--bg-secondary`
- Border: 1px solid `--border`
- Border-radius: 8px
- Subtle glow on hover: 0 0 0 1px `--accent-blue` at 20% opacity
- No drop shadows

#### Status Badges
- Completed: green bg at 10% opacity, green text
- In Progress: amber bg at 10% opacity, amber text
- Blocked: red bg at 10% opacity, red text
- Pending: gray bg at 10% opacity, gray text

#### Progress Indicators
- Thin horizontal bars (4px height, rounded)
- Track: `--bg-tertiary`
- Fill: gradient from `--accent-blue` to `--accent-purple`

#### Memory Entries
- Left color bar (3px width) indicating type:
  - Decision: blue
  - Convention: purple
  - Pitfall: amber
  - Change: green
- Compact list items with timestamp + one-line summary

#### Stat Cards
- Large number prominently displayed
- Small label above
- Optional sparkline or trend indicator
- Subtle icon in top-right corner

### Motion & Animation
- Transitions: 150ms ease-out
- No decorative animations
- Subtle fade-in for newly loaded content
- Progress bars animate on initial load (600ms ease-out)

### Layout Structure (Dashboard)
- Top bar: minimal, project name + project switcher + settings
- Main area: responsive grid layout
  - Left column (2/3): Summary + Progress + Next Steps
  - Right column (1/3): Memory + Knowledge Stats + Sessions
- No sidebar navigation on dashboard (it's the landing page)

### Icons
- Lucide icon set
- Size: 16px default, 14px for compact contexts
- Stroke width: 1.5px
- Color inherits from text color

### Dark Mode Only
This design is dark-mode only. The dark palette reduces eye strain for developers who spend hours in code editors.
