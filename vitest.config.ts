import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      lines: 85,
      functions: 85,
      branches: 85,
      statements: 85,
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
