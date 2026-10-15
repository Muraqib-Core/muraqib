/**
 * Documentation generator.
 *
 * Keeps the facts in the docs (versions, guards, CLI flags, public API, npm scripts,
 * CI workflows) in sync with the source of truth instead of hand-maintained copies.
 *
 *   node scripts/generate-docs.mjs          # rewrite generated docs in place
 *   node scripts/generate-docs.mjs --check  # exit 1 if any generated doc is stale (CI)
 *
 * Two kinds of output:
 *   1. docs/REFERENCE.md                       - fully generated file.
 *   2. <!-- AUTO:name:start --> ... <!-- AUTO:name:end --> blocks inside hand-written
 *      Markdown files (README.md, API.md, CONTRIBUTING.md). Only the content between
 *      the markers is replaced; everything else stays under human control.
 *
 * Output is deterministic (no timestamps, sorted lists) so `--check` has no false positives.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const read = (rel) => readFileSync(join(root, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));
const escapeCell = (text) => String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const major = (range) => String(range ?? "").replace(/^[^\d]*/, "").split(".")[0] ?? "";
const minVersion = (range) => String(range ?? "").replace(/^[^\d]*/, "");

const pkg = readJson("package.json");

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

function walk(dir, predicate, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, predicate, out);
    else if (predicate(rel)) out.push(rel);
  }
  return out;
}

/** First sentence of the JSDoc block that precedes `index` in `source`. */
function leadingSummary(source, index) {
  const before = source.slice(0, index);
  const end = before.lastIndexOf("*/");
  if (end === -1 || before.slice(end + 2).trim() !== "") return "";
  const start = before.lastIndexOf("/**", end);
  if (start === -1) return "";
  const lines = before
    .slice(start + 3, end)
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").trim());
  const text = [];
  for (const line of lines) {
    if (line.startsWith("@") || line.startsWith("```")) break;
    if (line === "" && text.length > 0) break;
    if (line !== "") text.push(line);
  }
  return text.join(" ").replace(/\s+/g, " ").trim();
}

/** Every concrete class that extends BaseGuard, with its JSDoc summary. */
function collectGuards() {
  const files = walk("src", (p) => p.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(p));
  const guards = [];
  for (const file of files) {
    const source = read(file);
    const re = /^export class (\w+) extends BaseGuard\b/gm;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      guards.push({ name: m[1], file, summary: leadingSummary(source, m.index) });
    }
  }
  return guards.sort((a, b) => a.name.localeCompare(b.name));
}

