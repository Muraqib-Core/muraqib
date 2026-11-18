import { vi, describe, it, expect, beforeEach } from "vitest";
import { getNewEnvValue } from "../../../src/core/muraqib-env.js";

describe("Muraqib Env Transformation Engine (SemVer Inspired)", () => {
  
  beforeEach(() => {
    vi.resetModules();
  });

  it("should successfully REPLACE old secret with the new version", () => {
    const result = getNewEnvValue({
      currentValue: "postgresql://localhost:5432/old_db",
      newValue: "postgresql://localhost:5432/new_db",
      updateStrategy: "replace",
      secretKey: "DATABASE_URL",
    });

    expect(result).toBe("postgresql://localhost:5432/new_db");
  });

  it("should successfully WIDEN and KEEP BOTH values using keep-both strategy", () => {
    const result = getNewEnvValue({
      currentValue: "old-api-key-v1",
      newValue: "new-api-key-v2",
      updateStrategy: "keep-both",
      secretKey: "API_KEY",
    });

    expect(result).toBe('"old-api-key-v1" || "new-api-key-v2"');
  });

  it("should successfully MERGE unique comma-separated values without duplication", () => {
    const result = getNewEnvValue({
      currentValue: "org:read,repo:status",
      newValue: "repo:status,user:email",
      updateStrategy: "merge",
      secretKey: "OAUTH_SCOPES",
    });

    expect(result).toBe("org:read,repo:status,user:email");
  });

  it("strips matching double and single quotes from both values", () => {
    expect(getNewEnvValue({ currentValue: '"a"', newValue: "'b'", updateStrategy: "replace" })).toBe("b");
    expect(getNewEnvValue({ currentValue: "'a'", newValue: "'b'", updateStrategy: "keep-both" })).toBe('"a" || "b"');
  });

  it("does not strip a lone or mismatched quote", () => {
    expect(getNewEnvValue({ currentValue: "x", newValue: `"abc`, updateStrategy: "replace" })).toBe('"abc');
    expect(getNewEnvValue({ currentValue: "x", newValue: `it's`, updateStrategy: "replace" })).toBe("it's");
    expect(getNewEnvValue({ currentValue: "x", newValue: `"abc'`, updateStrategy: "replace" })).toBe(`"abc'`);
  });

  it("returns the current value for empty or identical new values", () => {
    expect(getNewEnvValue({ currentValue: "keep", newValue: "  ", updateStrategy: "replace" })).toBe("keep");
    expect(getNewEnvValue({ currentValue: '"same"', newValue: "same", updateStrategy: "replace" })).toBe('"same"');
  });

  it("merges non-list values with a semicolon", () => {
    expect(getNewEnvValue({ currentValue: "a", newValue: "b", updateStrategy: "merge" })).toBe("a;b");
  });
});
