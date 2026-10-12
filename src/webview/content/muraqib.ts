import type { PackageInfo } from "../package-info.js";
import { CHANGELOG } from "./changelog.js";
import type { Block, Card, PageContent, SidebarGroup, TabContent, UiLabels } from "./types.js";

/** What each runtime dependency is used for. A unit test fails when a dependency has no entry. */
export const DEPENDENCY_PURPOSE: Readonly<Record<string, string>> = {
  "@clack/prompts": "Interactive prompts and the terminal spinner",
  "@google/genai": "Gemini client for the optional AI advisory",
  arktype: "Environment validation engine (`--engine arktype`)",
  axios: "HTTP client for network probes and the OSV lookup",
  chalk: "Terminal colours in the text report",
  "cron-parser": "Validation of cron schedules",
  glob: "Project file discovery",
  ignore: "`.dockerignore`-style path filtering",
  semver: "Version and peer-dependency comparison",
  valibot: "Environment validation engine (`--engine valibot`)",
  yaml: "Parsing Docker Compose and YAML configuration",
  zod: "Environment validation engine (`--engine zod`) and internal schemas",
};

const LABELS: UiLabels = {
  copy: "Copy",
  copied: "Copied",
  tabsLabel: "Documentation sections",
  skipToContent: "Skip to content",
};

const ISSUE_CARDS: Record<string, Card[]> = {
  Security: [
    { title: "Injection prevention", body: "Detects SQL injection and XSS patterns before they ship." },
    { title: "Secret detection", body: "Finds API keys, passwords, tokens and credentials in code and config." },
    { title: "Auth and crypto validation", body: "Checks security protocols and cryptographic practices." },
    { title: "Security headers", body: "Validates the HTTP security headers a target URL returns.", tags: ["--security-url"] },
  ],
  Performance: [
    { title: "Memory management", body: "Heap leak detection and memory profile analysis.", tags: ["memory-guard"] },
    { title: "Bundle optimization", body: "Size monitoring with a 14 KB default budget." },
    { title: "Network analysis", body: "Latency measurement with optimization recommendations." },
    { title: "Dead code", body: "Unreachable code and unused exports.", tags: ["dead-code-guard"] },
    { title: "Dependency analysis", body: "Circular dependencies and duplication." },
    { title: "Async patterns", body: "Floating promises and missing `await`." },
    { title: "Cache strategy", body: "Caching recommendations and validation.", tags: ["cache-guard"] },
    { title: "Image optimization", body: "Image size analysis and format recommendations." },
    { title: "Render blocking", body: "Detects render-blocking CSS, scripts and fonts." },
    { title: "HTTP/2 support", body: "Protocol and compression optimization." },
  ],
  Architecture: [
    { title: "Configuration validation", body: "Environment variables and config files, through zod, valibot, arktype or a custom engine." },
    { title: "Docker best practices", body: "Pinned base images, non-root users, health checks and secrets in Dockerfiles.", tags: ["--docker"] },
    { title: "Compatibility checking", body: "Node.js EOL versions, deprecated packages and peer dependency conflicts." },
    { title: "Dependency resolution", body: "Evidence-based OSV plans with an approval step and rollback.", tags: ["muraqib resolve"] },
  ],
  "AI integration": [
    { title: "AI-complementary", body: "Built to catch the issues that AI-generated code tends to introduce." },
    { title: "Secret redaction", body: "Secrets are redacted before anything is sent to an AI provider." },
    { title: "Intelligent recommendations", body: "Optional AI advisory with fix suggestions.", tags: ["--ai-advisory"] },
  ],
};

