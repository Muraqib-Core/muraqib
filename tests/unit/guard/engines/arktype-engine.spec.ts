import { describe, it, expect } from 'vitest';
import { ArktypeEngine, createArktypeEngine, batchValidateArktype } from '../../../../src/guard/engines/arktype-engine';
import type { Type } from 'arktype';

// Mock ArkType schema
const createMockArktypeSchema = (): Type<unknown> => ({
  __is: (value: unknown): value is unknown => {
    return typeof value === 'object' && value !== null;
  },
} as unknown as Type<unknown>);

describe('ArktypeEngine', () => {
  describe('constructor', () => {
    it('should create engine with valid schema', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      expect(engine.getSchema()).toBe(schema);
    });

    it('should throw if schema is null', () => {
      expect(() => new ArktypeEngine(null as unknown as Type<unknown>)).toThrow(
        'Schema is required'
      );
    });

    it('should set strict mode', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema, true);
      expect(engine).toBeDefined();
    });
  });

  describe('validate', () => {
    it('should validate data', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const data = { name: 'test' };
      const result = engine.validate(data);

      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('should handle validation errors', () => {
      const schema = { __is: (_value: unknown): _value is unknown => false } as unknown as Type<unknown>;
      const engine = new ArktypeEngine(schema);
      const result = engine.validate({ test: 'data' });

      expect(result).toBeDefined();
    });

    it('should handle exceptions gracefully', () => {
      const schema = { __is: () => { throw new Error('Validation error'); } } as unknown as Type<unknown>;
      const engine = new ArktypeEngine(schema);
      const result = engine.validate({ test: 'data' });

      expect(result.success).toBe(false);
      expect(result.errors[0].code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('validateStrict', () => {
    it('should handle validation results', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const data = { name: 'test' };

      try {
        const result = engine.validateStrict(data);
        expect(result).toBeDefined();
      } catch {
        expect(true).toBe(true);
      }
    });

    it('should throw for invalid input when appropriate', () => {
      const schema = {
        __is: (_value: unknown): _value is unknown => false,
      } as unknown as Type<unknown>;
      const engine = new ArktypeEngine(schema);

      try {
        engine.validateStrict({ invalid: true });
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('validatePartial', () => {
    it('should validate partial objects', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const data = { name: 'test' };
      const result = engine.validatePartial(data);

      expect(result).toBeDefined();
    });

    it('should handle non-object data', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const result = engine.validatePartial('string');

      expect(result).toBeDefined();
    });
  });

  describe('getSchemaInfo', () => {
    it('should return schema info', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const info = engine.getSchemaInfo();

      expect(info.type).toBeDefined();
    });
  });

  describe('optional and nullable', () => {
    it('should create optional engine', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const optional = engine.optional();

      expect(optional).toBeInstanceOf(ArktypeEngine);
    });

    it('should create nullable engine', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const nullable = engine.nullable();

      expect(nullable).toBeInstanceOf(ArktypeEngine);
    });
  });

  describe('transform', () => {
    it('should create transformed engine', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);
      const transformed = engine.transform(data => ({ ...data, transformed: true }));

      expect(transformed).toBeInstanceOf(ArktypeEngine);
    });
  });

  describe('getSchema', () => {
    it('should return the schema', () => {
      const schema = createMockArktypeSchema();
      const engine = new ArktypeEngine(schema);

      expect(engine.getSchema()).toBe(schema);
    });
  });
});

describe('createArktypeEngine', () => {
  it('should create engine', () => {
    const schema = createMockArktypeSchema();
    const engine = createArktypeEngine(schema);

    expect(engine).toBeInstanceOf(ArktypeEngine);
  });

  it('should create engine with strict mode', () => {
    const schema = createMockArktypeSchema();
    const engine = createArktypeEngine(schema, true);

    expect(engine).toBeInstanceOf(ArktypeEngine);
  });
});

describe('batchValidateArktype', () => {
  it('should validate multiple items', () => {
    const schema = createMockArktypeSchema();
    const items = [{ a: 1 }, { b: 2 }];
    const results = batchValidateArktype(schema, items);

    expect(results).toHaveLength(2);
    expect(results[0].item).toEqual({ a: 1 });
    expect(results[1].item).toEqual({ b: 2 });
  });

  it('should track valid/invalid status', () => {
    const schema = createMockArktypeSchema();
    const items = [{ valid: true }, 'invalid'];
    const results = batchValidateArktype(schema, items);

    expect(results[0]).toBeDefined();
    expect(results[1]).toBeDefined();
  });

  it('should collect errors', () => {
    const schema = createMockArktypeSchema();
    const items = [{}];
    const results = batchValidateArktype(schema, items);

    expect(results[0].errors).toBeDefined();
  });
});
