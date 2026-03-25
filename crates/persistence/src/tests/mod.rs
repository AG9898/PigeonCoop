// Dedicated test suite for the persistence crate.
// Uses in-memory SQLite exclusively — never hits a real file.
// Organised by repository, mirroring the runtime-adapters and core-engine patterns.

mod workflows;
mod runs;
mod events;
mod settings;