function detailsTab(info: PackageInfo): TabContent {
  const blocks: Block[] = [
    { kind: "heading", level: 2, text: "What is Muraqib Core?" },
    {
      kind: "paragraph",
      text: "Muraqib Core is a unified developer environment guardian and performance auditor for Node.js and TypeScript projects. It detects security vulnerabilities, performance issues, architecture violations and configuration problems, and reports them with a consistent severity model.",
    },
    {
      kind: "callout",
      tone: "tip",
      text: "Muraqib is **AI-complementary**: it is designed to review the code AI assistants write, and it can itself be driven by AI agents through a stable JSON report.",
    },
    { kind: "heading", level: 2, text: "Quick start" },
    {
      kind: "code",
      language: "bash",
      code: [
        "npm install",
        "npm run build",
        "npx muraqib audit                 # text report of every module",
        "npx muraqib audit --format json   # json | text | html | csv",
        "npx muraqib audit --osv           # also check dependencies against OSV",
      ].join("\n"),
    },
    { kind: "heading", level: 2, text: "Commands" },
    {
      kind: "table",
      headers: ["Command", "Purpose"],
      rows: [
        ["`muraqib audit` (default)", "Run the guard modules, optionally adding the scan layer (OSV, Docker, AI advisory)"],
        ["`muraqib resolve`", "Interactive, evidence-based dependency resolution with approval and rollback"],
        ["`muraqib image --image <name>`", "Scan a local Docker image with [Trivy](https://trivy.dev) (must be installed)"],
        ["`muraqib runtime --container <name>`", "Read-only inspection of a running Docker container"],
        ["`muraqib agent`", "Versioned, deterministic JSON report for LLM agents"],
      ],
    },
    { kind: "heading", level: 2, text: "Use it from code" },
    {
      kind: "code",
      language: "typescript",
      code: [
        `import { runAuditForAgent } from "${info.name}";`,
        "",
        "const report = await runAuditForAgent({ projectRoot: process.cwd(), osv: true, maxIssues: 50 });",
        '// { ok, verdict: "pass" | "fail", summary, modules, issues[], truncated }',
      ].join("\n"),
    },
  ];
  return { id: "details", title: "Details", blocks };
}

function featuresTab(): TabContent {
  const blocks: Block[] = [];
  for (const [group, cards] of Object.entries(ISSUE_CARDS)) {
    blocks.push({ kind: "heading", level: 2, text: group }, { kind: "cards", cards });
  }
  blocks.push(
    { kind: "heading", level: 2, text: "Severity levels" },
    {
      kind: "table",
      headers: ["Level", "Typical issues", "Response"],
      rows: [
        ["**critical**", "Security breach, data loss", "Fix immediately"],
        ["**error**", "Broken functionality, major bugs", "Fix before release"],
        ["**warning**", "Potential issues, anti-patterns", "Address soon"],
        ["**info**", "Suggestions, improvements", "Consider for the next cycle"],
      ],
    }
  );
  return { id: "features", title: "Features", blocks };
}

function installationTab(info: PackageInfo): TabContent {
  const repo = info.repositoryUrl ?? "https://github.com/Muraqib-Core/muraqib";
  return {
    id: "installation",
    title: "Installation",
    blocks: [
      { kind: "heading", level: 2, text: "From source" },
      {
        kind: "code",
        language: "bash",
        code: [`git clone ${repo}.git`, "cd muraqib", "npm install", "npm run build", "npm test"].join("\n"),
      },
      { kind: "heading", level: 2, text: "Run an audit" },
      {
        kind: "code",
        language: "bash",
        code: [
          "npm run audit        # audit the current project",
          "npm run audit:demo   # run against the bundled sample project",
          "npm run dev          # development mode with watch",
        ].join("\n"),
      },
      { kind: "heading", level: 2, text: "Verify your checkout" },
      {
        kind: "code",
        language: "bash",
        code: ["npm run type-check", "npm run build", "npm run lint", "npm test"].join("\n"),
      },
      {
        kind: "callout",
        tone: "info",
        text: `Muraqib needs Node.js **${info.nodeEngine}**. After \`npm run build\` the \`muraqib\` binary is available as \`bin/muraqib.js\`.`,
      },
    ],
  };
}

