// WebdriverIO config for E2E tests via tauri-driver.
// See docs/TESTING.md §3 for full setup instructions.
//
// Prerequisites (run in order):
//   1. cargo install tauri-driver
//   2. cargo tauri build --debug
//   3. tauri-driver  (start in a separate terminal — listens on localhost:4444)
//   4. npm test       (from this directory)

export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,

  // tauri-driver acts as the WebDriver server on port 4444.
  // No wdio service is needed — run tauri-driver manually before tests.
  hostname: "localhost",
  port: 4444,
  path: "/",

  capabilities: [
    {
      maxInstances: 1,
      browserName: "chrome",
      "tauri:options": {
        // Path to the compiled debug binary relative to the workspace root.
        // Adjust if your binary name or platform differs.
        application: "../../target/debug/agent-arcade",
      },
    },
  ],
  logLevel: "info",
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
};
