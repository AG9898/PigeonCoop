---
name: ralph-loop
description: Use this skill to run an autonomous ralph loop — repeatedly spawns fresh claude CLI sub-processes to execute a skill or prompt, commits successful results, and stops at a defined threshold. Invoke as: /ralph-loop <skill-or-prompt> <threshold>. Examples: "/ralph-loop start-task iterations:5", "/ralph-loop start-task tasks:3", "/ralph-loop \"analyze and refactor dead code\" iterations:2".
version: 2.0.0
---

# Ralph Loop — Autonomous Iteration Monitor

You are now the **monitoring agent**. Your only roles are: loop orchestration, quality gating, and version control. You never do implementation work yourself.

Each iteration you fire a completely fresh `claude -p` subprocess via the Bash tool. That process runs the task, exits, and is gone. You read only the compact `RALPH-SUMMARY` block from its stdout. This keeps your context window clean across many iterations.

---

## Parameter extraction

From the user's invocation, extract:

- **`TASK`** — first argument: a skill name (e.g. `start-task`) or a quoted free-form prompt string (e.g. `"analyze repo for dead code"`)
- **`THRESHOLD`** — second argument, one of:
  - `iterations:N` — stop after N successful pushed cycles
  - `tasks:N` — stop after N tasks transition to `done` in `docs/workboard.json`

If either is missing or malformed, print:
```
ERROR: Usage is /ralph-loop <skill-or-prompt> <threshold>
  Examples:
    /ralph-loop start-task iterations:5
    /ralph-loop start-task tasks:3
    /ralph-loop "my custom prompt" iterations:2
```
Then stop.

---

## Phase 0 — Initialize

Track these values in your working context throughout the loop:
- `ITER = 0` — successful cycles completed
- `BASELINE_DONE` — done-task count at loop start (for `tasks:N` threshold only)

**Step 1.** If THRESHOLD is `tasks:N`, record the baseline done count:
```bash
jq '[.tasks[] | select(.status == "done")] | length' docs/workboard.json
```
Store the integer result as `BASELINE_DONE`.

**Step 2.** If TASK is a skill name (single token, no spaces), locate its SKILL.md. Run:
```bash
SKILL_NAME="<TASK>"
SKILL_FILE="$HOME/.claude/skills/$SKILL_NAME/SKILL.md"
[ -f "$SKILL_FILE" ] || SKILL_FILE="$(pwd)/.claude/skills/$SKILL_NAME/SKILL.md"
[ -f "$SKILL_FILE" ] && echo "FOUND: $SKILL_FILE" || echo "NOT FOUND"
```
If not found, print an error and stop. Store the confirmed path as `SKILL_FILE`.

**Step 3.** Print the loop header:
```
╔══════════════════════════════════════════════════════════╗
║  RALPH LOOP STARTED                                      ║
╠══════════════════════════════════════════════════════════╣
║  Task:      <TASK>                                       ║
║  Threshold: <THRESHOLD>                                  ║
╚══════════════════════════════════════════════════════════╝
```

---

## Phase 1 — Threshold check

Before every cycle, verify the stop condition is not yet met:

- `iterations:N` → if `ITER >= N`, jump to Phase 4
- `tasks:N` → run:
  ```bash
  jq '[.tasks[] | select(.status == "done")] | length' docs/workboard.json
  ```
  If `(result − BASELINE_DONE) >= N`, jump to Phase 4

If threshold not met, proceed to Phase 2.

---

## Phase 2 — Build and fire the sub-agent

This is the core of the ralph loop. You will write a prompt to a temp file, then launch a fresh `claude` process. When it exits, it is completely gone — that is the point.

### Step 2a — Write the prompt file

Run this bash command to create the sub-agent prompt. Substitute `<TASK>` and `<SKILL_CONTENT_OR_PROMPT>` appropriately (see the two cases below):

```bash
PROMPT_FILE=$(mktemp /tmp/ralph_prompt_XXXXXX.txt)
cat > "$PROMPT_FILE" << 'PROMPTEOF'
<PROMPT BODY — see cases below>
PROMPTEOF
echo "$PROMPT_FILE"
```

**Case A — TASK is a skill name:**

The prompt body should be:
```
You are an autonomous implementation agent. The following are your full skill instructions — follow every phase exactly.

Do NOT run `git commit` or `git push`. The monitoring agent owns all version control.

=== SKILL INSTRUCTIONS ===
<full contents of SKILL_FILE read via: cat "$SKILL_FILE">
=== END SKILL INSTRUCTIONS ===

CRITICAL: After finishing all phases (regardless of outcome), output a RALPH-SUMMARY block as the absolute last thing in your response. The monitoring agent parses only this block — nothing else you write is read.

RALPH-SUMMARY-START
STATUS: SUCCESS|FAILURE|BLOCKED
TASK_ID: <workboard task id, or n/a>
TASK_TITLE: <task title or brief one-line description>
TESTS: PASS|FAIL|SKIP (<command run and its result>)
FILES_CHANGED: <comma-separated list of changed files, max 5>
COMMIT_MSG: <one-line commit message, 72 chars max>
FAILURE_REASON: <explain if STATUS=FAILURE; else write none>
RALPH-SUMMARY-END

STATUS definitions:
- SUCCESS: task fully complete, all tests pass, work is ready to commit
- FAILURE: tests fail, build broken, or hit an unresolvable blocker
- BLOCKED: no tasks are currently startable (all blocked or no todo tasks remain)
```

