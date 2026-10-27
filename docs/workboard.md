# Workboard Contract

Canonical active queue data lives in [`docs/workboard.json`](workboard.json).
The machine-readable schema lives in [`docs/workboard.schema.json`](workboard.schema.json).

Agents and automation that read or write workboard tasks must follow this contract.

## DEC-014 transition status

The current queue has not been replanned for the 2026-10-27 assistant-owned
product direction. Preserve task history/statuses; do not assume an old desktop
or visual-polish task still matches current product priorities. Reconcile scope
explicitly before selecting or inserting implementation work.

Proposed implementation records live in implementation-tasks.draft.json, outside
the canonical queue. Their IDs/dependencies are provisional until checked against
the live board using the workboard skills. They are not automatically startable.
This documentation pass does not mutate the board, its metadata, groups, or schema.

The future built-in template reads this repository-specific board contract; it
must not hardcode this shape for every user's repository. Skills/workers remain
the writers. Rust recording/indexing of task snapshots does not itself change a
task status. A worker report alone does not bypass docs and verification gates.

## Validation

Minimum structural check:

```bash
jq -e '.project and (.statuses | type == "array") and (.task_groups | type == "array") and (.tasks | type == "array")' docs/workboard.json >/dev/null
```

Full schema validation:

```bash
npx --yes ajv-cli validate -s docs/workboard.schema.json -d docs/workboard.json
```

The schema is intentionally matched to this repository's current workboard shape rather than the smaller upstream task-only format.

## Top-Level Shape

`docs/workboard.json` contains:

- `project`: board metadata, including `name`, `updated_at`, and `source_docs`.
- `statuses`: the allowed task lifecycle values for this board.
- `task_groups`: the canonical implementation lanes used by `tasks[].group_id`.
- `tasks`: the implementation queue.

## Status Lifecycle

Allowed statuses are defined by `statuses`:

- `todo`
- `ready`
- `in_progress`
- `blocked`
- `in_review`
- `done`
- `deferred`

Use `todo` for newly captured work unless the task is immediately actionable and should be marked `ready`.
Use `in_review` only when the implementation work is complete and review is the next step.
Use `blocked` with a non-empty `blocked_by` list.
Use `deferred` for intentionally postponed work.

## Task Groups

Every task must use a `group_id` from `task_groups`.
Do not invent new groups without updating `task_groups` in the same change.

Current group IDs include:

- `FOUND`
- `MODEL`
- `EVENT`
- `ENGINE`
- `PERSIST`
- `ADAPT`
- `TAURI`
- `UI-BLD`
- `UI-RUN`
- `UI-RPL`
- `UX`
- `SPRITE`
- `DOCS`
- `TEST`
- `DEC`

## Task Schema

Each `tasks[]` item must include:

- `id`: stable task identifier using the current `<GROUP>-NNN` style, with group prefixes allowed to contain hyphens.
- `group_id`: one of the board's `task_groups[].group_id` values.
- `title`: short human-readable summary.
- `status`: one of the values listed in `statuses`.
- `priority`: one of `critical`, `high`, `medium`, `low`.
- `type`: one of `decision`, `design`, `docs`, `feature`, `implementation`, `testing`.
- `summary`: concise current state or intent.
- `description`: concrete implementation intent and boundaries.
- `acceptance_criteria`: objective completion checks.
- `depends_on`: task IDs that should be complete first.
- `blocked_by`: explicit blockers such as decisions, missing access, or prerequisite work.
- `files`: likely implementation paths.
- `docs`: documentation files to read or update.
- `notes`: status notes and relevant execution context.
- `commands`: preferred validation commands.
- `estimate`: one of `XS`, `S`, `M`, `L`, `XL`.

## Agent Usage Rules

- Use the workboard query/edit skills for selection and targeted updates.
- Do not dump the full board into chat when a targeted query is enough.
- Startable task conditions: `status` is `todo` or `ready`, `blocked_by` is empty, and all `depends_on` tasks are `done`.
- Edit one task at a time unless the user explicitly asks for broader planning.
- Never bulk-rewrite the board; keep edits scoped to the active task.
- Keep `project.updated_at` current whenever `docs/workboard.json` changes.
- Keep schema, workboard contract docs, and task shape in sync.
