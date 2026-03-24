# ProjectPilot Design System

## Product Context

- Product: ProjectPilot
- Page being designed: `/flows/projects`
- Product scope for this task: project management, agents dialogue, docs, skills, prompts, todos, schedules
- Core positioning: the projects page is the project-level cockpit, not a generic task editor

## Current UI Reality

- The app shell is a desktop-first workspace with TopNav, left flows sidebar, central content, and optional right AI planner
- The current projects page is dominated by inbox + section/task tree editing
- The current visual language is restrained, grayscale, utilitarian, and product-focused

## Redesign Goal

- Reframe the projects page into a "Project Cockpit"
- Make the first screen answer:
  - what this project is
  - what should be done next
  - what resources are linked
  - what automation and recent execution happened
- Keep task-tree execution as one layer, not the only layer
- Preserve ProjectPilot's visual language; improve hierarchy and product clarity, not brand style

## Functional Blocks To Support

- Project header: title, one-line objective, current phase, health/progress summary
- Project administration: visible entry for project settings and project-level CRUD
- Focus strip: 3-5 top priorities for this week
- Execution board: grouped by section, still tied to existing project task structure
- Resource summary: related docs, skills, prompts, recent agent dialogues
- Automation summary: todo counts, schedules, latest runs
- Activity feed: recent agent work and project updates

## Project-Level Management Requirements

- The projects page must expose project-level administration, not just task execution
- There must be a clear, first-class entry for:
  - project settings
  - editing project metadata
  - creating a new project
  - switching projects
  - archiving or deleting the current project
- Project configuration should cover essential metadata such as:
  - project name
  - project key
  - local path or repo path
  - related URLs or environments
  - summary/goal
  - phase or status
  - optional owner / tech stack / tags
- These controls should feel like project operations, not buried generic settings
- The cockpit homepage can summarize project config, but deeper editing can open a drawer, modal, or dedicated project settings panel
- The user should be able to understand:
  - what project they are currently in
  - where this project lives
  - how to change its config
  - how to create / switch / archive projects

## High-Volume Data Rules

- Treat the projects homepage as a decision surface, not an exhaustive management screen
- Assume large projects can have:
  - 200+ tasks
  - 30+ docs
  - 20+ todos
  - 10+ schedules
- The first viewport must summarize, prioritize, and route, not dump full structures
- Show slices only:
  - 3-5 weekly priorities
  - up to 3 risks or blockers
  - exactly 1 active section in expanded mode
  - up to 5 recent activities
  - resource summaries as counts plus 1 recent signal
- Do not show full task trees, full resource lists, or long activity feeds on the homepage
- Secondary detail should be discoverable through clear "view all" or "enter workspace" actions
- Default all non-active sections to collapsed summary rows with counts and status distribution
- The execution area should surface priority-ranked work:
  - in progress
  - blocked
  - due soon
  - recently updated
- Add filter chips or segmented views so the user can quickly narrow the active work slice
- The page should feel more valuable as data grows, not more crowded

## Branding And Styling

### Colors

- Use zinc as the dominant palette: zinc-50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950
- Primary action: zinc-900 on light, zinc-100 on dark
- Semantic accents only when needed:
  - blue for linked resources and info
  - amber for pending or scheduled work
  - emerald for healthy/progress states
  - red for risk/destructive
- No decorative gradients, neon colors, glossy effects, or marketing palettes

### Typography

- Font: Inter only
- Tone: crisp, operational, desktop-product, not editorial
- Use strong hierarchy with compact density
- Size rhythm:
  - text-xs for metadata
  - text-sm for controls/body
  - text-base for primary row content
  - text-lg and text-xl for page-level emphasis

### Spacing

- Base spacing unit: 4px
- Common rhythm: 8 / 12 / 16 / 20 / 24 / 32
- Cards should feel structured and dense enough for power users, without becoming cramped

### Radius And Shadow

- Small controls: 6-8px radius
- Cards and panels: 10-14px radius
- Shadow: subtle shadow-sm or shadow-md only
- Prefer border-led separation before stronger shadow

### Layout

- Desktop-first, max-width around 1280-1440 for the central page canvas
- Keep compatibility with the existing app shell
- Structure should read top-down:
  - summary first
  - focus next
  - execution center
  - supporting resources and activity below or to the side
- Avoid making the first viewport a wall of task-tree columns

### Components

- Buttons: restrained, rounded-md, clear active state
- Inputs: rounded-md with zinc borders and zinc focus ring
- Cards: rounded-lg or rounded-xl, light border, soft shadow
- Badges/chips: compact, rounded-full, low-saturation fills
- Section headers: title plus one-line helper text
- Summary tiles: concise label, strong value, optional helper row

## Motion

- Use only subtle state transitions
- Light hover elevation on cards
- No flashy entrance motion

## Constraints For Iteration

- Use ONLY Inter
- Use ONLY the colors and visual rules in this design system
- Keep the existing ProjectPilot shell structure recognizable
- Improve information architecture and product clarity, not stylistic novelty
- The page should feel like a project command surface for a power user
- Do not introduce serif fonts, purple-first branding, glassmorphism, glossy gradients, or marketing landing-page patterns
- Avoid creating a long scrolling wall of equal-weight cards
- Prefer strong summaries, collapsible regions, and obvious drill-down paths over raw completeness
