import { afterEach, describe, expect, it, vi } from 'vitest';

const errorSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../src/shared/logger.js', () => ({ error: errorSpy }));

afterEach(() => {
  vi.doUnmock('chalk');
  vi.resetModules();
  errorSpy.mockReset();
});

describe('createMuraqibEnv', () => {
  it('trims values, strips surrounding quotes and skips undefined', async () => {
    const { createMuraqibEnv } = await import('../../../src/core/validate.js');
    const env = await createMuraqibEnv({ A: '  "  quoted "  ', B: ' plain ', C: undefined, D: '"half' });
    expect(env).toEqual({ A: 'quoted', B: 'plain', D: '"half' });
  });

  it('throws a coloured error for NEXT_PUBLIC_ keys when chalk loads', async () => {
    const { createMuraqibEnv } = await import('../../../src/core/validate.js');
    await expect(createMuraqibEnv({ NEXT_PUBLIC_KEY: 'v' })).rejects.toThrow('NEXT_PUBLIC_KEY');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to plain output when chalk cannot be imported', async () => {
    vi.doMock('chalk', () => {
      throw new Error('chalk unavailable');
    });
    const { createMuraqibEnv } = await import('../../../src/core/validate.js');
    await expect(createMuraqibEnv({ NEXT_PUBLIC_A: '1' })).rejects.toThrow('client-side prefixes');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_A'));
    // Cached null: second call must not retry the import.
    await expect(createMuraqibEnv({ NEXT_PUBLIC_B: '1' })).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
