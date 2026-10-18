/** One release shown in the Changelog tab (hand-curated from CHANGELOG.md). */
export interface ChangelogRelease {
  version: string;
  date: string;
  groups: Array<{ title: string; items: string[] }>;
}

/** Newest first. Keep the top entry in sync with `package.json` (a unit test enforces it). */
export const CHANGELOG: readonly ChangelogRelease[] = [
  {
    version: "1.1.0",
    date: "2026-10-18",
    groups: [
      {
        title: "Added",
        items: [
          "Git hooks: `muraqib hook install` scans staged changes for secrets before each commit",
          "Security scorecard (0-100) and Markdown compliance report via `muraqib audit --report`",
          "Guards for the bundle, env, cache, HTTP optimizer and render-blocking audits, and `SecretGuard`",
          "VS Code extension (Problems panel, report view, status bar counter)",
          "Generated documentation (`npm run docs:generate`) checked in CI",
        ],
      },
      {
        title: "Changed",
        items: [
          "Behaviour change: `loadEnv` no longer lets a `.env` file replace a variable already set in the real environment (pass `override: true` to restore it)",
          "The two secret detectors are merged into one module with more token formats",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Scan layer false positives for `PORT`, `DATABASE_URL`, `AWS_REGION`, `export KEY=` lines and multi-line `.env` values",
          "Compatibility checks compare versions with semver; a malformed `OSV_API_URL` no longer crashes the CLI",
          "An unreadable `.env` file or missing validation engine no longer aborts the whole scan",
          "Dead-code suppression comments apply to their own line; render-blocking detection reads tag attributes",
          "`createEnv` typing and server/client separation, and the `.env` parser's quoting rules",
        ],
      },
    ],
  },
   {
    version: "1.0.3",
    date: "2026-10-13",
    groups: [
      {
        title: "Fixed",
        items: [
          "Preserve build/prod scan policies and scanner failure exit codes",
          "Retain scanner coverage and diagnostics in unified and agent reports",
          "Repair dependency lockfile entries for clean installs",
        ],
      },
      {
        title: "Changed",
        items: [
          "Prepare @muraqib/core for publishing under the beta dist-tag",
        ],
      },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-10-12",
    groups: [
      {
        title: "Fixed",
        items: [
          "`--upgrade` runs inside the target project (`--path`) instead of the process working directory",
          "Remote presets require HTTPS, time out and are schema-validated",
          "Upgrade orchestrator logs through the shared logger",
          "Web view CSP adds `base-uri 'none'` and `form-action 'none'`",
        ],
      },
    ],
  },
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
