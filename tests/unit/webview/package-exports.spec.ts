import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, unknown>;
  files: string[];
  scripts: Record<string, string>;
};

describe('package.json exports for the web view', () => {
  it('exposes the generated page at a stable subpath', () => {
    expect(pkg.exports['./webview/index.html']).toBe('./dist/webview/index.html');
  });

  it('keeps the library entry point', () => {
    expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
  });

  it('ships dist (which holds the page) and generates it during the build', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.scripts['build']).toContain('build-webview.mjs');
  });
});
