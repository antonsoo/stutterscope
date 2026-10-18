import { defineConfig } from "@playwright/test";

// Explicit invocation only: this never starts or substitutes a local server.
export default defineConfig({
  testDir: "../../tests/browser",
  testMatch: "presentmon-default.spec.js",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  outputDir: "../../test-results/hosted",
  use: { baseURL: "https://antonsoo.github.io/stutterscope/", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
