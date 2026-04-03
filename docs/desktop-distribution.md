# Desktop Distribution Guide

## Goal

ProjectPilot uses a **Next.js web core + Electron shell + user-directory data** architecture so the same app can run on both Windows and macOS.

This document defines the current desktop distribution baseline.

## Supported targets

- **Windows**: NSIS installer
- **macOS**: DMG + ZIP

## Environment requirements

- Node.js 18+
- npm 9+
- Git
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`) for AI execution features
- macOS packaging: Xcode Command Line Tools recommended

Run environment diagnostics before packaging:

```bash
npm run check:env
```

## Development

### Web development

```bash
npm install
npm run check:env
npm run dev
```

Open <http://localhost:4000>

### Electron development

```bash
npm install
npm run check:env
npm run electron:dev
```

## Build pipeline

### Shared desktop build step

```bash
npm run build:desktop
```

This does three things:

1. Builds Next.js in `standalone` mode
2. Compiles Electron main/preload code
3. Bundles the sidecar server

### Windows package

```bash
npm run dist:win
```

Output target:
- NSIS installer

### macOS package

```bash
npm run dist:mac
```

Output targets:
- DMG
- ZIP

### Build everything

```bash
npm run dist:all
```

## Data storage

User data is intentionally stored outside the repository.

- **Windows**: `C:\Users\<username>\.project-pilot\data\`
- **macOS**: `/Users/<username>/.project-pilot/data/`
- **Linux**: `/home/<username>/.project-pilot/data/`

Override with:

```bash
PROJECT_PILOT_DATA_DIR=/path/to/custom/data
```

## Windows → macOS migration

If a user already has data on Windows, migrate it by copying the `data/` directory into the macOS data location.

### Windows source

```text
C:\Users\<username>\.project-pilot\data\
```

### macOS destination

```text
/Users/<username>/.project-pilot/data/
```

After copying, launch ProjectPilot on macOS. The app should continue using the migrated data.

## Notes on macOS signing

Current baseline supports local builds and internal distribution.

If you want to distribute ProjectPilot to external users, you will likely need:

- Apple Developer signing
- Notarization
- Hardened Runtime review

These are intentionally out of scope for the current MVP dual-platform plan.

## Recommended release checklist

1. `npm run check:env`
2. `npm run build:desktop`
3. `npm run dist:win` or `npm run dist:mac`
4. Install the generated package on a clean machine
5. Verify:
   - app launches
   - project list loads
   - data directory is created
   - Claude CLI health prompt behaves correctly
