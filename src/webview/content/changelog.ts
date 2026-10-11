/** One release shown in the Changelog tab (hand-curated from CHANGELOG.md). */
export interface ChangelogRelease {
  version: string;
  date: string;
  groups: Array<{ title: string; items: string[] }>;
}

/** Newest first. Keep the top entry in sync with `package.json` (a unit test enforces it). */
export const CHANGELOG: readonly ChangelogRelease[] = [
  {
    version: "1.0.1",
    date: "2026-10-11",
    groups: [
      {
        title: "Fixed",
        items: [
          "Ship `dist` and `bin` in the npm tarball through an explicit `files` whitelist",
          "Add `repository`, `bugs` and `homepage` metadata to `package.json`",
          "Run build and tests before every publish with a `prepublishOnly` guard",
        ],
      },
      {
        title: "Changed",
        items: [
          "Enable `exactOptionalPropertyTypes` and add `tsconfig.test.json` for type-checking specs",
          "`muraqib audit` is served only by the primary CLI, with the new `-e/--env` and `--engine` flags",
          "`npm run scan` now runs `muraqib audit --osv`",
        ],
      },
      {
        title: "Tests",
        items: ["Add unit tests for `cache-guard`, `manager-detector` and `resolve-workflow`"],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-07",
    groups: [
      {
        title: "Added",
        items: [
          "13+ audit modules: memory, security, dependency, async, bundle budget, cache, dead code, image, network and more",
          "Docker Guard, Compatibility Guard, secret detection and an AI advisor",
          "Render-blocking detector, HTML scanner and config guard",
          "CLI with text, JSON, HTML and CSV output, module filtering and `--fail-on-warning`",
          "TypeScript strict configuration, ESLint, Vitest with 85% coverage thresholds and a GitHub Actions pipeline",
        ],
      },
    ],
  },
];
