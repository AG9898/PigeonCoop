// Known agent CLI providers and curated model lists for the NodeInspector's
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
    models: [
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI Codex",
    baseCommand: "codex",
    models: [
      { id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
      { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
      { id: "o4-mini", label: "o4-mini" },
    ],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    baseCommand: "gemini",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: "Custom Command",
    baseCommand: "",
    models: [],
  },
];
