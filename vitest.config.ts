import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./tests/setup-git-ceiling.ts"],
    // Real git/audit calls are several times slower on Windows than the 5 s default.
    testTimeout: 20000,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
      exclude: [
        "node_modules/",
        "dist/",
        "tests/",
        "**/*.spec.ts",
        "**/*.test.ts",
      ],
    },
    include: ["tests/**/*.spec.ts"],
  },
});
