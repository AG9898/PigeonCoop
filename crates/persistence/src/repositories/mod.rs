// Repository pattern — one module per entity (workflows, runs, events, settings).

pub mod events;
pub use events::{EventRepository, EventRepoError};

pub mod workflows;
pub use workflows::RepoError as WorkflowRepoError;

pub mod runs;
pub use runs::{RunRepository, RunRepoError};

pub mod settings;
pub use settings::{SettingsRepository, SettingsRepoError};
