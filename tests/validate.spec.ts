import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMuraqibEnv } from '../src/core/validate.js'; 
import { Fixtures } from './fixtures.ts'; 

describe('Muraqib Env Validator', () => {
  
  beforeEach(() => {
    vi.resetModules(); 
  });

  it('should sanitize spacing and quotes using fixture data', async () => {
    const messyEnvFixture = Fixtures.get('messy-env.json');  
    const result = await createMuraqibEnv(messyEnvFixture);
    expect(result.DATABASE_URL).toBe('postgresql://localhost:5432'); 
  });

  it('should catch and THROW an error if server variable has client prefix', async () => {
    const brokenEnv = {
      NEXT_PUBLIC_DATABASE_URL: 'secret_value' 
    };

    await expect(createMuraqibEnv(brokenEnv)).rejects.toThrow(
      '[Muraqib Security Exception]'
    );
  });
});