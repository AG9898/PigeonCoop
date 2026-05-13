---
name: start-task
description: Execute one workboard task end-to-end with strict dependency checks, targeted board updates, verification, and doc concurrency.
version: 1.0.0
---

# Start Task

Use this skill to complete exactly one task from `docs/workboard.json`.

## Workflow

1. Read the repo instruction dispatcher first (`CLAUDE.md`).
2. Select next startable task using the same startability rules as `/query-workboard`.
3. If no startable task exists, report blocked items and stop.
4. Load only the chosen task record.
5. Claim the task by updating status `todo -> in_progress` with a targeted edit.
6. Read every existing file in task `docs[]` and `files[]` before editing code.
7. Implement only what `description` + `acceptance_criteria` require.
8. Run task `commands[]` as preferred verification.
9. Add minimum extra validation needed for changed surface if commands are absent/incomplete.
10. Update authoritative docs affected by behavior changes.
11. Mark task `done` only after verification passes.
12. Summarize: task, files changed, validations, docs updated, next startable tasks.

## Startability Query

```bash
jq '
  (.tasks | map({(.id): .}) | add) as $byId |
  [.tasks[] |
    select(.status == "todo") |
    select((.blocked_by // []) | length == 0) |
    select((.depends_on // []) | map($byId[.].status == "done") | all)
  ] |
  sort_by(if .priority == "critical" then 0 elif .priority == "high" then 1 elif .priority == "medium" then 2 else 3 end) |
  .[0] | {id, title, priority, group_id, depends_on, blocked_by}
' docs/workboard.json
```

## Targeted Board Edit Rules

- Never rewrite full `docs/workboard.json`.
- Never mutate tasks other than selected task.
- Use precise patch/edit around selected task block only.
- If blocked mid-task and unresolved, set selected task back to `todo` and stop cleanly.

## Verification Rules

- Run every command in task `commands[]` unless impossible in current environment; if skipped, state why.
- Do not claim completion with failing checks.
- Prefer targeted tests/build checks over full-suite runs unless task requires full regression.

## Documentation Concurrency

- Update each doc listed in task `docs[]` when truth changed.
- Also update canonical repo docs impacted by API/schema/architecture/UX/test changes.
- Do not append active execution notes to archive-only logs.

## Guardrails

- One task per run.
- Do not bypass dependency checks.
- Do not invent deprecated board fields from older repo variants.
- Do not mark `done` before checks pass.

