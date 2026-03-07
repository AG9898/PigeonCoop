// core-engine: workflow execution coordinator, state machines, scheduler.
// Owns all execution state. The UI renders state from here, never invents it.
// See ARCHITECTURE.md §4, §7.

pub mod scheduler;
pub mod state_machine;
pub mod validation;
pub mod execution;
pub mod review;
