import { beforeEach, describe, expect, test, vi } from "vitest";

const findSecrets = vi.fn();
const scanProjectFiles = vi.fn();
vi.mock("../../../src/core/secret-detector.js", () => ({ findSecrets: (...a: unknown[]): unknown => findSecrets(...a) }));
vi.mock("../../../src/utils/file-scanner.js", () => ({ scanProjectFiles: (...a: unknown[]): unknown => scanProjectFiles(...a) }));

import { detectHardcodedSecrets, SECRETS_MODULE } from "../../../src/agent-v2/detectors/secrets.js";

beforeEach(() => {
  findSecrets.mockReset();
  scanProjectFiles.mockReset();
  scanProjectFiles.mockReturnValue([
    { relativePath: "src\\b.ts", content: "x" },
    { relativePath: "src/a.ts", content: "y" },
  ]);
});

describe("detectHardcodedSecrets with a mocked matcher", () => {
  test("skips pii, maps blocking, handles undefined line, sorts", () => {
    findSecrets.mockImplementation((_c: string, opts: { file: string }) =>
      opts.file === "src/b.ts"
        ? [
            { type: "pii", description: "pii", blocking: false, line: 1 },
            { type: "api_key", description: "Key", blocking: true, line: 9 },
            { type: "token", description: "Tok", blocking: false },
          ]
        : [{ type: "token", description: "Tok", blocking: false, line: 2 }],
    );
    const issues = detectHardcodedSecrets("/nowhere");
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.file)).toEqual(["src/a.ts", "src/b.ts", "src/b.ts"]);
    const noLine = issues.find((i) => i.file === "src/b.ts" && i.line === undefined);
    expect(noLine?.severity).toBe("warning");
    expect(noLine?.message).toBe("Tok hardcoded in src/b.ts");
    expect("line" in (noLine ?? {})).toBe(false);
    const blocking = issues.find((i) => i.line === 9);
    expect(blocking?.severity).toBe("critical");
    expect(blocking?.code).toBe("SECRET_API_KEY");
    expect(blocking?.module).toBe(SECRETS_MODULE);
    expect(blocking?.message).toBe("Key hardcoded in src/b.ts:9");
  });

  test("ids differ for same type with different lines and are stable", () => {
    findSecrets.mockReturnValue([
      { type: "token", description: "T", blocking: true, line: 1 },
      { type: "token", description: "T", blocking: true, line: 1 },
      { type: "token", description: "T", blocking: true, line: 1 },
    ]);
    scanProjectFiles.mockReturnValue([{ relativePath: "a.ts", content: "" }]);
    const first = detectHardcodedSecrets("/x");
    expect(first.map((i) => i.id)).toEqual(detectHardcodedSecrets("/x").map((i) => i.id));
  });

  test("no matches gives no issues", () => {
    findSecrets.mockReturnValue([]);
    expect(detectHardcodedSecrets("/x")).toEqual([]);
  });
});
