---
name: ralphloop
description: Monitor-only delegated loop that runs one worker per cycle against a skill/prompt and stops at `iterations:N` or `tasks:N` threshold.
version: 1.0.0
---

# Ralph Loop

This skill is for explicit delegated loop requests only.

The current agent is the monitor/orchestrator. It does not implement tasks directly.

## Invocation

`/ralphloop <skill-or-prompt> <threshold>`

Examples:

- `/ralphloop start-task iterations:3`
- `/ralphloop start-task tasks:2`
- `/ralphloop "audit docs links" iterations:1`

## Inputs

- `TASK`: skill name or quoted prompt
- `THRESHOLD`: `iterations:N` or `tasks:N`

If malformed, print usage and stop.

## Setup

Track:

- `ITER = 0`
- `BASELINE_DONE` when threshold is `tasks:N`:

```bash
jq '[.tasks[] | select(.status == "done")] | length' docs/workboard.json
```

If `TASK` is a skill name, ensure skill file exists in configured local skill directories.

## Per-Cycle Contract

1. Check threshold before launching next worker.
2. Launch one fresh worker agent/subprocess per cycle.
3. Worker performs at most one bounded cycle and must finish with a strict summary trailer:

```text
RALPH-SUMMARY-START
STATUS: SUCCESS|FAILURE|BLOCKED
TASK_ID: <task id or n/a>
TASK_TITLE: <task title or one-line summary>
DOCS: UPDATED|N/A|MISSING (<brief detail>)
TESTS: PASS|FAIL|SKIP (<brief detail>)
FILES_CHANGED: <comma-separated paths, max 5>
COMMIT_MSG: <one-line commit message, max 72 chars>
PUSHED: YES|NO (<sha or reason>)
FAILURE_REASON: <reason or none>
RALPH-SUMMARY-END
```

4. Parse summary block only. If missing, treat as `FAILURE`.

## Publish Policy

- Default: monitor does not commit/push.
- If user explicitly requested publishing for this run, worker may commit/push only on `SUCCESS` after docs+tests gates pass.

## Success Handling

- Increment `ITER`.
- If threshold is `tasks:N`, re-check done count and compute delta from baseline.
- For `start-task` style loops, if `SUCCESS` is reported but done count did not increase, treat as `BLOCKED` and stop.

## Failure/Blocked Handling

- `FAILURE`: halt loop, report reason and current non-destructive `git status --short`.
- `BLOCKED`: halt loop gracefully.
- Optionally write a concise failure note file only if useful in this repo.

## Guardrails

- Monitor never does implementation work.
- Never auto-discard changes with destructive git commands.
- Never continue past reached threshold.
- Never treat `SUCCESS` as valid when docs/tests/publish gates fail for a publish-required run.

