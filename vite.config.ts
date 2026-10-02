/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { contentSecurityPolicy } from "./vite.csp";

export default defineConfig({
  base: "/stutterscope/",
  plugins: [contentSecurityPolicy()],
  // Sample captures live in examples/ (see scripts/generate-samples.ts) and
  // are served as static files so the "Load sample" buttons can fetch them.
  publicDir: "examples",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
