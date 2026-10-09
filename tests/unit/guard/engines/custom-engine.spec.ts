import { describe, it, expect } from 'vitest';
import {
  CustomEngine,
  createCustomEngine,
  batchValidateCustom,
  commonValidators,
  type ValidationFn,
} from '../../../../src/guard/engines/custom-engine';

describe('CustomEngine', () => {
  describe('constructor', () => {
    it('should create empty engine', () => {
      const engine = new CustomEngine();
      expect(engine).toBeInstanceOf(CustomEngine);
      expect(engine.getValidatorCount()).toBe(0);
    });

    it('should create with single validator', () => {
      const validator: ValidationFn = () => null;
      const engine = new CustomEngine(validator);
      expect(engine.getValidatorCount()).toBe(1);
    });

    it('should create with multiple validators', () => {
      const validators: ValidationFn[] = [() => null, () => null];
      const engine = new CustomEngine(validators);
      expect(engine.getValidatorCount()).toBe(2);
    });
  });

  describe('addValidator', () => {
    it('should add validator', () => {
      const engine = new CustomEngine();
      const validator: ValidationFn = () => null;
      engine.addValidator(validator);
      expect(engine.getValidatorCount()).toBe(1);
    });

    it('should chain validators', () => {
      const engine = new CustomEngine()
        .addValidator(() => null)
        .addValidator(() => null);
      expect(engine.getValidatorCount()).toBe(2);
    });
  });

  describe('addTransform', () => {
    it('should add transform', () => {
      const engine = new CustomEngine();
      engine.addTransform(data => data);
      expect(engine.getTransformCount()).toBe(1);
    });

    it('should chain transforms', () => {
      const engine = new CustomEngine()
        .addTransform(data => data)
        .addTransform(data => ({ ...data, transformed: true }));
      expect(engine.getTransformCount()).toBe(2);
    });
  });

  describe('setOptional and setNullable', () => {
    it('should set optional', () => {
      const engine = new CustomEngine().setOptional(true);
      const result = engine.validate(undefined);
      expect(result.success).toBe(true);
    });

    it('should set nullable', () => {
      const engine = new CustomEngine().setNullable(true);
      const result = engine.validate(null);
      expect(result.success).toBe(true);
    });

    it('should reject null when not nullable', () => {
      const engine = new CustomEngine();
      const result = engine.validate(null);
      expect(result.success).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return success with no validators', () => {
      const engine = new CustomEngine();
      const result = engine.validate({ test: 'data' });
      expect(result.success).toBe(true);
    });

    it('should run validators', () => {
      const validator: ValidationFn = data => {
        if (typeof data !== 'object') {
          return [
            {
              field: 'root',
              message: 'Must be object',
              code: 'TYPE_ERROR',
              path: [],
            },
          ];
        }
        return null;
      };
      const engine = new CustomEngine(validator);
      const result = engine.validate('not an object');
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should apply transforms', () => {
      const engine = new CustomEngine().addTransform(data => ({
        ...data,
        transformed: true,
      }));
      const result = engine.validate({ original: true });
      expect(result.data).toEqual({ original: true, transformed: true });
    });

    it('should handle errors from validators', () => {
      const validator: ValidationFn = () => {
        throw new Error('Validator error');
      };
      const engine = new CustomEngine(validator);
      const result = engine.validate({ test: 'data' });
      expect(result.success).toBe(false);
      expect(result.errors[0].code).toBe('VALIDATION_ERROR');
    });
  });

  describe('validateStrict', () => {
    it('should return data for valid input', () => {
      const engine = new CustomEngine();
      const data = { test: 'data' };
      const result = engine.validateStrict(data);
      expect(result).toEqual(data);
    });

    it('should throw for invalid input', () => {
      const validator: ValidationFn = () => [
        {
          field: 'root',
          message: 'Invalid',
          code: 'ERROR',
          path: [],
        },
      ];
      const engine = new CustomEngine(validator);
      expect(() => engine.validateStrict({})).toThrow('Validation failed');
    });
  });

  describe('validatePartial', () => {
    it('should validate partial data', () => {
      const engine = new CustomEngine();
      const result = engine.validatePartial({ partial: true });
      expect(result.success).toBe(true);
    });
  });

  describe('getSchemaInfo', () => {
    it('should return schema info', () => {
      const engine = new CustomEngine().addValidator(() => null).addTransform(d => d);
      const info = engine.getSchemaInfo();
      expect(info.type).toBe('CustomSchema');
      expect(info.description).toContain('1 validator');
      expect(info.description).toContain('1 transform');
    });
  });

  describe('transform', () => {
    it('should create new engine with transform', () => {
      const engine = new CustomEngine();
      const transformed = engine.transform(data => ({ ...data, x: 1 }));
      expect(transformed).toBeInstanceOf(CustomEngine);
      expect(transformed.getTransformCount()).toBe(1);
    });

    it('should preserve original transforms', () => {
      const engine = new CustomEngine().addTransform(data => ({ ...data, a: 1 }));
      const transformed = engine.transform(data => ({ ...data, b: 2 }));
      expect(transformed.getTransformCount()).toBe(2);
    });
  });

  describe('optional', () => {
    it('should create optional engine', () => {
      const engine = new CustomEngine();
      const optional = engine.optional();
      expect(optional).toBeInstanceOf(CustomEngine);
      const result = optional.validate(undefined);
      expect(result.success).toBe(true);
    });
  });

  describe('nullable', () => {
    it('should create nullable engine', () => {
      const engine = new CustomEngine();
      const nullable = engine.nullable();
      expect(nullable).toBeInstanceOf(CustomEngine);
      const result = nullable.validate(null);
      expect(result.success).toBe(true);
    });
  });
});

