# ProjectPilot Agents API

> Machine-oriented REST API for managing ProjectPilot agents from external systems.

Base URL: `http://localhost:4000` (or your configured port)

## Quick Start

```bash
# List all agents
curl http://localhost:4000/api/agents/official

# Get a specific agent by slug
curl "http://localhost:4000/api/agents/official?slug=butler&includePrompt=true"

# Get a specific agent by ID
curl "http://localhost:4000/api/agents/official?id=agent-1772179200000-chat"

# Create a new agent
curl -X POST http://localhost:4000/api/agents/official \
  -H "Content-Type: application/json" \
  -d '{
    "action": "upsert",
    "agent": {
      "name": "My Agent",
      "description": "Does cool things",
      "systemPrompt": "You are a helpful assistant.",
      "capabilities": { "bash": true, "fileAccess": true, "web": false, "subAgent": false, "skipReview": false }
    }
  }'

# Update an existing agent (match by slug)
curl -X POST http://localhost:4000/api/agents/official \
  -H "Content-Type: application/json" \
  -d '{
    "action": "upsert",
    "match": { "slug": "butler" },
    "agent": { "description": "Updated description" }
  }'

# Archive (soft-delete) an agent
curl -X POST http://localhost:4000/api/agents/official \
  -H "Content-Type: application/json" \
  -d '{
    "action": "archive",
    "match": { "id": "agent-1772179200000-chat" }
  }'
```

## Endpoints

### `GET /api/agents/official`

List all agents or get a single agent by `id` or `slug`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | string | - | Get single agent by ID |
| `slug` | string | - | Get single agent by slug (built-in agents only) |
| `includeArchived` | "true"/"false" | "false" | Include soft-deleted agents |
| `includePrompt` | "true"/"false" | "false" | Include full `systemPrompt` (can be large) |
| `projectKey` | string | - | Filter by project (e.g. "elapp") |

**Response** (list):
```json
{ "ok": true, "agents": [{ "id": "...", "name": "...", ... }] }
```

**Response** (single):
```json
{ "ok": true, "agent": { "id": "...", "name": "...", ... } }
```

### `POST /api/agents/official`

Unified write endpoint. The `action` field determines the operation.

#### Action: `upsert`

Create or update an agent.

```json
{
  "action": "upsert",
  "match": { "id": "..." },
  "createIfMissing": true,
  "agent": {
    "name": "Agent Name",
    "description": "...",
    "systemPrompt": "...",
    "icon": "bot",
    "capabilities": { "bash": true, "fileAccess": true, "web": false, "subAgent": false, "skipReview": false },
    "projectKey": "project-pilot",
    "triggerHints": ["when to call this agent"],
    "defaultProvider": "anthropic",
    "defaultModel": "claude-sonnet-4-20250514"
  }
}
```

- **`match`** (optional): Find existing agent by `id` or `slug`. If omitted or no match, creates new.
- **`createIfMissing`** (default: `true`): Set to `false` for update-only mode (returns 404 if no match).
- **`agent.name`**: Required when creating, optional when updating.

**Response**:
```json
{ "ok": true, "action": "upsert", "created": true, "updated": false, "agent": { ... } }
```

#### Action: `archive`

Soft-delete an agent. Built-in agents cannot be archived (returns 403).

```json
{
  "action": "archive",
  "match": { "id": "agent-xxx" }
}
```

**Response**:
```json
{ "ok": true, "action": "archive", "agent": { ... } }
```

### `GET /api/agents/export/{id}`

Download an agent as a `.ppagent` JSON package (includes prompt, context refs).

```bash
curl -o my-agent.ppagent http://localhost:4000/api/agents/export/agent-xxx
```

### `POST /api/agents/import`

Import a `.ppagent` package to create a new agent.

```bash
curl -X POST http://localhost:4000/api/agents/import \
  -H "Content-Type: application/json" \
  -d @my-agent.ppagent
```

**Response**:
```json
{ "ok": true, "agent": { ... }, "contextsImported": 2 }
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AGENT_NOT_FOUND` | 404 | No agent matches the given id/slug |
| `INVALID_REQUEST` | 400 | Missing required fields (e.g. `agent` payload or `name` on create) |
| `INVALID_ACTION` | 400 | Unsupported action (only `upsert` and `archive` are supported) |
| `BUILTIN_AGENT` | 403 | Built-in agents cannot be archived |

Error response format:
```json
{ "ok": false, "error": { "code": "AGENT_NOT_FOUND", "message": "Agent not found" } }
```

## Agent Schema

Key fields on the `Agent` object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated unique ID |
| `name` | string | Display name |
| `slug` | string? | Stable identifier for built-in agents |
| `builtIn` | boolean? | System agent flag (cannot be deleted) |
| `description` | string? | Role description |
| `systemPrompt` | string? | Full instructions (only with `includePrompt=true`) |
| `icon` | string? | Lucide icon name |
| `capabilities` | object? | Tool permissions (`bash`, `fileAccess`, `web`, `subAgent`, `skipReview`, `todoRead`, `exposePromptPath`, `dataStore`) |
| `triggerHints` | string[]? | When other agents should delegate to this one |
| `projectKey` | string? | Owning project (undefined = global) |
| `defaultProvider` | string? | Default AI provider (`anthropic`, `openai`, `gemini`, `deepseek`, `openrouter`) |
| `defaultModel` | string? | Default model ID |
| `archived` | boolean? | Soft-deleted flag |
| `createdAt` | string | ISO 8601 timestamp |

## OpenAPI Schema

Full OpenAPI 3.1 schema available at: [`/api-docs/agents-official.yaml`](/api-docs/agents-official.yaml)

## Notes

- This is a **local-only** API with no authentication. Do not expose to the internet.
- The `systemPrompt` field can be very large. Only request it when needed (`includePrompt=true`).
- MCP integration is planned but not yet implemented.
- The internal UI uses `/api/agents` (without `/official`). The `/official` endpoint has a more structured request/response format designed for programmatic use.
