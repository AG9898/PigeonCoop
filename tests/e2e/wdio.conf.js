// WebdriverIO config for E2E tests via tauri-driver.
// See docs/TESTING.md §3 for full setup instructions.
//
// Prerequisites:
//   cargo install tauri-driver
//   cargo tauri build --debug
//   tauri-driver  (run in a separate terminal before running tests)

export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        // Path to the compiled debug binary.
        // Adjust if your binary name or path differs.
        application: "../../target/debug/agent-arcade",
      },
    },
  ],
  logLevel: "info",
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: ["tauri"],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
};
