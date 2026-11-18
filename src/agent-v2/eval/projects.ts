/**
 * Synthetic projects with KNOWN planted problems, used to measure the agent-v2 fixers honestly.
 *
 * Every project is an in-memory file map written to a temp folder at run time. Fake secrets are
 * assembled from string parts when {@link buildEvalProjects} runs, so no secret-like literal is
 * ever committed. Each planted problem carries its expected outcome and a ground-truth check that
 * runs on the FINAL working tree (the expectation is written down before the fixers run and is
 * never adjusted to match what they do).
 */

export type ProblemKind = "floating-promise" | "hardcoded-secret" | "env-documentation";

/** `fix`: the file must end up repaired. `decision`: the fixer must ask. `skip`: the fixer must leave it alone. */
export type ExpectedOutcome = "fix" | "decision" | "skip";

/** Project-relative path (with `/`) to file content. */
export type FileTree = ReadonlyMap<string, string>;

/** One planted problem and how to verify the outcome. */
export interface PlantedProblem {
  id: string;
  kind: ProblemKind;
  expected: ExpectedOutcome;
  /** File whose content the fixer must change (or must NOT change for decision/skip). */
  file: string;
  description: string;
  /** Ground truth on the final tree. `original` is the tree as planted. Must be false before any fix for `fix` problems. */
  check(finalTree: FileTree, original: FileTree): boolean;
}

export interface EvalProject {
  id: string;
  description: string;
  files: FileTree;
  problems: PlantedProblem[];
  /** Every fake secret value planted in the project (used to prove none leaks into output). */
  secrets: string[];
}

const ENV_EXAMPLE = ".env.example";

/** Lines of `text` as a set-like lookup: true when `snippet` appears as whole, contiguous line(s). */
function hasLines(text: string | undefined, snippet: string): boolean {
  // Regex /\r\n/g: accepts a Windows line break "a\r\nb" (becomes "a\nb"); rejects a lone "\n" (left as is).
  return text !== undefined && `\n${text.replace(/\r\n/g, "\n")}\n`.includes(`\n${snippet}\n`);
}

/** True when the file ends up with the statement given an `await` and the bare statement is gone. */
function awaited(finalTree: FileTree, file: string, statement: string): boolean {
  const text = finalTree.get(file);
  // Regex /^\s*/: accepts the leading blanks of "  fetch(x);" (two spaces); it also matches "" for "fetch(x);".
  const indent = /^\s*/.exec(statement)?.[0] ?? "";
  return hasLines(text, `${indent}await ${statement.trimStart()}`) && !hasLines(text, statement);
}

/** True when no file in the tree contains `value`. */
function absentEverywhere(finalTree: FileTree, value: string): boolean {
  return [...finalTree.values()].every((text) => !text.includes(value));
}

/** `NAME=` with an empty value is documented in `.env.example`. */
function documentsEmpty(finalTree: FileTree, name: string): boolean {
  return hasLines(finalTree.get(ENV_EXAMPLE), `${name}=`);
}

function problem(p: PlantedProblem): PlantedProblem {
  return p;
}

function floatingFix(id: string, file: string, statement: string, description: string): PlantedProblem {
  return problem({ id, kind: "floating-promise", expected: "fix", file, description, check: (final) => awaited(final, file, statement) });
}

function unchanged(id: string, kind: ProblemKind, expected: "decision" | "skip", file: string, snippet: string, description: string): PlantedProblem {
  return problem({ id, kind, expected, file, description, check: (final) => hasLines(final.get(file), snippet) });
}

function secretFix(id: string, file: string, value: string, envName: string, description: string, extra?: (final: FileTree) => boolean): PlantedProblem {
  return problem({
    id,
    kind: "hardcoded-secret",
    expected: "fix",
    file,
    description,
    check: (final) =>
      absentEverywhere(final, value) &&
      (final.get(file) ?? "").includes(`process.env.${envName}`) &&
      documentsEmpty(final, envName) &&
      (extra?.(final) ?? true),
  });
}

function envFix(id: string, name: string, description: string): PlantedProblem {
  return problem({ id, kind: "env-documentation", expected: "fix", file: ENV_EXAMPLE, description, check: (final) => documentsEmpty(final, name) });
}

function tree(entries: Record<string, string>): FileTree {
  return new Map(Object.entries(entries));
}

const PACKAGE_JSON = `${JSON.stringify({ name: "eval-project", version: "1.0.0" })}\n`;

