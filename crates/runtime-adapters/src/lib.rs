// runtime-adapters: boundary layer between core-engine and execution targets.
// v1 ships a CLI/shell adapter. See ARCHITECTURE.md §8.

pub mod agent;
pub mod cli;
pub mod tools;
pub mod mock;

#[cfg(test)]
pub mod tests;

use std::future::Future;
use std::pin::Pin;

use thiserror::Error;
use tokio::sync::mpsc;
use workflow_model::memory::MemoryState;
use workflow_model::node::NodeDefinition;
use event_model::command_events::CommandEventKind;

/// Errors produced by adapter operations.
#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("preparation failed: {0}")]
    PreparationFailed(String),

    #[error("execution failed: {0}")]
    ExecutionFailed(String),

    #[error("abort failed: {0}")]
    AbortFailed(String),

    #[error("node type not supported by this adapter: {0}")]
    NodeTypeNotSupported(String),
}

/// Structured output produced by a completed adapter execution.
#[derive(Debug, Clone)]
pub struct AdapterOutput {
    /// Serialized node output, if any (e.g. parsed JSON from stdout).
    pub output: serde_json::Value,
    /// Process exit code, if applicable.
    pub exit_code: Option<i32>,
    /// Captured stdout as a UTF-8 string.
    pub stdout: String,
    /// Captured stderr as a UTF-8 string.
    pub stderr: String,
    /// Wall-clock duration of the execution in milliseconds.
    pub duration_ms: u64,
}

/// Common interface for all runtime adapters.
///
/// Adapters translate a `NodeDefinition` into actual work (shell commands,
/// agent CLI calls, tool invocations, etc.) within a given workspace root.
///
/// # Contract per method
///
/// ## `prepare`
/// Called before `execute`. Validates that the node configuration is
/// compatible with this adapter and that the workspace root is accessible.
/// Must be free of side effects. Returns `Ok(())` or an `AdapterError::PreparationFailed`.
///
/// ## `execute`
/// Carries out the node's work. Receives the node definition, workspace root,
/// run-shared memory for context, and a sender channel for streaming
/// `CommandEventKind` events to the engine. Returns a structured `AdapterOutput`
/// on success. Must not mutate global state outside the workspace root.
///
/// ## `abort`
/// Cancels an in-progress `execute` call. Called by the engine when the run is
/// cancelled or a timeout guardrail fires. Best-effort — implementations should
/// attempt to terminate any spawned processes and release resources.
pub trait Adapter: Send + Sync {
    fn prepare<'a>(
        &'a self,
        node: &'a NodeDefinition,
        workspace_root: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>>;

    fn execute<'a>(
        &'a self,
        node: &'a NodeDefinition,
        workspace_root: &'a str,
        memory: &'a MemoryState,
        event_tx: mpsc::Sender<CommandEventKind>,
    ) -> Pin<Box<dyn Future<Output = Result<AdapterOutput, AdapterError>> + Send + 'a>>;

    fn abort<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AdapterError>> + Send + 'a>>;
}
