# How Could Agents Work Independently?

## Core Question

When multiple agents execute tasks in parallel on the same codebase, when do they need coordination and when don't they?

## The Principle

One criterion: **whether their change sets overlap in the dependency graph**.

If two agents' modifications — including all files they touch and the upstream/downstream dependencies of those files — have zero intersection, they can work independently. Otherwise, they need coordination.

## When Coordination Is NOT Needed

**Changes are completely disjoint**: the files each agent modifies, and the transitive dependencies of those files, have no overlap.

Examples:

- Agent A works on `/src/user/`, Agent B works on `/src/payment/`, and there's no import relationship between the two modules
- Agent A writes unit tests, Agent B writes documentation
- Agent A modifies one standalone page, Agent B modifies another, and they share no components

In these cases, merging branches won't conflict, and the merged code won't break.

## When Coordination IS Needed

### 1. Same File — the obvious conflict

Two agents both need to modify `package.json`, `globals.css`, or a shared `utils.ts`. Git will report merge conflicts.

### 2. Shared Interface — no conflict but broken code

Agent A changes `getUser(id: string)` to `getUser(id: string, options?: Options)`. Agent B still calls the old signature. Git merge succeeds (different lines changed), but the merged code is broken.

**This is the most dangerous case** because git won't tell you about it.

### 3. Implicit Coupling — invisible dependencies

- Shared database schema (A adds a column, B's queries don't account for it)
- Shared global state (Redux store, CSS variables, environment variables)
- Shared routing tables, event names, configuration formats

## Implication for Task Decomposition

To enable agents to work without coordination, **task boundaries must be cut along the weak connections in the dependency graph**.

The person decomposing tasks (in ProjectPilot's model, the human using the Flow tree) is implicitly making this judgment: can these two subtasks be done independently?

- **Good split**: cut at module boundaries where coupling is minimal
- **Bad split**: "modify user table schema" and "modify user API" as parallel tasks — these have hard dependencies

## Conclusion

The core challenge isn't "how to build communication channels between agents." It's "**can we determine at decomposition time whether two tasks have dependencies?**"

If dependencies exist, either:

1. **Don't parallelize** — execute them sequentially
2. **Define the interface contract first** — agree on the shared boundary, then let each agent work independently against that contract