To embed the skill contents, build the prompt file in two parts using bash:
```bash
PROMPT_FILE=$(mktemp /tmp/ralph_prompt_XXXXXX.txt)
{
  echo "You are an autonomous implementation agent. The following are your full skill instructions — follow every phase exactly."
  echo ""
  echo "Do NOT run \`git commit\` or \`git push\`. The monitoring agent owns all version control."
  echo ""
  echo "=== SKILL INSTRUCTIONS ==="
  cat "$SKILL_FILE"
  echo "=== END SKILL INSTRUCTIONS ==="
  echo ""
  cat << 'SUFFIX'
CRITICAL: After finishing all phases (regardless of outcome), output a RALPH-SUMMARY block as the absolute last thing in your response. The monitoring agent parses only this block — nothing else you write is read.

RALPH-SUMMARY-START
STATUS: SUCCESS|FAILURE|BLOCKED
TASK_ID: <workboard task id, or n/a>
TASK_TITLE: <task title or brief one-line description>
TESTS: PASS|FAIL|SKIP (<command run and its result>)
FILES_CHANGED: <comma-separated list of changed files, max 5>
COMMIT_MSG: <one-line commit message, 72 chars max>
FAILURE_REASON: <explain if STATUS=FAILURE; else write none>
RALPH-SUMMARY-END

STATUS definitions:
- SUCCESS: task fully complete, all tests pass, work is ready to commit
- FAILURE: tests fail, build broken, or hit an unresolvable blocker
- BLOCKED: no tasks are currently startable (all blocked or no todo tasks remain)
SUFFIX
} > "$PROMPT_FILE"
echo "$PROMPT_FILE"
```

**Case B — TASK is a free-form prompt string:**

```bash
PROMPT_FILE=$(mktemp /tmp/ralph_prompt_XXXXXX.txt)
cat > "$PROMPT_FILE" << 'PROMPTEOF'
Do NOT run `git commit` or `git push`. The monitoring agent owns all version control.

<INSERT THE FREE-FORM PROMPT STRING HERE>

CRITICAL: After finishing (regardless of outcome), output a RALPH-SUMMARY block as the absolute last thing in your response.

RALPH-SUMMARY-START
STATUS: SUCCESS|FAILURE|BLOCKED
TASK_ID: n/a
TASK_TITLE: <brief one-line description of what was done>
TESTS: PASS|FAIL|SKIP (<detail>)
FILES_CHANGED: <comma-separated list of changed files, max 5>
COMMIT_MSG: <one-line commit message, 72 chars max>
FAILURE_REASON: <explain if STATUS=FAILURE; else write none>
RALPH-SUMMARY-END

STATUS definitions:
- SUCCESS: work complete and correct
- FAILURE: unable to complete the task
- BLOCKED: nothing to do
PROMPTEOF
echo "$PROMPT_FILE"
```

### Step 2b — Launch the sub-agent process

```bash
RESULT_FILE=$(mktemp /tmp/ralph_result_XXXXXX.json)
claude -p "$(cat "$PROMPT_FILE")" \
  --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
  --max-turns 50 \
  --output-format json \
  > "$RESULT_FILE" 2>/tmp/ralph_stderr_$$.txt
echo "Exit code: $?"
```

Wait for the command to complete. The process will exit on its own.

### Step 2c — Extract the RALPH-SUMMARY

```bash
# Extract text output
AGENT_TEXT=$(jq -r '.result // empty' "$RESULT_FILE")

# Extract just the RALPH-SUMMARY block content
SUMMARY=$(echo "$AGENT_TEXT" | awk '/RALPH-SUMMARY-START/{f=1; next} /RALPH-SUMMARY-END/{f=0} f{print}')

# Parse each field
STATUS=$(echo "$SUMMARY" | grep '^STATUS:' | awk '{print $2}' | tr -d '[:space:]')
TASK_ID=$(echo "$SUMMARY" | grep '^TASK_ID:' | cut -d' ' -f2- | xargs)
TASK_TITLE=$(echo "$SUMMARY" | grep '^TASK_TITLE:' | cut -d' ' -f2- | xargs)
TESTS=$(echo "$SUMMARY" | grep '^TESTS:' | cut -d' ' -f2- | xargs)
COMMIT_MSG=$(echo "$SUMMARY" | grep '^COMMIT_MSG:' | cut -d' ' -f2- | xargs)
FAILURE_REASON=$(echo "$SUMMARY" | grep '^FAILURE_REASON:' | cut -d' ' -f2- | xargs)

echo "STATUS=$STATUS"
echo "TASK_ID=$TASK_ID"
echo "TASK_TITLE=$TASK_TITLE"

# Cleanup
rm -f "$PROMPT_FILE" "$RESULT_FILE" /tmp/ralph_stderr_$$.txt
```

