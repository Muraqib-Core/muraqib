import { describe, it, expect } from 'vitest';
import { type } from 'arktype';
import type { Type } from 'arktype';
import { ArktypeEngine, createArktypeEngine, batchValidateArktype } from '../../../../src/guard/engines/arktype-engine';

const userSchema = type({ name: 'string', age: 'number' }) as unknown as Type<unknown>;

describe('ArktypeEngine with a real ArkType schema', () => {
  it('returns data on success', () => {
    const result = new ArktypeEngine(userSchema).validate({ name: 'Aya', age: 22 });
    expect(result).toEqual({ success: true, data: { name: 'Aya', age: 22 }, errors: [] });
  });

  it('reports one issue per failing field', () => {
    const result = new ArktypeEngine(userSchema).validate({ name: 1 });
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.field).sort()).toEqual(['age', 'name']);
    expect(result.errors.every((e) => e.code === 'ARKTYPE_ERROR')).toBe(true);
    expect(result.errors.find((e) => e.field === 'age')?.message).toContain('age must be a number');
  });

  it('reports a failure for a primitive schema given the wrong type', () => {
    const result = new ArktypeEngine(type('string') as unknown as Type<unknown>).validate(5);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles schemas that return a bare error string', () => {
    const schema = ((): string => 'value must be a string (was number)') as unknown as Type<unknown>;
    const result = new ArktypeEngine(schema).validate(1);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toBe('value must be a string (was number)');
    expect(result.errors[0]?.path).toEqual(['value']);
  });

  it('falls back to error_<index> when a line has no identifier', () => {
    const schema = ((): string => '!!!') as unknown as Type<unknown>;
    expect(new ArktypeEngine(schema).validate(1).errors[0]?.field).toBe('error_0');
  });

  it('turns exceptions into UNKNOWN_ERROR with raw text', () => {
    const throwing = (() => { throw new Error('boom'); }) as unknown as Type<unknown>;
    const result = new ArktypeEngine(throwing).validate(1);
    expect(result.errors[0]).toMatchObject({ field: 'unknown', code: 'UNKNOWN_ERROR', message: 'boom' });
    expect(result.raw).toBe('boom');
  });

  it('stringifies non-Error throwables', () => {
    const throwing = (() => { throw 'plain'; }) as unknown as Type<unknown>;
    const result = new ArktypeEngine(throwing).validate(1);
    expect(result.errors[0]?.message).toBe('plain');
    expect(result.raw).toBe('plain');
  });

  describe('validateStrict', () => {
    it('returns data when valid', () => {
      expect(new ArktypeEngine(userSchema).validateStrict({ name: 'a', age: 1 })).toEqual({ name: 'a', age: 1 });
    });
    it('throws a joined message when invalid', () => {
      expect(() => new ArktypeEngine(userSchema).validateStrict({})).toThrow(/Validation failed: /);
    });
  });

  describe('validatePartial', () => {
    it('validates objects and non-objects', () => {
      const engine = new ArktypeEngine(userSchema);
      expect(engine.validatePartial({ name: 'a', age: 1 }).success).toBe(true);
      expect(engine.validatePartial({ name: 'a' }).success).toBe(false);
      expect(engine.validatePartial([1]).success).toBe(false);
      expect(engine.validatePartial(null).success).toBe(false);
    });
    it('catches unexpected exceptions', () => {
      const engine = new ArktypeEngine(userSchema);
      engine.validate = () => { throw new Error('late'); };
      const result = engine.validatePartial({});
      expect(result.errors[0]).toMatchObject({ code: 'UNKNOWN_ERROR', message: 'late' });
      expect(result.raw).toBe('late');
    });
    it('catches non-Error exceptions', () => {
      const engine = new ArktypeEngine(userSchema);
      engine.validate = () => { throw 7; };
      expect(engine.validatePartial({}).errors[0]?.message).toBe('7');
    });
  });

  it('exposes schema info and derived engines', () => {
    const engine = new ArktypeEngine(userSchema, true);
    expect(engine.getSchemaInfo().type).toBeTruthy();
    expect(engine.getSchema()).toBe(userSchema);
    const fn = (d: unknown): unknown => d;
    expect(engine.transform(fn)).toBeInstanceOf(ArktypeEngine);
    expect(engine.optional()).toBeInstanceOf(ArktypeEngine);
    expect(engine.nullable()).toBeInstanceOf(ArktypeEngine);
  });

  it('createArktypeEngine and batchValidateArktype', () => {
    expect(createArktypeEngine(userSchema)).toBeInstanceOf(ArktypeEngine);
    const batch = batchValidateArktype(userSchema, [{ name: 'a', age: 1 }, {}]);
    expect(batch.map((b) => b.valid)).toEqual([true, false]);
  });
});
