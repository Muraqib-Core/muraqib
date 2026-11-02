import { afterEach, describe, expect, test } from "vitest";
import { detectUndocumentedEnv } from "../../../src/agent-v2/detectors/env.js";
import { detectHardcodedSecrets } from "../../../src/agent-v2/detectors/secrets.js";
import { ENV_MARKER, SECRET_MARKER } from "../../../src/agent-v2/ignore.js";
import { fakeSecret, makeTmpProject, removeProject, writeProjectFile } from "./support.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeProject(r);
});
function project(files: Record<string, string>): string {
  const root = makeTmpProject("agent-v2-marker-");
  roots.push(root);
  for (const [name, content] of Object.entries(files)) writeProjectFile(root, name, content);
  return root;
}

describe("secret marker", () => {
  test("a marked line is skipped, other lines are still reported with correct line numbers", () => {
    const root = project({
      "src/a.ts": `const a = "${fakeSecret()}"; // ${SECRET_MARKER}\nconst b = "${fakeSecret()}";\n`,
    });
    expect(detectHardcodedSecrets(root).map((i) => i.line)).toEqual([2]);
  });

  test("without the marker the secret is reported", () => {
    const root = project({ "src/a.ts": `const a = "${fakeSecret()}";\n` });
    expect(detectHardcodedSecrets(root)).toHaveLength(1);
  });

  test("the secret detector skips files in .muraqibignore", () => {
    const root = project({ "src/a.ts": `const a = "${fakeSecret()}";\n`, ".muraqibignore": "src/a.ts\n" });
    expect(detectHardcodedSecrets(root)).toEqual([]);
  });
});

describe("env marker", () => {
  const read = (name: string, marked = false): string => `const v = process.env.${name};${marked ? ` // ${ENV_MARKER}` : ""}\n`;

  test("a variable used only on ignored lines is not reported", () => {
    const root = project({ "src/a.ts": read("ONLY_HERE", true), ".env.example": "OTHER=1\n" });
    expect(detectUndocumentedEnv(root)).toEqual([]);
  });

  test("only ignored usages do not trigger ENV_EXAMPLE_MISSING", () => {
    expect(detectUndocumentedEnv(project({ "src/a.ts": read("ONLY_HERE", true) }))).toEqual([]);
  });

  test("also used elsewhere: reported at the first non-ignored usage", () => {
    const root = project({
      "src/a.ts": read("SHARED", true),
      "src/b.ts": `\n${read("SHARED")}${read("SHARED")}`,
      ".env.example": "OTHER=1\n",
    });
    const issues = detectUndocumentedEnv(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: "src/b.ts", line: 2, code: "ENV_UNDOCUMENTED" });
  });

  test("only the marked line is skipped inside one file", () => {
    const root = project({ "src/a.ts": `${read("FIRST", true)}${read("SECOND")}`, ".env.example": "OTHER=1\n" });
    const issues = detectUndocumentedEnv(root);
    expect(issues.map((i) => i.message.split(" ")[0])).toEqual(["SECOND"]);
    expect(issues[0]?.line).toBe(2);
  });

  test("the env detector skips files in .muraqibignore, other files still count", () => {
    const root = project({
      "src/a.ts": read("IGN"),
      "src/b.ts": read("REAL"),
      ".env.example": "OTHER=1\n",
      ".muraqibignore": "src/a.ts\n",
    });
    expect(detectUndocumentedEnv(root).map((i) => i.file)).toEqual(["src/b.ts"]);
  });
});