If `STATUS` is empty (RALPH-SUMMARY block not found), treat as `FAILURE` with `FAILURE_REASON="Sub-agent did not produce a RALPH-SUMMARY block"`.

---

## Phase 3 — Evaluate and act

Branch on the value of `STATUS`:

---

### Branch: SUCCESS

1. Increment `ITER` (note the new value for display).

2. If THRESHOLD is `tasks:N`, re-query done count and compute `TASKS_COMPLETED`:
   ```bash
   jq '[.tasks[] | select(.status == "done")] | length' docs/workboard.json
   ```
   **Infinite-loop guard:** if `TASKS_COMPLETED` did not increase since the last cycle, treat as BLOCKED and jump to Phase 4.

3. Commit:
   ```bash
   git add -A
   git commit -m "$COMMIT_MSG"
   ```

4. Push:
   ```bash
   git push origin HEAD
   ```
   If this fails, treat as FAILURE: write the failure report (see below) with the push error as `FAILURE_REASON`, then stop.

5. Print cycle result:
   ```
   ✓ Cycle <ITER> — <TASK_TITLE>
     Tests: <TESTS>
     Pushed: <COMMIT_MSG>
   ```

6. Return to Phase 1.

---

### Branch: FAILURE

1. Do not commit or push.

2. Discard all uncommitted changes:
   ```bash
   git checkout -- .
   git clean -fd
   ```

3. Write the failure report using the Write tool — create `docs/ralph-loop-failure.md`:
   ```markdown
   # Ralph Loop Failure Report

   - **Timestamp:** <current UTC time>
   - **Cycle:** <ITER + 1>
   - **Task ID:** <TASK_ID>
   - **Task Title:** <TASK_TITLE>
   - **Tests:** <TESTS>
   - **Failure reason:** <FAILURE_REASON>
   ```

4. Print:
   ```
   ✗ Cycle <ITER+1> FAILED — <FAILURE_REASON>
     Loop halted. Failure report: docs/ralph-loop-failure.md
   ```

5. **Stop. Do not continue the loop.**

---

### Branch: BLOCKED

No tasks were available. Stop gracefully.

Print:
```
⊘ Cycle <ITER+1> — BLOCKED (no startable tasks)
  Stopping early — workboard has no todo tasks or all are blocked.
```

Jump to Phase 4.

---

## Phase 4 — Loop complete

Print the final summary box. Use the threshold-reached variant if threshold was met, or the stopped-early variant otherwise.

**Threshold reached:**
```
╔══════════════════════════════════════════════════════════╗
║  RALPH LOOP COMPLETE                                     ║
╠══════════════════════════════════════════════════════════╣
║  Cycles completed:  <ITER>                               ║
║  Tasks completed:   <TASKS_COMPLETED>                    ║
║  Threshold:         <THRESHOLD> — REACHED                ║
║  All changes committed and pushed to origin.             ║
╚══════════════════════════════════════════════════════════╝
```

**Stopped by FAILURE:**
```
╔══════════════════════════════════════════════════════════╗
║  RALPH LOOP HALTED                                       ║
╠══════════════════════════════════════════════════════════╣
║  Cycles completed:  <ITER>                               ║
║  Tasks completed:   <TASKS_COMPLETED>                    ║
║  Stopped by:        FAILURE on cycle <ITER+1>            ║
║  See: docs/ralph-loop-failure.md                         ║
╚══════════════════════════════════════════════════════════╝
```

**Stopped by BLOCKED:**
```
╔══════════════════════════════════════════════════════════╗
║  RALPH LOOP HALTED                                       ║
╠══════════════════════════════════════════════════════════╣
║  Cycles completed:  <ITER>                               ║
║  Tasks completed:   <TASKS_COMPLETED>                    ║
║  Stopped by:        BLOCKED (workboard exhausted)        ║
╚══════════════════════════════════════════════════════════╝
```

---

## Guardrails

- **You are the monitor. Never implement.** If you find yourself writing code or editing source files, stop — you are out of role.
- **Never commit if STATUS == FAILURE.** The quality gate is absolute.
- **Never read sub-agent output beyond the RALPH-SUMMARY block.** Parsing full sub-agent transcripts will exhaust your context over many iterations. Extract only the summary fields.
- **Never touch workboard.json yourself.** Sub-agents own all workboard mutations. You only query done-task counts for threshold tracking.
- **Never run extra cycles past threshold.** Hard stop when reached.
- **One `git push` per cycle.** Never batch.
- **Temp files are ephemeral.** Always `rm -f` prompt and result temp files after each cycle to avoid accumulation.
- **If `claude` binary is not found**, check that `~/.cargo/bin` or the install path is in `$PATH`, print an error, and stop.
