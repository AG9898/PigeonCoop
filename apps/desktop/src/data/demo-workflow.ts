// Canonical demo workflow: Plan → Execute Tool → Critique → Approve.
// Embedded as a TypeScript constant so first-run seeding works without
// reading from the filesystem. Mirrors examples/plan-execute-critique-approve/workflow.json.
//
// The well-known ID lets the app detect whether the demo has already been seeded.

export const DEMO_WORKFLOW_ID = "00000000-0000-0000-0000-000000000001";

/** Full demo workflow JSON string, ready to pass to ipc.importWorkflow(). */
export function demWorkflowJson(): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    workflow_id: DEMO_WORKFLOW_ID,
    name: "Plan \u2192 Execute Tool \u2192 Critique \u2192 Approve",
    schema_version: 1,
    version: 1,
    metadata: {
      description:
        "Canonical v1 demo workflow. See ARCHITECTURE.md \u00a77 (canonical first demo).",
      author: "agent-arcade",
    },
    created_at: now,
    updated_at: now,
    nodes: [
      {
        node_id: "10000000-0000-0000-0000-000000000001",
        node_type: "start",
        label: "Start",
        config: {},
        input_contract: {},
        output_contract: {},
        memory_access: {},
        retry_policy: { max_retries: 0 },
        display: { x: 100, y: 200 },
      },
      {
        node_id: "10000000-0000-0000-0000-000000000002",
        node_type: "agent",
        label: "Plan",
        config: {
          prompt: "Analyze the repository task and produce a plan.",
          command: "true",
        },
        input_contract: { task: "string" },
        output_contract: { plan: "string" },
        memory_access: { write: ["run_shared.plan"] },
        retry_policy: { max_retries: 1 },
        display: { x: 300, y: 200 },
      },
      {
        node_id: "10000000-0000-0000-0000-000000000003",
        node_type: "tool",
        label: "Execute Tool",
        config: { command: "echo 'tool executed'" },
        input_contract: { plan: "string" },
        output_contract: { result: "string", exit_code: "number" },
        memory_access: {
          read: ["run_shared.plan"],
          write: ["run_shared.tool_result"],
        },
        retry_policy: { max_retries: 2 },
        display: { x: 550, y: 200 },
      },
      {
        node_id: "10000000-0000-0000-0000-000000000004",
        node_type: "agent",
        label: "Critique",
        config: {
          prompt:
            "Critique the tool output and decide if it meets requirements.",
          command: "true",
        },
        input_contract: { tool_result: "string" },
        output_contract: { verdict: "string", passed: "boolean" },
        memory_access: {
          read: ["run_shared.tool_result"],
          write: ["run_shared.verdict"],
        },
        retry_policy: { max_retries: 1 },
        display: { x: 800, y: 200 },
      },
      {
        node_id: "10000000-0000-0000-0000-000000000005",
        node_type: "human_review",
        label: "Approve",
        config: {
          prompt: "Review the critique and approve, reject, or request retry.",
          available_actions: ["approve", "reject", "retry", "edit_memory"],
        },
        input_contract: { verdict: "string" },
        output_contract: { decision: "string" },
        memory_access: { read: ["run_shared.verdict"] },
        retry_policy: { max_retries: 0 },
        display: { x: 1050, y: 200 },
      },
      {
        node_id: "10000000-0000-0000-0000-000000000006",
        node_type: "end",
        label: "End",
        config: {},
        input_contract: {},
        output_contract: {},
        memory_access: {},
        retry_policy: { max_retries: 0 },
        display: { x: 1300, y: 200 },
      },
    ],
    edges: [
      {
        edge_id: "20000000-0000-0000-0000-000000000001",
        source_node_id: "10000000-0000-0000-0000-000000000001",
        target_node_id: "10000000-0000-0000-0000-000000000002",
        condition_kind: "always",
      },
      {
        edge_id: "20000000-0000-0000-0000-000000000002",
        source_node_id: "10000000-0000-0000-0000-000000000002",
        target_node_id: "10000000-0000-0000-0000-000000000003",
        condition_kind: "on_success",
      },
      {
        edge_id: "20000000-0000-0000-0000-000000000003",
        source_node_id: "10000000-0000-0000-0000-000000000003",
        target_node_id: "10000000-0000-0000-0000-000000000004",
        condition_kind: "on_success",
      },
      {
        edge_id: "20000000-0000-0000-0000-000000000004",
        source_node_id: "10000000-0000-0000-0000-000000000004",
        target_node_id: "10000000-0000-0000-0000-000000000005",
        condition_kind: "always",
      },
      {
        edge_id: "20000000-0000-0000-0000-000000000005",
        source_node_id: "10000000-0000-0000-0000-000000000005",
        target_node_id: "10000000-0000-0000-0000-000000000006",
        condition_kind: "on_success",
      },
    ],
    default_constraints: {
      max_retries: 2,
      max_runtime_ms: 300000,
    },
  });
}
