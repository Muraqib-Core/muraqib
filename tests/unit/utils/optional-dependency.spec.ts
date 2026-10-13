import { describe, expect, test } from "vitest";
import {
  MissingOptionalDependencyError,
  loadOptionalDependency,
  requireOptionalDependency,
} from "../../../src/utils/optional-dependency.js";

describe("loadOptionalDependency", () => {
  test("returns the module when installed", async () => {
    const mod = await loadOptionalDependency<typeof import("valibot")>("valibot", "engine 'valibot'");
    expect(typeof mod.safeParse).toBe("function");
  });

  test("throws an actionable error when the package is missing", async () => {
    const attempt = loadOptionalDependency("muraqib-definitely-not-installed", "engine 'nope'");
    await expect(attempt).rejects.toBeInstanceOf(MissingOptionalDependencyError);
    await expect(
      loadOptionalDependency("muraqib-definitely-not-installed", "engine 'nope'")
    ).rejects.toThrow("install muraqib-definitely-not-installed to use engine 'nope'");
  });

  test("exposes the package and feature on the error", async () => {
    const error = await loadOptionalDependency("muraqib-definitely-not-installed", "x").catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: "MissingOptionalDependencyError",
      packageName: "muraqib-definitely-not-installed",
      feature: "x",
    });
  });

  test("rethrows unrelated import failures unchanged", async () => {
    // A missing *transitive* module must not be reported as the optional package being absent.
    await expect(loadOptionalDependency("data:text/javascript,import 'muraqib-transitive-missing'", "x")).rejects.not.toBeInstanceOf(
      MissingOptionalDependencyError
    );
  });
});

describe("requireOptionalDependency", () => {
  test("returns the module when installed", () => {
    const mod = requireOptionalDependency<typeof import("valibot")>("valibot", "engine 'valibot'");
    expect(typeof mod.safeParse).toBe("function");
  });

  test("throws an actionable error when the package is missing", () => {
    expect(() => requireOptionalDependency("muraqib-definitely-not-installed", "engine 'nope'")).toThrow(
      "install muraqib-definitely-not-installed to use engine 'nope'"
    );
  });

  test("rethrows non module-not-found errors unchanged", () => {
    expect(() => requireOptionalDependency("node:no-such-builtin", "x")).toThrow(/no-such-builtin/);
    expect(() => requireOptionalDependency("node:no-such-builtin", "x")).not.toThrow(MissingOptionalDependencyError);
  });
});
