import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../tests/browser",
  testMatch: "native-default-example.spec.js",
  workers: 2,
  reporter: "list",
  outputDir: "../../test-results/native-example-hosted",
  use: { baseURL: "https://antonsoo.github.io/stutterscope/", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
