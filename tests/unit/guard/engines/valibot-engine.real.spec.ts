import { describe, it, expect } from "vitest";
import * as v from "valibot";
import type { BaseSchema, BaseIssue } from "valibot";
import { ValibotEngine, createValibotEngine, batchValidateValibot } from "../../../../src/guard/engines/valibot-engine";

type Schema = BaseSchema<unknown, unknown, BaseIssue<unknown>>;

const userSchema = v.object({
  name: v.string(),
  age: v.number(),
  address: v.object({ city: v.string() }),
  tags: v.array(v.string()),
}) as unknown as Schema;

const valid = { name: "Aya", age: 22, address: { city: "Amman" }, tags: ["a"] };

describe("ValibotEngine with a real Valibot schema", () => {
  it("returns parsed data on success", () => {
    const result = new ValibotEngine(userSchema).validate(valid);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(valid);
    expect(result.errors).toEqual([]);
  });

  it("reports the real field path for each failure", () => {
    const result = new ValibotEngine(userSchema).validate({
      name: 1,
      age: "x",
      address: { city: 2 },
      tags: ["ok", 3],
    });
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.field)).toEqual(["name", "age", "address.city", "tags.1"]);
    expect(result.errors.find((e) => e.field === "tags.1")?.path).toEqual(["tags", 1]);
    expect(result.errors[0]?.code).toBe("string");
    expect(result.raw).toBeDefined();
  });

  it("keeps a numeric index of 0 in the path", () => {
    const result = new ValibotEngine(v.array(v.string()) as unknown as Schema).validate([5]);
    expect(result.errors[0]?.path).toEqual([0]);
  });

  it('uses "root" for a failure with no path', () => {
    const result = new ValibotEngine(v.string() as unknown as Schema).validate(5);
    expect(result.errors[0]?.field).toBe("root");
    expect(result.errors[0]?.path).toEqual([]);
  });

  it("turns an exception thrown by the schema into UNKNOWN_ERROR", () => {
    const throwing = { async: false, "~run": () => { throw new Error("boom"); } } as unknown as Schema;
    const result = new ValibotEngine(throwing).validate(1);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatchObject({ field: "unknown", code: "UNKNOWN_ERROR", message: "boom" });
  });

  it("stringifies non-Error throwables", () => {
    const throwing = { async: false, "~run": () => { throw "plain"; } } as unknown as Schema;
    expect(new ValibotEngine(throwing).validate(1).errors[0]?.message).toBe("plain");
  });

  describe("validateStrict", () => {
    it("returns data when valid", () => {
      expect(new ValibotEngine(userSchema).validateStrict(valid)).toEqual(valid);
    });
    it("throws with every field message when invalid", () => {
      expect(() => new ValibotEngine(userSchema).validateStrict({ ...valid, name: 1 })).toThrow(/Validation failed: name: /);
    });
  });

  describe("validatePartial", () => {
    it("returns success for valid objects", () => {
      expect(new ValibotEngine(userSchema).validatePartial(valid).success).toBe(true);
    });
    it("returns errors and raw for invalid objects", () => {
      const result = new ValibotEngine(userSchema).validatePartial({ name: 1 });
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.raw).toBeDefined();
    });
    it("delegates arrays and primitives to validate", () => {
      const engine = new ValibotEngine(v.array(v.number()) as unknown as Schema);
      expect(engine.validatePartial([1, 2]).success).toBe(true);
      expect(engine.validatePartial("nope").success).toBe(false);
      expect(engine.validatePartial(null).success).toBe(false);
    });
    it("catches unexpected exceptions", () => {
      const engine = new ValibotEngine(userSchema);
      engine.validate = () => { throw new Error("late"); };
      const result = engine.validatePartial({});
      expect(result.errors[0]).toMatchObject({ code: "UNKNOWN_ERROR", message: "late" });
    });
    it("catches non-Error exceptions", () => {
      const engine = new ValibotEngine(userSchema);
      engine.validate = () => { throw 42; };
      expect(engine.validatePartial({}).errors[0]?.message).toBe("42");
    });
  });

  describe("metadata and derived engines", () => {
    it("exposes schema info and the raw schema", () => {
      const engine = new ValibotEngine(userSchema);
      expect(engine.getSchemaInfo().type).toBe("Object");
      expect(engine.getSchema()).toBe(userSchema);
    });
    it("transform/optional/nullable return new engines wrapping extended schemas", () => {
      const engine = new ValibotEngine(userSchema, true);
      const fn = (d: unknown): unknown => d;
      const t = engine.transform(fn);
      expect(t).toBeInstanceOf(ValibotEngine);
      expect(t).not.toBe(engine);
      expect((t.getSchema() as unknown as { _transform: unknown })._transform).toBe(fn);
      expect((engine.optional().getSchema() as unknown as { _optional: boolean })._optional).toBe(true);
      expect((engine.nullable().getSchema() as unknown as { _nullable: boolean })._nullable).toBe(true);
    });
  });

  it("createValibotEngine and batchValidateValibot", () => {
    expect(createValibotEngine(userSchema)).toBeInstanceOf(ValibotEngine);
    const batch = batchValidateValibot(userSchema, [valid, { name: 1 }]);
    expect(batch.map((b) => b.valid)).toEqual([true, false]);
    expect(batch[1]?.errors.length).toBeGreaterThan(0);
  });
});
