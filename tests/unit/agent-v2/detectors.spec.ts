import { afterEach, describe, expect, test } from "vitest";
import { detectUndocumentedEnv } from "../../../src/agent-v2/detectors/env.js";
import { detectHardcodedSecrets } from "../../../src/agent-v2/detectors/secrets.js";
import { fakeSecret, makeTmpProject, removeProject, writeProjectFile } from "./support.js";

const roots: string[] = [];
const project = (): string => {
  const root = makeTmpProject();
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const r of roots.splice(0)) removeProject(r);
});

describe("detectHardcodedSecrets", () => {
  test("reports location and never leaks the secret value", () => {
    const root = project();
    const secret = fakeSecret();
    writeProjectFile(root, "src/config.ts", `export const k: string = "${secret}";\n`);
    const issues = detectHardcodedSecrets(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ module: "agent-v2-secrets", severity: "critical", file: "src/config.ts", line: 1 });
    const json = JSON.stringify(issues);
    expect(json).not.toContain(secret);
    expect(json).not.toContain(secret.slice(0, 15));
  });

  test("clean project yields nothing", () => {
    const root = project();
    writeProjectFile(root, "src/a.ts", "export const a = 1;\n");
    expect(detectHardcodedSecrets(root)).toEqual([]);
  });
});

describe("detectUndocumentedEnv", () => {
  test("missing .env.example gives a single ENV_EXAMPLE_MISSING", () => {
    const root = project();
    writeProjectFile(root, "src/a.ts", "export const a = process.env.A_VAR;\nexport const b = process.env.B_VAR;\n");
    const issues = detectUndocumentedEnv(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("ENV_EXAMPLE_MISSING");
    expect(issues[0]?.message).toContain("A_VAR");
    expect(issues[0]?.message).toContain("B_VAR");
  });

  test("undocumented var reported with file and line", () => {
    const root = project();
    writeProjectFile(root, ".env.example", "DOCUMENTED=1\n");
    writeProjectFile(root, "src/a.ts", "const x = 1;\nexport const a = process.env.DOCUMENTED;\nexport const b = process.env.SECRET_THING;\n");
    const issues = detectUndocumentedEnv(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "ENV_UNDOCUMENTED", file: "src/a.ts", line: 3 });
    expect(issues[0]?.message).toContain("SECRET_THING");
  });

  test("builtin NODE_ENV and CI ignored", () => {
    const root = project();
    writeProjectFile(root, "src/a.ts", "export const a = process.env.NODE_ENV;\nexport const b = process.env.CI;\n");
    expect(detectUndocumentedEnv(root)).toEqual([]);
  });

  test("documented var (including commented form) not reported", () => {
    const root = project();
    writeProjectFile(root, ".env.example", "# OPTIONAL_ONE=\nexport TWO=x\n");
    writeProjectFile(root, "src/a.ts", 'export const a = process.env.OPTIONAL_ONE;\nexport const b = process.env["TWO"];\n');
    expect(detectUndocumentedEnv(root)).toEqual([]);
  });

  test("reads names from a one-line destructuring of process.env", () => {
    const root = project();
    writeProjectFile(root, ".env.example", "# nothing\n");
    writeProjectFile(root, "src/a.ts", 'const { PORT, DB_URL: dbUrl, MODE = "dev", NODE_ENV, ...rest } = process.env;\nexport { PORT, dbUrl, MODE, NODE_ENV, rest };\n');
    const names = detectUndocumentedEnv(root).map((issue) => issue.message.split(" ")[0]);
    expect(names).toEqual(["DB_URL", "MODE", "PORT"]);
  });

  test("destructuring of something other than process.env is not an env read", () => {
    const root = project();
    writeProjectFile(root, ".env.example", "# nothing\n");
    writeProjectFile(root, "src/a.ts", "const { A, B } = config;\nexport { A, B };\n");
    expect(detectUndocumentedEnv(root)).toEqual([]);
  });
});
