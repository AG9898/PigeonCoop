# Example: Plan → Execute Tool → Critique → Approve

This is the canonical v1 demo workflow for Agent Arcade. It drives schema, run state, UI, replay, and event design.

## Flow

```
Start → Agent (Plan) → Tool (Execute) → Agent (Critique) → Human Review (Approve) → End
```

1. **Plan** — Agent node analyzes a repo task and produces a plan
2. **Execute Tool** — Tool node runs a build/test/lint or CLI command
3. **Critique** — Agent node evaluates the tool output
4. **Approve** — Human review node: approve, reject, or request retry

## Running

Load `workflow.json` via the Agent Arcade Library View, select a workspace root, and start the run.

## Test coverage

See `docs/TESTING.md §4` for how each test layer covers this workflow.
