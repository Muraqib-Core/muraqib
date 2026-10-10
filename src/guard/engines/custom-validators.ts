/**
 * Reusable validators for CustomEngine (re-exported from custom-engine.ts)
 */
import type { ValidationIssue } from './custom-engine.js';

/**
 * Common validators for reuse
 */
export const commonValidators = {
  /**
   * Validate that data is a string
   */
  isString: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'string') {
      return [
        {
          field: 'root',
          message: `Expected string, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate that data is a number
   */
  isNumber: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'number' || isNaN(data)) {
      return [
        {
          field: 'root',
          message: `Expected number, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate string length
   */
  stringLength: (min: number, max: number) => (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'string') return null;
    if (data.length < min || data.length > max) {
      return [
        {
          field: 'root',
          message: `String length must be between ${min} and ${max}, got ${data.length}`,
          code: 'LENGTH_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate number range
   */
  numberRange: (min: number, max: number) => (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'number') return null;
    if (data < min || data > max) {
      return [
        {
          field: 'root',
          message: `Number must be between ${min} and ${max}, got ${data}`,
          code: 'RANGE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate email format
   */
  isEmail: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'string') return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data)) {
      return [
        {
          field: 'root',
          message: `Invalid email format: ${data}`,
          code: 'EMAIL_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate array
   */
  isArray: (data: unknown): ValidationIssue[] | null => {
    if (!Array.isArray(data)) {
      return [
        {
          field: 'root',
          message: `Expected array, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate array length
   */
  arrayLength: (min: number, max: number) => (data: unknown): ValidationIssue[] | null => {
    if (!Array.isArray(data)) return null;
    if (data.length < min || data.length > max) {
      return [
        {
          field: 'root',
          message: `Array length must be between ${min} and ${max}, got ${data.length}`,
          code: 'LENGTH_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate object
   */
  isObject: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return [
        {
          field: 'root',
          message: `Expected object, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate required properties
   */
  requiredProps: (props: string[]) => (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'object' || data === null) return null;
    const obj = data as Record<string, unknown>;
    const errors: ValidationIssue[] = [];

    for (const prop of props) {
      if (!(prop in obj)) {
        errors.push({
          field: prop,
          message: `Required property '${prop}' is missing`,
          code: 'REQUIRED_ERROR',
          path: [prop],
        });
      }
    }

    return errors.length > 0 ? errors : null;
  },
};