describe('createCustomEngine', () => {
  it('should create engine without validators', () => {
    const engine = createCustomEngine();
    expect(engine).toBeInstanceOf(CustomEngine);
  });

  it('should create engine with single validator', () => {
    const validator: ValidationFn = () => null;
    const engine = createCustomEngine(validator);
    expect(engine.getValidatorCount()).toBe(1);
  });

  it('should create engine with multiple validators', () => {
    const validators: ValidationFn[] = [() => null, () => null];
    const engine = createCustomEngine(validators);
    expect(engine.getValidatorCount()).toBe(2);
  });
});

describe('batchValidateCustom', () => {
  it('should validate multiple items', () => {
    const engine = new CustomEngine();
    const items = [{ a: 1 }, { b: 2 }, { c: 3 }];
    const results = batchValidateCustom(engine, items);
    expect(results).toHaveLength(3);
    expect(results[0].item).toEqual({ a: 1 });
  });

  it('should track validity', () => {
    const engine = new CustomEngine();
    const items = [{ valid: true }, { valid: true }];
    const results = batchValidateCustom(engine, items);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
  });

  it('should track errors', () => {
    const validator: ValidationFn = data => {
      if (!data) return [{ field: 'root', message: 'Invalid', code: 'ERROR', path: [] }];
      return null;
    };
    const engine = new CustomEngine(validator);
    const results = batchValidateCustom(engine, [null, {}]);
    expect(results[0].errors.length).toBeGreaterThan(0);
  });
});

