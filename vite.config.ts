import { defineConfig } from "vite";

export default defineConfig({
  base: "/stutterscope/",
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
