import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "coverage/**", "**/*.js", "**/*.d.ts"],
  },
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: "module", ecmaVersion: 2022 },
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    // Branching-complexity budget for production code. Hard errors: split the function (guard clauses, lookup tables, helpers) instead of raising the limit.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["**/*.spec.ts", "**/*.test.ts"],
    rules: {
      complexity: ["error", 20],
      "max-depth": ["error", 4],
    },
  },
];
