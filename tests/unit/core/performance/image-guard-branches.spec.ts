import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ImageGuard, runImagePerformanceAudit } from "../../../../src/core/performance/image-guard.js";

describe("ImageGuard branches", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-img-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const big = (p: string): void => fs.writeFileSync(p, Buffer.alloc(600 * 1024));

  it("flags large images in nested dirs and ignores small, non-image and skipped dirs", async () => {
    fs.mkdirSync(path.join(dir, "sub"));
    fs.mkdirSync(path.join(dir, "node_modules"));
    big(path.join(dir, "sub", "a.PNG"));
    big(path.join(dir, "node_modules", "skip.png"));
    big(path.join(dir, "data.bin"));
    fs.writeFileSync(path.join(dir, "small.jpg"), Buffer.alloc(10));
    const result = await new ImageGuard(dir).run();
    expect(result.status).toBe("warning");
    expect(result.issues).toHaveLength(1);
    expect(result.message).toContain("1 image(s)");
  });

  it("returns ok when there are no oversized images", async () => {
    fs.writeFileSync(path.join(dir, "small.png"), Buffer.alloc(10));
    const result = await new ImageGuard(dir).run();
    expect(result.status).toBe("ok");
    expect(result.message).toContain("optimized");
  });

  it("defaults to process.cwd() when no path is given", () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    big(path.join(dir, "x.jpeg"));
    expect(runImagePerformanceAudit().violations).toHaveLength(1);
  });

  it("returns empty for unreadable directory", () => {
    expect(runImagePerformanceAudit(path.join(dir, "missing")).violations).toEqual([]);
  });

  it("skips symlinks", () => {
    big(path.join(dir, "real.png"));
    fs.mkdirSync(path.join(dir, "d"));
    fs.symlinkSync(path.join(dir, "real.png"), path.join(dir, "d", "link.png"));
    const result = runImagePerformanceAudit(path.join(dir, "d"));
    expect(result.violations).toEqual([]);
  });

  it("skips entries whose lstat throws", () => {
    big(path.join(dir, "a.png"));
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(runImagePerformanceAudit(dir).violations).toEqual([]);
  });

  it("ignores entries that are neither files nor directories", () => {
    fs.writeFileSync(path.join(dir, "a.png"), "x");
    vi.spyOn(fs, "lstatSync").mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => false,
      size: 0,
    } as unknown as fs.Stats);
    expect(runImagePerformanceAudit(dir).violations).toEqual([]);
  });
});
