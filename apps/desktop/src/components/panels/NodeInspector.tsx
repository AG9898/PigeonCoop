// NodeInspector — shows editable config fields for the selected node.
// Renders a per-NodeKind form derived from the Rust NodeConfig structs.
// Uses key={node.id} in the parent to remount when a different node is selected,
// which naturally resets all form state.

import { useState } from "react";
import type { Node } from "reactflow";
import type { AgentNodeConfig, NodeKind, RetryPolicy } from "../../types/workflow";
import { CUSTOM_PROVIDER_ID, KNOWN_PROVIDERS, OTHER_MODEL_OPTION } from "../../types/providers";
import type { WorkflowNodeData } from "../nodes/WorkflowNode";

// ---------------------------------------------------------------------------
// Per-kind config types (mirrors Rust NodeConfig variants in node_config.rs)
// ---------------------------------------------------------------------------

type AgentConfig = AgentNodeConfig;

interface ToolConfig {
  command: string;
  shell?: string;
  timeout_ms?: number;
}

interface RoutingRule {
  condition: string;
  target_key: string;
}

interface RouterConfig {
  rules: RoutingRule[];
}

interface MemoryConfig {
  key: string;
  scope: "run_shared" | "node_local";
  operation: "read" | "write";
}

interface HumanReviewConfig {
  prompt?: string;
  reason?: string;
  available_actions?: string[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NodeInspectorProps {
  node: Node<WorkflowNodeData>;
  onUpdateLabel: (label: string) => void;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  onUpdateRetryPolicy: (rp: RetryPolicy) => void;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="ni-field">
      <label className="ni-field-label">{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind config forms
// ---------------------------------------------------------------------------

interface AgentFormProps {
  config: AgentConfig;
  onChange: (c: AgentConfig) => void;
}

function AgentForm({ config, onChange }: AgentFormProps) {
  const selectedProvider = KNOWN_PROVIDERS.find((p) => p.id === config.provider_hint);
  const isCustomProvider = config.provider_hint === CUSTOM_PROVIDER_ID;
  const curatedModelIds = selectedProvider?.models.map((m) => m.id) ?? [];

  // Tracks whether the model dropdown is showing "Other..." (free-form input).
  // Initialized once per mount from the incoming config; NodeInspector remounts
  // (key={node.id}) whenever a different node is selected, so this naturally
  // resets when the selection changes.
  const [otherModelSelected, setOtherModelSelected] = useState(
    () => config.model !== undefined && !curatedModelIds.includes(config.model)
  );

  const handleProviderChange = (providerId: string) => {
    setOtherModelSelected(false);
    onChange({ ...config, provider_hint: providerId || undefined, model: undefined });
  };

  const handleModelSelect = (value: string) => {
    if (value === OTHER_MODEL_OPTION) {
      setOtherModelSelected(true);
      onChange({ ...config, model: undefined });
    } else {
      setOtherModelSelected(false);
      onChange({ ...config, model: value || undefined });
    }
  };

  const modelSelectValue = otherModelSelected ? OTHER_MODEL_OPTION : config.model ?? "";

  return (
    <>
      <Field label="PROMPT">
        <textarea
          className="ni-input ni-textarea"
          value={config.prompt}
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
          rows={4}
          placeholder="Instruction text sent to the agent"
        />
      </Field>
      <Field label="PROVIDER">
        <select
          className="ni-input ni-select"
          value={config.provider_hint ?? ""}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          <option value="">— none —</option>
          {KNOWN_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {!isCustomProvider && (
        <Field label="MODEL">
          <select
            className="ni-input ni-select"
            value={modelSelectValue}
            onChange={(e) => handleModelSelect(e.target.value)}
          >
            <option value="">— none —</option>
            {selectedProvider?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value={OTHER_MODEL_OPTION}>Other...</option>
          </select>
        </Field>
      )}
      {!isCustomProvider && otherModelSelected && (
        <Field label="MODEL (OTHER)">
          <input
            className="ni-input"
            value={config.model ?? ""}
            onChange={(e) => onChange({ ...config, model: e.target.value || undefined })}
            placeholder="e.g. claude-sonnet-4-6"
          />
        </Field>
      )}
      {isCustomProvider && (
        <Field label="COMMAND">
          <input
            className="ni-input"
            value={config.command ?? ""}
            onChange={(e) => onChange({ ...config, command: e.target.value || undefined })}
            placeholder="e.g. claude-code"
          />
        </Field>
      )}
      <Field label="OUTPUT MODE">
        <select
          className="ni-input ni-select"
          value={config.output_mode ?? "raw"}
          onChange={(e) =>
            onChange({ ...config, output_mode: e.target.value as AgentConfig["output_mode"] })
          }
        >
          <option value="raw">raw</option>
          <option value="json_stdout">json_stdout</option>
          <option value="json_last_line">json_last_line</option>
        </select>
      </Field>
    </>
  );
}

interface ToolFormProps {
  config: ToolConfig;
  onChange: (c: ToolConfig) => void;
}

function ToolForm({ config, onChange }: ToolFormProps) {
  return (
    <>
      <Field label="COMMAND">
        <input
          className="ni-input"
          value={config.command}
          onChange={(e) => onChange({ ...config, command: e.target.value })}
          placeholder="e.g. cargo test"
        />
      </Field>
      <Field label="SHELL">
        <input
          className="ni-input"
          value={config.shell ?? ""}
          onChange={(e) => onChange({ ...config, shell: e.target.value || undefined })}
          placeholder="e.g. bash (default: system shell)"
        />
      </Field>
      <Field label="TIMEOUT (ms)">
        <input
          className="ni-input"
          type="number"
          min={0}
          value={config.timeout_ms ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...config, timeout_ms: v ? parseInt(v, 10) : undefined });
          }}
          placeholder="No limit"
        />
      </Field>
    </>
  );
}

interface RouterFormProps {
  config: RouterConfig;
  onChange: (c: RouterConfig) => void;
}

function RouterForm({ config, onChange }: RouterFormProps) {
  const addRule = () =>
    onChange({ rules: [...config.rules, { condition: "", target_key: "" }] });

  const removeRule = (i: number) =>
    onChange({ rules: config.rules.filter((_, idx) => idx !== i) });

  const updateRule = (i: number, field: keyof RoutingRule, value: string) => {
    const rules = config.rules.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r
    );
    onChange({ rules });
  };

  return (
    <>
      <div className="ni-section-label">ROUTING RULES</div>
      {config.rules.map((rule, i) => (
        <div key={i} className="ni-rule">
          <div className="ni-rule-row">
            <input
              className="ni-input ni-rule-input"
              value={rule.condition}
              onChange={(e) => updateRule(i, "condition", e.target.value)}
              placeholder="condition expression"
            />
            <input
              className="ni-input ni-rule-input"
              value={rule.target_key}
              onChange={(e) => updateRule(i, "target_key", e.target.value)}
              placeholder="target_key"
            />
            <button className="ni-rule-remove" onClick={() => removeRule(i)}>×</button>
          </div>
        </div>
      ))}
      <button className="ni-add-btn" onClick={addRule}>+ Add Rule</button>
    </>
  );
}

interface MemoryFormProps {
  config: MemoryConfig;
  onChange: (c: MemoryConfig) => void;
}

function MemoryForm({ config, onChange }: MemoryFormProps) {
  return (
    <>
      <Field label="KEY">
        <input
          className="ni-input"
          value={config.key}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="e.g. run_shared.plan"
        />
      </Field>
      <Field label="SCOPE">
        <select
          className="ni-input ni-select"
          value={config.scope}
          onChange={(e) =>
            onChange({ ...config, scope: e.target.value as MemoryConfig["scope"] })
          }
        >
          <option value="run_shared">run_shared</option>
          <option value="node_local">node_local</option>
        </select>
      </Field>
      <Field label="OPERATION">
        <select
          className="ni-input ni-select"
          value={config.operation}
          onChange={(e) =>
            onChange({ ...config, operation: e.target.value as MemoryConfig["operation"] })
          }
        >
          <option value="read">read</option>
          <option value="write">write</option>
        </select>
      </Field>
    </>
  );
}

interface HumanReviewFormProps {
  config: HumanReviewConfig;
  onChange: (c: HumanReviewConfig) => void;
}

function HumanReviewForm({ config, onChange }: HumanReviewFormProps) {
  const actionsStr = (config.available_actions ?? []).join(", ");

  return (
    <>
      <Field label="PROMPT">
        <textarea
          className="ni-input ni-textarea"
          value={config.prompt ?? ""}
          onChange={(e) => onChange({ ...config, prompt: e.target.value || undefined })}
          rows={3}
          placeholder="Instructions shown to the reviewer"
        />
      </Field>
      <Field label="REASON">
        <input
          className="ni-input"
          value={config.reason ?? ""}
          onChange={(e) => onChange({ ...config, reason: e.target.value || undefined })}
          placeholder="Machine-readable rationale"
        />
      </Field>
      <Field label="ACTIONS (comma-separated)">
        <input
          className="ni-input"
          value={actionsStr}
          onChange={(e) => {
            const val = e.target.value;
            const actions = val
              ? val.split(",").map((s) => s.trim()).filter(Boolean)
              : undefined;
            onChange({ ...config, available_actions: actions });
          }}
          placeholder="approve, reject, retry"
        />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// RetryPolicy form
// ---------------------------------------------------------------------------

interface RetryPolicyFormProps {
  policy: RetryPolicy;
  onChange: (p: RetryPolicy) => void;
}

function RetryPolicyForm({ policy, onChange }: RetryPolicyFormProps) {
  return (
    <>
      <Field label="MAX RETRIES">
        <input
          className="ni-input"
          type="number"
          min={0}
          value={policy.max_retries}
          onChange={(e) =>
            onChange({ ...policy, max_retries: Math.max(0, parseInt(e.target.value, 10) || 0) })
          }
        />
      </Field>
      <Field label="MAX RUNTIME (ms)">
        <input
          className="ni-input"
          type="number"
          min={0}
          value={policy.max_runtime_ms ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ ...policy, max_runtime_ms: v ? parseInt(v, 10) : undefined });
          }}
          placeholder="No limit"
        />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// Default configs per kind
// ---------------------------------------------------------------------------

function defaultConfig(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case "agent":        return { prompt: "", output_mode: "raw" } as Record<string, unknown>;
    case "tool":         return { command: "" } as Record<string, unknown>;
    case "router":       return { rules: [] } as Record<string, unknown>;
    case "memory":       return { key: "", scope: "run_shared", operation: "read" } as Record<string, unknown>;
    case "human_review": return {} as Record<string, unknown>;
    default:             return {};
  }
}

const KIND_LABEL: Record<NodeKind, string> = {
  start:        "START",
  end:          "END",
  agent:        "AGENT",
  tool:         "TOOL",
  router:       "ROUTER",
  memory:       "MEMORY",
  human_review: "HUMAN REVIEW",
};

// ---------------------------------------------------------------------------
// NodeInspector
// ---------------------------------------------------------------------------

export function NodeInspector({ node, onUpdateLabel, onUpdateConfig, onUpdateRetryPolicy }: NodeInspectorProps) {
  const { kind, label, config, retry_policy } = node.data;

  const [localLabel, setLocalLabel] = useState(label);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>(
    config ?? defaultConfig(kind)
  );
  const [localRetry, setLocalRetry] = useState<RetryPolicy>(
    retry_policy ?? { max_retries: 0 }
  );

  const handleLabelChange = (val: string) => {
    setLocalLabel(val);
    onUpdateLabel(val);
  };

  const handleConfigChange = (updated: Record<string, unknown>) => {
    setLocalConfig(updated);
    onUpdateConfig(updated);
  };

  const handleRetryChange = (updated: RetryPolicy) => {
    setLocalRetry(updated);
    onUpdateRetryPolicy(updated);
  };

  const hasConfig = kind !== "start" && kind !== "end";

  return (
    <div className="node-inspector">
      <div className="ni-header">
        <span className="ni-kind">{KIND_LABEL[kind]}</span>
        <span className="ni-title">INSPECTOR</span>
      </div>

      <div className="ni-body">
        {/* Label */}
        <div className="ni-section">
          <div className="ni-section-label">LABEL</div>
          <Field label="">
            <input
              className="ni-input"
              value={localLabel}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Node label"
            />
          </Field>
        </div>

        {/* Config */}
        {hasConfig && (
          <div className="ni-section">
            <div className="ni-section-label">CONFIG</div>
            {kind === "agent" && (
              <AgentForm
                config={localConfig as unknown as AgentConfig}
                onChange={(c) => handleConfigChange(c as unknown as Record<string, unknown>)}
              />
            )}
            {kind === "tool" && (
              <ToolForm
                config={localConfig as unknown as ToolConfig}
                onChange={(c) => handleConfigChange(c as unknown as Record<string, unknown>)}
              />
            )}
            {kind === "router" && (
              <RouterForm
                config={localConfig as unknown as RouterConfig}
                onChange={(c) => handleConfigChange(c as unknown as Record<string, unknown>)}
              />
            )}
            {kind === "memory" && (
              <MemoryForm
                config={localConfig as unknown as MemoryConfig}
                onChange={(c) => handleConfigChange(c as unknown as Record<string, unknown>)}
              />
            )}
            {kind === "human_review" && (
              <HumanReviewForm
                config={localConfig as unknown as HumanReviewConfig}
                onChange={(c) => handleConfigChange(c as unknown as Record<string, unknown>)}
              />
            )}
          </div>
        )}

        {kind === "start" && (
          <div className="ni-section ni-no-config">
            <span className="ni-muted">Start node — no configuration</span>
          </div>
        )}
        {kind === "end" && (
          <div className="ni-section ni-no-config">
            <span className="ni-muted">End node — no configuration</span>
          </div>
        )}

        {/* Retry policy */}
        <div className="ni-section">
          <div className="ni-section-label">RETRY POLICY</div>
          <RetryPolicyForm policy={localRetry} onChange={handleRetryChange} />
        </div>
      </div>
    </div>
  );
}
