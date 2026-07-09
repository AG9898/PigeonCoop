// Known agent CLI providers and model options for the NodeInspector's
// Agent config form. Mirrors the Rust PROVIDER_REGISTRY in
// crates/runtime-adapters/src/agent.rs — update both together when adding a
// new provider (see DEC-006 in docs/DECISIONS.md).
//
// This is static UI-only data, not part of the serialized workflow schema.
// No Tauri IPC command exists for listing providers (per DEC-006).

export interface ModelSpec {
  /** Value sent as AgentNodeConfig.model, e.g. passed to the CLI's --model flag. */
  id: string;
  /** Display label shown in the model dropdown. */
  label: string;
}

export interface ProviderSpec {
  /** provider_hint key stored on AgentNodeConfig.provider_hint. */
  id: string;
  /** Display label shown in the provider dropdown. */
  label: string;
  /**
   * Base CLI command this provider resolves to at runtime. Informational only —
   * the actual command resolution happens in AgentCliAdapter::resolve_command.
   */
  baseCommand: string;
  /** Curated models offered in the model dropdown. Empty for the Custom provider. */
  models: ModelSpec[];
}

/** Sentinel value for the "Other..." option in the model dropdown. */
export const OTHER_MODEL_OPTION = "__other__";

/** Provider id used to signal "raw CLI command, no known adapter". */
export const CUSTOM_PROVIDER_ID = "custom";

export const KNOWN_PROVIDERS: ProviderSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    baseCommand: "claude",
    // CLI aliases, not dated IDs (DEC-010): the claude CLI resolves each alias
    // to the latest model of that tier, so this list never goes stale. Exact
    // dated model IDs go through the "Other..." free-text option.
    models: [
      { id: "opus", label: "Opus (latest)" },
      { id: "sonnet", label: "Sonnet (latest)" },
      { id: "haiku", label: "Haiku (latest)" },
      { id: "fable", label: "Fable (latest)" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI Codex",
    baseCommand: "codex",
    // No curated list (DEC-010): codex has no stable aliases. The no-model
    // option uses the default from ~/.codex/config.toml (surfaced via the
    // get_codex_default_model command); explicit models go through "Other...".
    models: [],
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: "Custom Command",
    baseCommand: "",
    models: [],
  },
];
