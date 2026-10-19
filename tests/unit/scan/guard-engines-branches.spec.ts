import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CustomValidationEngine, runCustomValidation } from "../../../src/scan/guard/engines/custom-engine.js";
import { ZodValidationEngine, runZodValidation } from "../../../src/scan/guard/engines/zod-engine.js";
import { ValibotValidationEngine, runValibotValidation } from "../../../src/scan/guard/engines/valibot-engine.js";
import { ArkTypeValidationEngine, runArktypeValidation } from "../../../src/scan/guard/engines/arktype-engine.js";
import { detectValidationEngine } from "../../../src/scan/guard/core/engine-detector.js";
import { DefaultValidationEngineResolver } from "../../../src/scan/guard/core/validation-engine-resolver.js";

const engines = [
  new CustomValidationEngine(),
  new ZodValidationEngine(),
  new ValibotValidationEngine(),
  new ArkTypeValidationEngine(),
];

describe.each(engines.map((engine) => [engine.name, engine] as const))("scan engine %s", (_name, engine) => {
  it("auto-detects presets when none are passed", async () => {
    const result = await engine.validate({ PORT: "99999" });
    expect(result.errors.some((e) => e.path.includes("PORT"))).toBe(true);
  });

  it("treats an empty preset list like no presets", async () => {
    const result = await engine.validate({ PORT: "99999" }, []);
    expect(result.errors.some((e) => e.path.includes("PORT"))).toBe(true);
  });

  it("ignores unknown preset names", async () => {
    const result = await engine.validate({ FOO: "bar" }, ["does-not-exist"]);
    expect(result.errors).toEqual([]);
    expect(result.unknownKeys).toEqual(["FOO"]);
  });

  it("flags *_URL and *_URI keys that lack a protocol", async () => {
    const result = await engine.validate({ SOME_URL: "example.com", OTHER_URI: "nope" }, ["does-not-exist"]);
    expect(result.errors.map((e) => e.path[0]).sort()).toEqual(["OTHER_URI", "SOME_URL"]);
  });

  it("accepts *_URL keys with a valid scheme and excludes them from unknownKeys", async () => {
    const result = await engine.validate({ SOME_URL: "https://example.com", FOO: "bar" }, ["does-not-exist"]);
    expect(result.errors).toEqual([]);
    expect(result.unknownKeys).toEqual(["FOO"]);
  });
});

describe("run*Validation helpers", () => {
  it.each([
    ["custom", runCustomValidation],
    ["zod", runZodValidation],
    ["valibot", runValibotValidation],
    ["arktype", runArktypeValidation],
  ] as const)("%s helper delegates to its default engine", async (_name, run) => {
    const result = await run({ PORT: "99999" }, ["app"]);
    expect(result.errors.some((e) => e.path.includes("PORT"))).toBe(true);
  });
});

describe("engine detection and resolution", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function project(pkg?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-engine-"));
    dirs.push(dir);
    if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg, "utf8");
    return dir;
  }

  it("falls back to custom without a usable package.json", () => {
    expect(detectValidationEngine(project())).toBe("custom");
    expect(detectValidationEngine(project("{ not json"))).toBe("custom");
    expect(detectValidationEngine(project("{}"))).toBe("custom");
  });

  it("detects zod, valibot and arktype from dependencies or devDependencies", () => {
    expect(detectValidationEngine(project('{"dependencies":{"zod":"^4"}}'))).toBe("zod");
    expect(detectValidationEngine(project('{"devDependencies":{"valibot":"^1"}}'))).toBe("valibot");
    expect(detectValidationEngine(project('{"dependencies":{"arktype":"^2"}}'))).toBe("arktype");
  });

  it("prefers zod when several libraries are installed", () => {
    expect(detectValidationEngine(project('{"dependencies":{"arktype":"1","valibot":"1","zod":"1"}}'))).toBe("zod");
  });

  it("resolves the preferred engine, otherwise the detected one", () => {
    expect(new DefaultValidationEngineResolver("zod").resolve().name).toBe("zod");
    expect(new DefaultValidationEngineResolver("valibot").resolve().name).toBe("valibot");
    expect(new DefaultValidationEngineResolver("arktype").resolve().name).toBe("arktype");
    expect(new DefaultValidationEngineResolver("custom").resolve().name).toBe("custom");
    const root = project('{"dependencies":{"valibot":"1"}}');
    expect(new DefaultValidationEngineResolver(undefined, root).resolve().name).toBe("valibot");
  });
});

describe("resolveValidationEngine", () => {
  it("builds the resolver with the given preference", async () => {
    const { resolveValidationEngine } = await import("../../../src/scan/guard/core/validation-engine-resolver.js");
    expect(resolveValidationEngine("zod").name).toBe("zod");
  });
});
