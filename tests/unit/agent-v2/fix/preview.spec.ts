import { rmSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { formatFixPreview } from "../../../../src/agent-v2/fix/preview.js";
import type { FileEdit, ProposedFix } from "../../../../src/agent-v2/fix/types.js";
import { fakeSecret } from "../support.js";
import { BAD_SRC, GOOD_SRC, put, tmp } from "./helpers.js";

const SECRET = fakeSecret();
const OTHER_SECRET = ["sk", "live", "Z9y8X7w6V5u4T3s2R1q0P9o8"].join("_");
const GH_TOKEN = ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
const REMOVED = "-   (line removed; content hidden because it contains a secret)";
const roots: string[] = [];

function project(files: Record<string, string> = {}): string {
  const root = tmp("agent-v2-preview-");
  roots.push(root);
  Object.entries(files).forEach(([file, content]) => put(root, file, content));
  return root;
}

function fix(edits: FileEdit[], removesSecret = false): ProposedFix {
  return { id: "x|t", fixClass: "floating-promise", title: "t", resolves: [], edits, warnings: [], removesSecret };
}

afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("formatFixPreview", () => {
  test("await fix: header, removed and added lines, one line of context", () => {
    const root = project({ "src/a.ts": BAD_SRC });
    const text = formatFixPreview(fix([{ file: "src/a.ts", content: GOOD_SRC }]), root);
    expect(text).toContain("--- src/a.ts");
    expect(text).toContain("-function g(){");
    expect(text).toContain("+async function g(){");
    expect(text).toContain("-  f();");
    expect(text).toContain("+  await f();");
    expect(text).toContain(" async function f(){}");
    expect(text).not.toContain("diff --git");
  });

  test("uses a single line of context", () => {
    const lines = Array.from({ length: 11 }, (_, i) => `const l${i} = ${i};`);
    const changed = lines.map((l, i) => (i === 5 ? "await x();" : l));
    const root = project({ "src/c.ts": `${lines.join("\n")}\n` });
    const text = formatFixPreview(fix([{ file: "src/c.ts", content: `${changed.join("\n")}\n` }]), root);
    expect(text).toContain(" const l4 = 4;");
    expect(text).toContain(" const l6 = 6;");
    expect(text).not.toContain("const l3 = 3;");
    expect(text).not.toContain("const l7 = 7;");
  });

  test("async-wrap fix", () => {
    const root = project({ "src/a.ts": "function g() {\n  return 1;\n}\n" });
    const text = formatFixPreview(fix([{ file: "src/a.ts", content: "async function g() {\n  return 1;\n}\n" }]), root);
    expect(text).toContain("-function g() {");
    expect(text).toContain("+async function g() {");
  });

  test(".catch fix", () => {
    const root = project({ "src/a.ts": "run();\n" });
    const text = formatFixPreview(fix([{ file: "src/a.ts", content: "run().catch((error: unknown) => {\n  throw error;\n});\n" }]), root);
    expect(text).toContain("-run();");
    expect(text).toContain("+run().catch((error: unknown) => {");
  });

  test("env example: new file", () => {
    const root = project();
    const text = formatFixPreview(fix([{ file: ".env.example", content: "PORT=\nHOST=\n" }]), root);
    expect(text).toContain("--- .env.example (new file)");
    expect(text).toContain("+PORT=");
    expect(text).toContain("+HOST=");
  });

  test("env example: append, also to a CRLF file", () => {
    const lf = project({ ".env.example": "A=\n" });
    expect(formatFixPreview(fix([{ file: ".env.example", content: "A=\nB=\n" }]), lf)).toMatch(/ A=\n\+B=$/);
    const crlf = project({ ".env.example": "A=\r\n" });
    const text = formatFixPreview(fix([{ file: ".env.example", content: "A=\r\nB=\r\n" }]), crlf);
    expect(text).toContain("+B=");
    expect(text).not.toContain("\r");
  });

  test("shows several files in order", () => {
    const root = project({ "src/a.ts": BAD_SRC });
    const text = formatFixPreview(fix([{ file: "src/a.ts", content: GOOD_SRC }, { file: ".env.example", content: "K=\n" }]), root);
    expect(text.indexOf("--- src/a.ts")).toBeLessThan(text.indexOf("--- .env.example (new file)"));
  });

  test("secret fix: removed line hidden, process.env line shown", () => {
    const root = project({ "src/config.ts": `export const stripeKey = "${SECRET}";\n` });
    const text = formatFixPreview(fix([{ file: "src/config.ts", content: "export const stripeKey = process.env.STRIPE_KEY;\n" }], true), root);
    expect(text).toContain(REMOVED);
    expect(text).toContain("+export const stripeKey = process.env.STRIPE_KEY;");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("sk_live");
  });

  test("a different secret on a context line next to the edit is not printed", () => {
    const root = project({ "src/c.ts": `const a = "${SECRET}";\nconst b = "${OTHER_SECRET}";\nconst c = 1;\n` });
    const content = `const a = process.env.A;\nconst b = "${OTHER_SECRET}";\nconst c = 1;\n`;
    const text = formatFixPreview(fix([{ file: "src/c.ts", content }], true), root);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(OTHER_SECRET);
    expect(text).toContain(REMOVED);
    expect(text).toContain("+const a = process.env.A;");
    expect(text).toMatch(/\[REDACTED\]|line hidden: looks like a secret/);
  });

  test("two secrets on adjacent lines: fixing one does not print the other (with and without removesSecret)", () => {
    const original = `// ${GH_TOKEN}\nconst a = "${SECRET}";\n// ${OTHER_SECRET}\n`;
    const content = `// ${GH_TOKEN}\nconst a = process.env.A;\n// ${OTHER_SECRET}\n`;
    [true, false].forEach((removesSecret) => {
      const root = project({ "src/c.ts": original });
      const text = formatFixPreview(fix([{ file: "src/c.ts", content }], removesSecret), root);
      [SECRET, OTHER_SECRET, GH_TOKEN].forEach((secret) => expect(text).not.toContain(secret));
      expect(text).toContain("+const a = process.env.A;");
    });
  });

  test("a secret on an edited line of a non-secret fix is redacted too", () => {
    const root = project({ "src/c.ts": `run(); // ${GH_TOKEN}\n` });
    const text = formatFixPreview(fix([{ file: "src/c.ts", content: `await run(); // ${GH_TOKEN}\n` }]), root);
    expect(text).not.toContain(GH_TOKEN);
    expect(text).toContain("[REDACTED]");
  });

  test("the function name git appends to a hunk header is not printed", () => {
    const body = Array.from({ length: 8 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    const original = `function leak_${SECRET}() {\n${body}\n  f();\n}\n`;
    const root = project({ "src/c.ts": original });
    const text = formatFixPreview(fix([{ file: "src/c.ts", content: original.replace("  f();", "  await f();") }]), root);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("+  await f();");
  });

  test("caps each file at 40 lines", () => {
    const original = Array.from({ length: 100 }, (_, i) => `a${i}`).join("\n");
    const modified = Array.from({ length: 100 }, (_, i) => `b${i}`).join("\n");
    const root = project({ "src/big.txt": `${original}\n` });
    const text = formatFixPreview(fix([{ file: "src/big.txt", content: `${modified}\n` }]), root);
    const lines = text.split("\n");
    expect(lines).toHaveLength(1 + 40 + 1);
    expect(lines[lines.length - 1]).toMatch(/^\.\.\. \d+ more line\(s\)$/);
    expect(text).not.toContain("b99");
  });

  test("a missing project folder shows a new file instead of throwing", () => {
    const text = formatFixPreview(fix([{ file: "src/a.ts", content: "x\n" }]), "/nonexistent/muraqib-preview-root");
    expect(text).toContain("--- src/a.ts (new file)");
    expect(text).toContain("+x");
  });

  test("an edit identical to the file reports no changes", () => {
    const root = project({ "src/a.ts": GOOD_SRC });
    expect(formatFixPreview(fix([{ file: "src/a.ts", content: GOOD_SRC }]), root)).toBe("--- src/a.ts\n  (no changes)");
  });

  test("never throws: an edit escaping the project gives a short note", () => {
    const root = project();
    expect(formatFixPreview(fix([{ file: "../evil.ts", content: "x" }]), root)).toBe("(preview unavailable)");
    expect(formatFixPreview(fix([{ file: "/abs.ts", content: "x" }]), root)).toBe("(preview unavailable)");
  });
});
