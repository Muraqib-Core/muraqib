import { describe, expect, it } from "vitest";
import { dataOrThrow, unknownErrorIssue } from "../../../../src/guard/engines/validation-issue.js";

describe("unknownErrorIssue", () => {
  it("uses the Error message and the default code", () => {
    expect(unknownErrorIssue(new Error("boom"))).toEqual({
      field: "unknown",
      message: "boom",
      code: "UNKNOWN_ERROR",
      path: [],
    });
  });

  it("stringifies non-Error values and accepts a custom code", () => {
    expect(unknownErrorIssue("oops", "VALIDATION_ERROR")).toMatchObject({ message: "oops", code: "VALIDATION_ERROR" });
  });
});

describe("dataOrThrow", () => {
  it("returns data for a successful result", () => {
    expect(dataOrThrow({ success: true, data: { a: 1 }, errors: [] })).toEqual({ a: 1 });
  });

  it("throws one error listing every issue", () => {
    const issue = (field: string, message: string) => ({ field, message, code: "X", path: [field] });
    expect(() => dataOrThrow({ success: false, errors: [issue("a", "bad"), issue("b", "worse")] })).toThrow(
      "Validation failed: a: bad; b: worse",
    );
  });
});
