// core-engine: workflow execution coordinator, state machines, scheduler.
// Owns all execution state. The UI renders state from here, never invents it.
// See ARCHITECTURE.md §4, §7.

pub mod coordinator;
pub mod execution;
pub mod review;
pub mod scheduler;
pub mod state_machine;
pub mod validation;

#[cfg(test)]
mod validator_tests;

#[cfg(test)]
mod coordinator_tests;

#[cfg(test)]
mod tests;
