// WebdriverIO config for E2E tests via tauri-driver.
// See docs/TESTING.md §3 for full setup instructions.
//
// Prerequisites (run in order):
//   1. cargo install tauri-driver
//   2. cd apps/desktop && npm run tauri build -- --debug
//   3. Start tauri-driver (separate terminal):
//        GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 \
//        WEBKIT_DISABLE_COMPOSITING_MODE=1 LIBGL_ALWAYS_SOFTWARE=1 \
//        tauri-driver
//   4. npm test  (from tests/e2e/)
//
// The env vars in step 3 disable GPU/DMA-buf rendering so WebKitGTK falls back
// to software rendering. Required on WSL2 and other environments without DRI3.

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Absolute path so tauri-driver can find the binary regardless of its cwd.
const APPLICATION = path.resolve(__dirname, "../../target/debug/agent-arcade");

export const config = {
  runner: "local",
  specs: ["./specs/**/*.spec.js"],
  // WebKitWebDriver allows only one session at a time — run specs sequentially.
  maxInstances: 1,

  // tauri-driver acts as the WebDriver server on port 4444.
  // No wdio service is needed — run tauri-driver manually before tests.
  hostname: "localhost",
  port: 4444,
  path: "/",

  // IMPORTANT: tauri:options must be in alwaysMatch, not firstMatch.
  // tauri-driver's map_capabilities only reads capabilities.alwaysMatch to convert
  // tauri:options → webkitgtk:browserOptions for WebKitWebDriver. Using the plain
  // array (firstMatch) format silently drops tauri:options and the binary is never
  // launched. WDIO supports {alwaysMatch: {...}} as an array element for this case.
  capabilities: [
    {
      alwaysMatch: {
        "tauri:options": {
          application: APPLICATION,
        },
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