function configurationTab(): TabContent {
  return {
    id: "configuration",
    title: "Configuration",
    blocks: [
      { kind: "heading", level: 2, text: "Command-line options" },
      {
        kind: "table",
        headers: ["Flag", "Effect"],
        rows: [
          ["`-p, --project <path>`", "Project root (default: current directory)"],
          ["`-f, --format <fmt>`", "`text`, `json`, `html` or `csv`"],
          ["`-o, --output <path>`", "Write the report to a file instead of stdout"],
          ["`-m, --modules <list>`", "Comma-separated module name filter"],
          ["`--osv`", "Check dependencies against [OSV](https://osv.dev) for known vulnerabilities"],
          ["`--docker`", "Discover and check Dockerfile and Compose configuration"],
          ["`--ai-advisory`", "Add an optional AI advisory (needs `GEMINI_API_KEY`)"],
          ["`-e, --env <mode>`", "Blocking policy for the scan layer: `build` (default) or `prod`"],
          ["`--engine <name>`", "Env-validation engine: `custom`, `zod`, `valibot` or `arktype`"],
          ["`--fail-on-warning`", "Treat warnings as failures"],
          ["`-i, --interactive` / `--no-interactive`", "Choose optional scans from a menu, or force prompts off"],
        ],
      },
      { kind: "heading", level: 2, text: "Environment variables" },
      {
        kind: "table",
        headers: ["Variable", "Purpose"],
        rows: [
          ["`GEMINI_API_KEY`", "Enables the AI advisory. `GOOGLE_API_KEY` is still accepted as a legacy alias"],
          ["`OSV_API_URL`", "Override the OSV endpoint (default `https://api.osv.dev/v1/query`)"],
          ["`OSV_TIMEOUT`", "OSV request timeout in milliseconds (default `10000`)"],
          ["`CI`", "When `true`, interactive output is switched off automatically"],
        ],
      },
      {
        kind: "code",
        language: "dotenv",
        code: ["# .env", "GEMINI_API_KEY=", "# OSV_API_URL=https://api.osv.dev/v1/query", "# OSV_TIMEOUT=10000"].join("\n"),
      },
      { kind: "heading", level: 2, text: "Exit codes" },
      {
        kind: "table",
        headers: ["Code", "Meaning"],
        rows: [
          ["`0`", "No blocking findings"],
          ["`1`", "Blocking findings (critical or high; warnings too with `--fail-on-warning`)"],
          ["`3`", "A scanner failed, so the result is not reliable"],
          ["`130`", "Interactive prompt cancelled by the user"],
        ],
      },
      {
        kind: "callout",
        tone: "warning",
        text: "Interactive output is turned off for `--json`, `--format`, `--output`, piped output and CI so machine-readable output is never polluted.",
      },
    ],
  };
}

function requirementsTab(info: PackageInfo): TabContent {
  const rows = Object.entries(info.dependencies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, range]) => [`\`${name}\``, `\`${range}\``, DEPENDENCY_PURPOSE[name] ?? "Runtime dependency"]);
  const platform: string[][] = [["Node.js", `\`${info.nodeEngine}\``]];
  if (info.npmEngine !== undefined) platform.push(["npm", `\`${info.npmEngine}\``]);
  platform.push(["Trivy (optional)", "Only for `muraqib image`; must be installed separately"]);
  platform.push(["Gemini API key (optional)", "Only for `--ai-advisory`"]);
  return {
    id: "requirements",
    title: "Requirements",
    blocks: [
      { kind: "heading", level: 2, text: "Platform" },
      { kind: "table", headers: ["Requirement", "Version"], rows: platform },
      { kind: "heading", level: 2, text: "Runtime dependencies" },
      { kind: "table", headers: ["Package", "Range", "Used for"], rows },
    ],
  };
}

function changelogTab(): TabContent {
  const blocks: Block[] = [];
  for (const release of CHANGELOG) {
    blocks.push({ kind: "heading", level: 2, text: `${release.version} - ${release.date}` });
    for (const group of release.groups) {
      blocks.push({ kind: "heading", level: 3, text: group.title }, { kind: "list", items: group.items });
    }
  }
  return { id: "changelog", title: "Changelog", blocks };
}

function sidebar(info: PackageInfo): SidebarGroup[] {
  const links: SidebarGroup = { title: "Resources", items: [] };
  if (info.repositoryUrl !== undefined) links.items.push({ label: "Repository", value: "GitHub", href: info.repositoryUrl });
  if (info.bugsUrl !== undefined) links.items.push({ label: "Issues", value: "Report a bug", href: info.bugsUrl });
  if (info.homepage !== undefined) links.items.push({ label: "Homepage", value: "README", href: info.homepage });
  const groups: SidebarGroup[] = [
    {
      title: "More info",
      items: [
        { label: "Version", value: info.version },
        { label: "License", value: info.license },
        { label: "Node.js", value: info.nodeEngine },
      ],
    },
  ];
  if (links.items.length > 0) groups.push(links);
  return groups;
}

/** Build the English documentation content for Muraqib Core from its `package.json` data. */
export function createMuraqibContent(info: PackageInfo): PageContent {
  return {
    lang: "en",
    dir: "ltr",
    name: "Muraqib Core",
    tagline: "Unified developer environment guardian and performance auditor for Node.js and TypeScript.",
    version: info.version,
    badges: ["Security", "Performance", "Architecture", "AI-complementary", `License ${info.license}`],
    labels: LABELS,
    tabs: [
      detailsTab(info),
      featuresTab(),
      installationTab(info),
      configurationTab(),
      requirementsTab(info),
      changelogTab(),
    ],
    sidebar: sidebar(info),
  };
}
