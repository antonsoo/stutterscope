/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "/stutterscope/",
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