/** Fake Stripe-style live key, assembled at run time. `tag` makes each one distinct. */
function fakeStripeKey(tag: string): string {
  return ["sk", "live", `${tag}A1b2C3d4E5f6G7h8I9j0`].join("_");
}

/** Fake password value, assembled at run time. */
function fakePassword(): string {
  return ["Zq7", "Lm2", "Xv9", "Rk4", "Wt8"].join("-");
}

/** Fake PEM-like private key (header, body, footer) assembled at run time. */
function fakePem(): { header: string; body: string; footer: string } {
  return {
    header: ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "),
    body: ["MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "BKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj"].join(""),
    footer: ["-----END", "PRIVATE", "KEY-----"].join(" "),
  };
}

function projectA(): EvalProject {
  const stripe = fakeStripeKey("a");
  const password = fakePassword();
  const orders = [
    "export async function syncOrders(base: string): Promise<void> {",
    "  fetch(`${base}/orders`);",
    "  fetch(`${base}/orders/refresh`, {",
    '    method: "POST",',
    '    headers: { "content-type": "application/json" },',
    "  });",
    "  console.log(\"synced\");",
    "}",
    "",
    "export const notifyAll = async (urls: string[]): Promise<void> => {",
    '  fetch(urls[0] ?? "/ping");',
    "};",
    "",
  ].join("\n");
  const files = tree({
    "package.json": PACKAGE_JSON,
    "src/orders.ts": orders,
    "src/payments.ts": `export const stripeKey = "${stripe}";\n`,
    "src/admin.ts": `export const adminPassword = "${password}";\n`,
    "src/config.ts": [
      "export const port = Number(process.env.PORT ?? \"3000\");",
      "export const dbHost = process.env.DATABASE_HOST ?? \"localhost\";",
      "export const issuer = process.env.JWT_ISSUER ?? \"api\";",
      "export const logLevel = process.env.LOG_LEVEL ?? \"info\";",
      "",
    ].join("\n"),
  });
  return {
    id: "api-basic",
    description: "Clear cases: floating promises in async code, two hardcoded secrets, undocumented env vars and no .env.example",
    files,
    secrets: [stripe, password],
    problems: [
      floatingFix("a-fp-simple", "src/orders.ts", "  fetch(`${base}/orders`);", "single-line floating fetch in an async function"),
      floatingFix("a-fp-multiline", "src/orders.ts", "  fetch(`${base}/orders/refresh`, {", "multi-line floating fetch statement in an async function"),
      floatingFix("a-fp-arrow", "src/orders.ts", '  fetch(urls[0] ?? "/ping");', "floating fetch inside an async arrow function"),
      secretFix("a-secret-stripe", "src/payments.ts", stripe, "STRIPE_KEY", "Stripe-style key in a const, expected process.env.STRIPE_KEY"),
      secretFix("a-secret-password", "src/admin.ts", password, "ADMIN_PASSWORD", "password assignment, expected process.env.ADMIN_PASSWORD"),
      envFix("a-env-port", "PORT", "PORT is read but there is no .env.example"),
      envFix("a-env-db-host", "DATABASE_HOST", "DATABASE_HOST is read but undocumented"),
      envFix("a-env-jwt", "JWT_ISSUER", "JWT_ISSUER is read but undocumented"),
      envFix("a-env-log", "LOG_LEVEL", "LOG_LEVEL is read but undocumented"),
    ],
  };
}

function projectB(): EvalProject {
  const stripe = fakeStripeKey("b");
  const envExample = "# Worker settings - edit me\nQUEUE_URL=redis://localhost:6379\n\nSTRIPE_KEY=\n";
  const billingLine = "export const stripeSecret = process.env.STRIPE_KEY;";
  const files = tree({
    "package.json": PACKAGE_JSON,
    [ENV_EXAMPLE]: envExample,
    "src/worker.ts": [
      "export class Worker {",
      "  private readonly queue = process.env.QUEUE_URL ?? \"\";",
      "  private readonly timeout = Number(process.env.WORKER_TIMEOUT_MS ?? \"5000\");",
      "",
      "  async run(): Promise<number> {",
      "    fetch(`${this.queue}/next`);",
      "    return this.timeout;",
      "  }",
      "}",
      "",
    ].join("\n"),
    "src/metrics.ts": 'export const metricsPort = Number(process.env.METRICS_PORT ?? "9100");\n',
    "src/billing.ts": `${billingLine}\n`,
    "src/clients.ts": ["export const clients = {", '  region: "eu-west-1",', `  stripeKey: "${stripe}",`, "};", ""].join("\n"),
  });
  return {
    id: "worker-partial",
    description: "Partial .env.example to preserve, a floating promise in an async method, a secret in an object property whose natural name is already taken",
    files,
    secrets: [stripe],
    problems: [
      problem({
        id: "b-env-preserved",
        kind: "env-documentation",
        expected: "fix",
        file: ENV_EXAMPLE,
        description: "the existing .env.example must be kept byte for byte, with only missing names appended",
        check: (final) => (final.get(ENV_EXAMPLE) ?? "").startsWith(envExample) && documentsEmpty(final, "WORKER_TIMEOUT_MS"),
      }),
      envFix("b-env-metrics", "METRICS_PORT", "METRICS_PORT is read but missing from the partial .env.example"),
      floatingFix("b-fp-method", "src/worker.ts", "    fetch(`${this.queue}/next`);", "floating fetch in an async class method"),
      secretFix("b-secret-collision", "src/clients.ts", stripe, "STRIPE_KEY_2", "secret in an object property; STRIPE_KEY is already used and documented, so the new name must be STRIPE_KEY_2", (final) =>
        hasLines(final.get("src/billing.ts"), billingLine) && hasLines(final.get(ENV_EXAMPLE), "STRIPE_KEY=")
      ),
    ],
  };
}

function projectC(): EvalProject {
  const first = fakeStripeKey("c1");
  const second = fakeStripeKey("c2");
  const templated = fakeStripeKey("c3");
  const pem = fakePem();
  const pemLines = [`export const pem = \`${pem.header}`, pem.body, `${pem.footer}\`;`];
  const files = tree({
    "package.json": PACKAGE_JSON,
    "src/plain.ts": ["export function warm(): void {", '  fetch("/warm");', "}", ""].join("\n"),
    "src/callback.ts": [
      "export async function load(done: Promise<void>): Promise<void> {",
      "  await done;",
      "  done.then(() => {",
      '    fetch("/after");',
      "  });",
      "}",
      "",
    ].join("\n"),
    "src/boot.ts": 'fetch("/boot");\n',
    "src/easy.ts": ["export async function ping(): Promise<void> {", '  fetch("/ping");', "}", ""].join("\n"),
    "src/pair.ts": `export const keys = ["${first}", "${second}"];\n`,
    "src/template.ts": `export const auth = \`\${prefix}${templated}\`;\n`,
    "src/pem.ts": `${pemLines.join("\n")}\n`,
  });
  return {
    id: "tricky",
    description: "Cases where the right behaviour is to ask or to leave the code alone, plus one easy await",
    files,
    secrets: [first, second, templated, pem.body],
    problems: [
      unchanged("c-fp-plain", "floating-promise", "decision", "src/plain.ts", '  fetch("/warm");', "floating promise in a plain (non-async) function: must ask"),
      unchanged("c-fp-then-callback", "floating-promise", "decision", "src/callback.ts", '    fetch("/after");', "floating promise inside a .then callback: must ask, not edit"),
      unchanged("c-fp-top-level", "floating-promise", "decision", "src/boot.ts", 'fetch("/boot");', "floating promise at module top level: must ask"),
      floatingFix("c-fp-easy", "src/easy.ts", '  fetch("/ping");', "the one easy await in an async function"),
      unchanged("c-secret-two-on-line", "hardcoded-secret", "skip", "src/pair.ts", `export const keys = ["${first}", "${second}"];`, "two secret literals on one line: ambiguous, must skip"),
      unchanged("c-secret-template", "hardcoded-secret", "skip", "src/template.ts", `export const auth = \`\${prefix}${templated}\`;`, "secret inside a template literal with interpolation: must skip"),
      unchanged("c-secret-pem", "hardcoded-secret", "skip", "src/pem.ts", pemLines.join("\n"), "multi-line PEM-like secret: must skip"),
    ],
  };
}

/**
 * Builds the three evaluation projects. Secrets are generated here, at run time, from string parts.
 *
 * @returns Fresh project definitions (A "api-basic", B "worker-partial", C "tricky")
 */
export function buildEvalProjects(): EvalProject[] {
  return [projectA(), projectB(), projectC()];
}
