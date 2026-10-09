import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ZodEngine,
  createZodEngine,
  batchValidateZod,
  composeZodSchemas,
} from '../../../../src/guard/engines/zod-engine';

describe('ZodEngine', () => {
  describe('constructor', () => {
    it('should create engine with valid schema', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      expect(engine.getSchema()).toBe(schema);
    });

    it('should throw if schema is null', () => {
      expect(() => new ZodEngine(null as any)).toThrow('Schema is required');
    });

    it('should set strict mode', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema, true);
      expect(engine).toBeDefined();
    });
  });

  describe('validate', () => {
    it('should return success for valid data', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const result = engine.validate({ name: 'test' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid data', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const result = engine.validate({ name: 123 });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle unknown errors', () => {
      const schema = z.any();
      const engine = new ZodEngine(schema);
      const result = engine.validate({ test: 'data' });

      expect(result.success).toBe(true);
    });
  });

  describe('validateStrict', () => {
    it('should return data for valid input', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const result = engine.validateStrict({ name: 'test' });

      expect(result).toEqual({ name: 'test' });
    });

    it('should throw for invalid input', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);

      expect(() => engine.validateStrict({ name: 123 })).toThrow('Validation failed');
    });
  });

  describe('validatePartial', () => {
    it('should validate partial objects', () => {
      const schema = z.object({ name: z.string(), email: z.string() });
      const engine = new ZodEngine(schema);
      const result = engine.validatePartial({ name: 'test' });

      expect(result.success).toBe(true);
    });

    it('should handle fallback validation', () => {
      const schema = z.string();
      const engine = new ZodEngine(schema);
      const result = engine.validatePartial('test');

      expect(result.success).toBe(true);
    });
  });

  describe('getSchemaInfo', () => {
    it('should return schema info', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const info = engine.getSchemaInfo();

      expect(info.type).toBe('ZodObject');
    });

    it('should include description if available', () => {
      const schema = z.object({ name: z.string() }).describe('User schema');
      const engine = new ZodEngine(schema);
      const info = engine.getSchemaInfo();

      expect(info.description).toBe('User schema');
    });
  });

  describe('refine', () => {
    it('should create refined engine', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const refined = engine.refine(_data => true, 'Must be valid');

      expect(refined).toBeInstanceOf(ZodEngine);
    });
  });

  describe('transform', () => {
    it('should create transformed engine', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const transformed = engine.transform(data => ({ ...data, transformed: true }));

      expect(transformed).toBeInstanceOf(ZodEngine);
    });
  });

  describe('merge', () => {
    it('should merge two schemas', () => {
      const schema1 = z.object({ name: z.string() });
      const schema2 = z.object({ email: z.string() });
      const engine = new ZodEngine(schema1);
      const merged = engine.merge(schema2);

      expect(merged).toBeInstanceOf(ZodEngine);
    });

    it('should throw if merging non-objects', () => {
      const schema1 = z.string();
      const schema2 = z.object({ email: z.string() });
      const engine = new ZodEngine(schema1);

      expect(() => engine.merge(schema2)).toThrow('Can only merge ZodObject schemas');
    });
  });

  describe('optional and nullable', () => {
    it('should create optional engine', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const optional = engine.optional();

      expect(optional).toBeInstanceOf(ZodEngine);
    });

    it('should create nullable engine', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);
      const nullable = engine.nullable();

      expect(nullable).toBeInstanceOf(ZodEngine);
    });
  });

  describe('getSchema', () => {
    it('should return the schema', () => {
      const schema = z.object({ name: z.string() });
      const engine = new ZodEngine(schema);

      expect(engine.getSchema()).toBe(schema);
    });
  });

  describe('error parsing', () => {
    it('should parse Zod errors correctly', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const engine = new ZodEngine(schema);
      const result = engine.validate({ name: 123, age: 'not a number' });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('field');
      expect(result.errors[0]).toHaveProperty('message');
      expect(result.errors[0]).toHaveProperty('code');
    });
  });
});

describe('createZodEngine', () => {
  it('should create engine', () => {
    const schema = z.object({ name: z.string() });
    const engine = createZodEngine(schema);

    expect(engine).toBeInstanceOf(ZodEngine);
  });

  it('should create engine with strict mode', () => {
    const schema = z.object({ name: z.string() });
    const engine = createZodEngine(schema, true);

    expect(engine).toBeInstanceOf(ZodEngine);
  });
});

describe('batchValidateZod', () => {
  it('should validate multiple items', () => {
    const schema = z.object({ name: z.string() });
    const items = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }];
    const results = batchValidateZod(schema, items);

    expect(results).toHaveLength(3);
    expect(results[0].valid).toBe(true);
    expect(results[0].item).toEqual({ name: 'Alice' });
  });

  it('should track valid and invalid items', () => {
    const schema = z.object({ name: z.string() });
    const items = [{ name: 'Alice' }, { name: 123 }];
    const results = batchValidateZod(schema, items);

    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });

  it('should collect errors for invalid items', () => {
    const schema = z.object({ name: z.string() });
    const items = [{ name: 123 }];
    const results = batchValidateZod(schema, items);

    expect(results[0].errors.length).toBeGreaterThan(0);
  });
});

describe('composeZodSchemas', () => {
  it('should throw if no schemas provided', () => {
    expect(() => composeZodSchemas()).toThrow('At least one schema is required');
  });

  it('should return single schema', () => {
    const schema = z.object({ name: z.string() });
    const engine = composeZodSchemas(schema);

    expect(engine).toBeInstanceOf(ZodEngine);
  });

  it('should compose multiple object schemas', () => {
    const schema1 = z.object({ name: z.string() });
    const schema2 = z.object({ email: z.string() });
    const engine = composeZodSchemas(schema1, schema2);

    expect(engine).toBeInstanceOf(ZodEngine);
  });

  it('should handle non-object schemas gracefully', () => {
    const schema1 = z.string();
    const schema2 = z.object({ email: z.string() });
    const engine = composeZodSchemas(schema1, schema2);

    expect(engine).toBeInstanceOf(ZodEngine);
  });
});
