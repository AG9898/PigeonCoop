// Dedicated test suite for runtime-adapters.
// Mirrors the structure used by crates/core-engine/src/tests/.
//
// These tests verify:
// - CLI adapter event emission ORDER (not just presence)
// - Timeout reason strings
// - Stderr capture
// - Non-zero exit code handling
// - MockAdapter used as a no-process test double

pub mod cli_adapter;
pub mod mock_adapter;