/** Public API of src/index.ts, resolved through the TypeScript compiler. */
function collectPublicApi() {
  const configPath = join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram({
    rootNames: [join(root, "src/index.ts")],
    options: { ...parsed.options, noEmit: true },
  });
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(join(root, "src/index.ts"));
  const moduleSymbol = entry && checker.getSymbolAtLocation(entry);
  if (!moduleSymbol) throw new Error("Cannot resolve src/index.ts exports");

  const kindOf = (symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const f = target.flags;
    if (f & ts.SymbolFlags.Class) return "class";
    if (f & ts.SymbolFlags.Function) return "function";
    if (f & ts.SymbolFlags.Interface) return "interface";
    if (f & ts.SymbolFlags.TypeAlias) return "type";
    if (f & ts.SymbolFlags.Enum) return "enum";
    if (f & ts.SymbolFlags.Namespace || f & ts.SymbolFlags.ValueModule) return "namespace";
    if (f & ts.SymbolFlags.Variable) {
      const declaration = target.valueDeclaration;
      const type = declaration ? checker.getTypeOfSymbolAtLocation(target, declaration) : undefined;
      return type && type.getCallSignatures().length > 0 ? "function" : "const";
    }
    return "other";
  };

  const rows = checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const summary = ts
      .displayPartsToString(target.getDocumentationComment(checker))
      .split("\n\n")[0]
      .replace(/\s+/g, " ")
      .trim();
    const declaration = target.declarations?.[0];
    const file = declaration ? relative(root, declaration.getSourceFile().fileName).split("\\").join("/") : "";
    return { name: symbol.getName(), kind: kindOf(symbol), summary, file };
  });
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** Flags recognised by the CLI argument parsers (src/cli/audit-cli.ts + src/cli/index.ts). */
function collectCliFlags() {
  const flags = new Set();
  for (const file of ["src/cli/index.ts", "src/cli/audit-cli.ts", "src/scan/cli.ts"]) {
    if (!existsSync(join(root, file))) continue;
    for (const m of read(file).matchAll(/["'](--[a-z][a-z0-9]*(?:-[a-z0-9]+)*)["']/g)) flags.add(m[1]);
  }
  return [...flags].sort();
}

function collectCliCommands() {
  const commands = new Set(["audit"]);
  const source = read("src/cli/index.ts");
  for (const m of source.matchAll(/arg === ["']([a-z][a-z-]*)["']/g)) commands.add(m[1]);
  const union = /command\?: ((?:"[a-z-]+"(?: \| )?)+)/.exec(source);
  if (union) for (const m of union[1].matchAll(/"([a-z-]+)"/g)) commands.add(m[1]);
  return [...commands].sort();
}

function collectWorkflows() {
  const dir = ".github/workflows";
  return readdirSync(join(root, dir))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const doc = parseYaml(read(`${dir}/${file}`));
      const on = doc.on ?? doc.true ?? {};
      const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on);
      const jobs = Object.entries(doc.jobs ?? {}).map(([id, job]) => ({
        id,
        name: job.name ?? id,
        needs: [job.needs ?? []].flat(),
        matrix: job.strategy?.matrix ?? null,
      }));
      return { file, name: doc.name ?? file, triggers, jobs };
    });
}

// ---------------------------------------------------------------------------
// Renderers (each returns Markdown without the surrounding AUTO markers)
// ---------------------------------------------------------------------------

function renderFacts() {
  const dev = pkg.devDependencies ?? {};
  const rows = [
    ["Package", `\`${pkg.name}\``],
    ["Version", `\`${pkg.version}\``],
    ["License", pkg.license],
    ["Node.js", `\`${pkg.engines?.node ?? "n/a"}\``],
    ["TypeScript (dev)", `\`${dev.typescript ?? "n/a"}\``],
    ["Test runner", `Vitest \`${dev.vitest ?? "n/a"}\``],
    ["CLI binary", Object.keys(pkg.bin ?? {}).map((b) => `\`${b}\``).join(", ")],
  ];
  return ["| Fact | Value |", "|------|-------|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

function renderBadges() {
  const dev = pkg.devDependencies ?? {};
  const node = minVersion(pkg.engines?.node);
  const nodeShort = node.split(".").slice(0, 2).join(".");
  return [
    `[![TypeScript](https://img.shields.io/badge/TypeScript-${major(dev.typescript)}.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)`,
    `[![Node.js](https://img.shields.io/badge/Node.js-${nodeShort}+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)`,
    `[![Vitest](https://img.shields.io/badge/Vitest-${major(dev.vitest)}.x-729B1B?logo=vitest&logoColor=white)](https://vitest.dev)`,
    "[![CI/CD](https://img.shields.io/github/actions/workflow/status/Muraqib-Core/muraqib/ci.yml?branch=main&label=CI%2FCD&logo=github)](https://github.com/Muraqib-Core/muraqib/actions/workflows/ci.yml)",
    `[![License](https://img.shields.io/badge/License-${encodeURIComponent(pkg.license)}-yellow.svg)](LICENSE)`,
  ].join("\n");
}

function renderRequirements() {
  const dev = pkg.devDependencies ?? {};
  return [
    `- Node.js ${minVersion(pkg.engines?.node)}+ (see \`engines.node\` in \`package.json\`)`,
    `- npm ${minVersion(pkg.engines?.npm)}+`,
    `- TypeScript ${major(dev.typescript)}.x for development (the published package ships compiled JavaScript and \`.d.ts\` files)`,
  ].join("\n");
}

function renderPeerDeps() {
  const optional = pkg.peerDependenciesMeta ?? {};
  const cell = (name) => (optional[name]?.optional ? "optional" : "required");
  const rows = Object.entries(pkg.peerDependencies ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return [
    "| Package | Range | Kind | Install |",
    "|---------|-------|------|---------|",
    ...rows.map(([name, range]) => `| \`${name}\` | \`${range}\` | ${cell(name)} | \`npm i ${name}\` |`),
  ].join("\n");
}

function renderGuards(guards) {
  return [
    "| Guard | Source | Purpose |",
    "|-------|--------|---------|",
    ...guards.map((g) => `| \`${g.name}\` | \`${g.file}\` | ${escapeCell(g.summary || "-")} |`),
  ].join("\n");
}

function renderScripts() {
  const rows = Object.entries(pkg.scripts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return [
    "| Script | Command |",
    "|--------|---------|",
    ...rows.map(([name, cmd]) => `| \`npm run ${name}\` | \`${escapeCell(cmd)}\` |`),
  ].join("\n");
}

function renderCli(commands, flags) {
  return [
    `Commands: ${commands.map((c) => `\`${c}\``).join(", ")}`,
    "",
    `Flags: ${flags.map((f) => `\`${f}\``).join(", ")}`,
    "",
    "Run `muraqib --help` for the description of each flag.",
  ].join("\n");
}

function renderPublicApi(api) {
  const groups = new Map();
  for (const item of api) {
    if (!groups.has(item.kind)) groups.set(item.kind, []);
    groups.get(item.kind).push(item);
  }
  const out = [];
  for (const [kind, items] of groups) {
    out.push(`### ${kind[0].toUpperCase()}${kind.slice(1)} (${items.length})`, "");
    out.push("| Export | Description | Source |", "|--------|-------------|--------|");
    for (const item of items) {
      out.push(`| \`${item.name}\` | ${escapeCell(item.summary || "-")} | \`${item.file}\` |`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function renderWorkflows(workflows) {
  const out = ["| Workflow | File | Triggers | Jobs |", "|----------|------|----------|------|"];
  for (const wf of workflows) {
    const jobs = wf.jobs.map((j) => `\`${j.id}\``).join(", ");
    out.push(`| ${escapeCell(wf.name)} | \`.github/workflows/${wf.file}\` | ${wf.triggers.join(", ")} | ${jobs} |`);
  }
  return out.join("\n");
}

function renderCiJobs(workflows) {
  const ci = workflows.find((w) => w.file === "ci.yml");
  if (!ci) return "_No ci.yml workflow found._";
  const out = [];
  for (const job of ci.jobs) {
    const matrix = job.matrix
      ? ` (matrix: ${Object.entries(job.matrix)
          .map(([k, v]) => `${k} ${[v].flat().join(", ")}`)
          .join("; ")})`
      : "";
    const needs = job.needs.length > 0 ? ` - needs: ${job.needs.map((n) => `\`${n}\``).join(", ")}` : "";
    out.push(`- **${job.name}** (\`${job.id}\`)${matrix}${needs}`);
  }
  return out.join("\n");
}

function renderReference({ guards, api, flags, commands, workflows }) {
  return [
    "# Reference (generated)",
    "",
    "> **Do not edit this file by hand.** It is generated from the source code, `package.json`",
    "> and `.github/workflows/` by `npm run docs:generate` and kept fresh by the `Docs` workflow.",
    "",
    "## Project facts",
    "",
    renderFacts(),
    "",
    "## Optional and peer dependencies",
    "",
    renderPeerDeps(),
    "",
    "## npm scripts",
    "",
    renderScripts(),
    "",
    "## CLI",
    "",
    renderCli(commands, flags),
    "",
    "## Guards (classes extending `BaseGuard`)",
    "",
    renderGuards(guards),
    "",
    "## CI/CD workflows",
    "",
    renderWorkflows(workflows),
    "",
    "### CI pipeline jobs",
    "",
    renderCiJobs(workflows),
    "",
    `## Public API (\`src/index.ts\`, ${api.length} exports)`,
    "",
    renderPublicApi(api),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const guards = collectGuards();
const api = collectPublicApi();
const flags = collectCliFlags();
const commands = collectCliCommands();
const workflows = collectWorkflows();

const blocks = {
  badges: renderBadges(),
  facts: renderFacts(),
  requirements: renderRequirements(),
  "peer-deps": renderPeerDeps(),
  guards: renderGuards(guards),
  scripts: renderScripts(),
  cli: renderCli(commands, flags),
  workflows: renderWorkflows(workflows),
  "ci-jobs": renderCiJobs(workflows),
};

const targets = [];

/** Replace the content of every AUTO block in a hand-written file. */
function injectBlocks(rel) {
  const original = read(rel);
  const used = new Set();
  const updated = original.replace(
    /<!-- AUTO:([a-z-]+):start -->[\s\S]*?<!-- AUTO:\1:end -->/g,
    (_match, name) => {
      if (!(name in blocks)) throw new Error(`${rel}: unknown AUTO block "${name}"`);
      used.add(name);
      return `<!-- AUTO:${name}:start -->\n${blocks[name]}\n<!-- AUTO:${name}:end -->`;
    },
  );
  targets.push({ rel, original, updated });
}

for (const file of ["README.md", "API.md", "CONTRIBUTING.md"]) injectBlocks(file);

const referencePath = "docs/REFERENCE.md";
targets.push({
  rel: referencePath,
  original: existsSync(join(root, referencePath)) ? read(referencePath) : "",
  updated: renderReference({ guards, api, flags, commands, workflows }),
});

const stale = targets.filter((t) => t.original !== t.updated);

if (checkOnly) {
  if (stale.length > 0) {
    process.stderr.write(
      `Generated docs are out of date:\n${stale.map((t) => `  - ${t.rel}`).join("\n")}\nRun "npm run docs:generate" and commit the result.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`Docs are up to date (${targets.length} files checked).\n`);
} else {
  for (const t of stale) {
    mkdirSync(dirname(join(root, t.rel)), { recursive: true });
    writeFileSync(join(root, t.rel), t.updated, "utf8");
    process.stdout.write(`updated ${t.rel}\n`);
  }
  if (stale.length === 0) process.stdout.write("Docs already up to date.\n");
}
