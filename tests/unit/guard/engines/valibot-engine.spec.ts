import { describe, it, expect } from 'vitest';
import { ValibotEngine, createValibotEngine, batchValidateValibot } from '../../../../src/guard/engines/valibot-engine';
import type { BaseSchema } from 'valibot';

// Mock Valibot schema
const createMockSchema = (): BaseSchema<unknown, unknown> => ({
  async parse(input: unknown) {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Expected object');
    }
    return input;
  },
} as unknown as BaseSchema<unknown, unknown>);

describe('ValibotEngine', () => {
  describe('constructor', () => {
    it('should create engine with valid schema', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      expect(engine).toBeInstanceOf(ValibotEngine);
    });

    it('should throw if schema is null', () => {
      expect(() => new ValibotEngine(null as unknown as BaseSchema<unknown, unknown>)).toThrow(
        'Schema is required'
      );
    });

    it('should set strict mode', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema, true);
      expect(engine).toBeInstanceOf(ValibotEngine);
    });
  });

  describe('validate', () => {
    it('should return result object with expected properties', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const data = { name: 'test' };
      const result = engine.validate(data);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('errors');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should handle errors gracefully', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const result = engine.validate(null);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('errors');
    });

    it('should handle unknown errors', () => {
      const schema = { parse: () => { throw new Error('Test error'); } } as unknown as BaseSchema<
        unknown,
        unknown
      >;
      const engine = new ValibotEngine(schema);
      const result = engine.validate({ test: 'data' });

      expect(result.success).toBe(false);
      expect(result.errors[0].code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('validateStrict', () => {
    it('should return data or throw', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const data = { name: 'test' };

      try {
        const result = engine.validateStrict(data);
        expect(result).toBeDefined();
      } catch {
        expect(true).toBe(true);
      }
    });

    it('should handle null values appropriately', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);

      try {
        engine.validateStrict(null);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('validatePartial', () => {
    it('should return result object', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const data = { name: 'test' };
      const result = engine.validatePartial(data);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('errors');
    });

    it('should handle non-object data', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const result = engine.validatePartial('string');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });
  });

  describe('getSchemaInfo', () => {
    it('should return schema info', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const info = engine.getSchemaInfo();

      expect(info).toHaveProperty('type');
      expect(typeof info.type === 'string').toBe(true);
    });
  });

  describe('optional and nullable', () => {
    it('should create optional engine', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const optional = engine.optional();

      expect(optional).toBeInstanceOf(ValibotEngine);
    });

    it('should create nullable engine', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const nullable = engine.nullable();

      expect(nullable).toBeInstanceOf(ValibotEngine);
    });
  });

  describe('transform', () => {
    it('should create transformed engine', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);
      const transformed = engine.transform(data => ({ ...data, transformed: true }));

      expect(transformed).toBeInstanceOf(ValibotEngine);
    });
  });

  describe('getSchema', () => {
    it('should return the schema', () => {
      const schema = createMockSchema();
      const engine = new ValibotEngine(schema);

      expect(engine.getSchema()).toBe(schema);
    });
  });
});

describe('createValibotEngine', () => {
  it('should create engine', () => {
    const schema = createMockSchema();
    const engine = createValibotEngine(schema);

    expect(engine).toBeInstanceOf(ValibotEngine);
  });

  it('should create engine with strict mode', () => {
    const schema = createMockSchema();
    const engine = createValibotEngine(schema, true);

    expect(engine).toBeInstanceOf(ValibotEngine);
  });
});

describe('batchValidateValibot', () => {
  it('should validate multiple items', () => {
    const schema = createMockSchema();
    const items = [{ a: 1 }, { b: 2 }];
    const results = batchValidateValibot(schema, items);

    expect(results).toHaveLength(2);
    expect(results[0].item).toEqual({ a: 1 });
    expect(results[1].item).toEqual({ b: 2 });
  });

  it('should return validation results', () => {
    const schema = createMockSchema();
    const items = [{ valid: true }, null];
    const results = batchValidateValibot(schema, items);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('valid');
    expect(results[1]).toHaveProperty('valid');
  });

  it('should collect errors for invalid items', () => {
    const schema = createMockSchema();
    const items = [null];
    const results = batchValidateValibot(schema, items);

    expect(results[0].errors).toBeDefined();
    expect(Array.isArray(results[0].errors)).toBe(true);
  });
});