describe('commonValidators', () => {
  describe('isString', () => {
    it('should validate strings', () => {
      const errors = commonValidators.isString('test');
      expect(errors).toBeNull();
    });

    it('should reject non-strings', () => {
      const errors = commonValidators.isString(123);
      expect(errors).not.toBeNull();
      expect(errors?.[0].code).toBe('TYPE_ERROR');
    });
  });

  describe('isNumber', () => {
    it('should validate numbers', () => {
      const errors = commonValidators.isNumber(42);
      expect(errors).toBeNull();
    });

    it('should reject non-numbers', () => {
      const errors = commonValidators.isNumber('123');
      expect(errors).not.toBeNull();
    });

    it('should reject NaN', () => {
      const errors = commonValidators.isNumber(NaN);
      expect(errors).not.toBeNull();
    });
  });

  describe('stringLength', () => {
    it('should validate length', () => {
      const validator = commonValidators.stringLength(1, 10);
      const errors = validator('test');
      expect(errors).toBeNull();
    });

    it('should reject short strings', () => {
      const validator = commonValidators.stringLength(5, 10);
      const errors = validator('hi');
      expect(errors).not.toBeNull();
    });

    it('should reject long strings', () => {
      const validator = commonValidators.stringLength(1, 5);
      const errors = validator('toolong');
      expect(errors).not.toBeNull();
    });
  });

  describe('numberRange', () => {
    it('should validate range', () => {
      const validator = commonValidators.numberRange(1, 100);
      const errors = validator(50);
      expect(errors).toBeNull();
    });

    it('should reject below min', () => {
      const validator = commonValidators.numberRange(10, 100);
      const errors = validator(5);
      expect(errors).not.toBeNull();
    });

    it('should reject above max', () => {
      const validator = commonValidators.numberRange(1, 50);
      const errors = validator(75);
      expect(errors).not.toBeNull();
    });
  });

  describe('isEmail', () => {
    it('should validate emails', () => {
      const errors = commonValidators.isEmail('test@example.com');
      expect(errors).toBeNull();
    });

    it('should reject invalid emails', () => {
      const errors = commonValidators.isEmail('invalid-email');
      expect(errors).not.toBeNull();
    });
  });

  describe('isArray', () => {
    it('should validate arrays', () => {
      const errors = commonValidators.isArray([1, 2, 3]);
      expect(errors).toBeNull();
    });

    it('should reject non-arrays', () => {
      const errors = commonValidators.isArray('not array');
      expect(errors).not.toBeNull();
    });
  });

  describe('arrayLength', () => {
    it('should validate array length', () => {
      const validator = commonValidators.arrayLength(1, 5);
      const errors = validator([1, 2, 3]);
      expect(errors).toBeNull();
    });

    it('should reject short arrays', () => {
      const validator = commonValidators.arrayLength(3, 10);
      const errors = validator([1]);
      expect(errors).not.toBeNull();
    });

    it('should reject long arrays', () => {
      const validator = commonValidators.arrayLength(1, 2);
      const errors = validator([1, 2, 3]);
      expect(errors).not.toBeNull();
    });
  });

  describe('isObject', () => {
    it('should validate objects', () => {
      const errors = commonValidators.isObject({ key: 'value' });
      expect(errors).toBeNull();
    });

    it('should reject non-objects', () => {
      const errors = commonValidators.isObject('string');
      expect(errors).not.toBeNull();
    });

    it('should reject arrays', () => {
      const errors = commonValidators.isObject([1, 2, 3]);
      expect(errors).not.toBeNull();
    });

    it('should reject null', () => {
      const errors = commonValidators.isObject(null);
      expect(errors).not.toBeNull();
    });
  });

  describe('requiredProps', () => {
    it('should validate required properties', () => {
      const validator = commonValidators.requiredProps(['name', 'email']);
      const errors = validator({ name: 'test', email: 'test@example.com' });
      expect(errors).toBeNull();
    });

    it('should reject missing properties', () => {
      const validator = commonValidators.requiredProps(['name', 'email']);
      const errors = validator({ name: 'test' });
      expect(errors).not.toBeNull();
      expect(errors?.length).toBe(1);
    });

    it('should list all missing properties', () => {
      const validator = commonValidators.requiredProps(['name', 'email', 'age']);
      const errors = validator({ name: 'test' });
      expect(errors).not.toBeNull();
      expect(errors?.length).toBe(2);
    });
  });
});
