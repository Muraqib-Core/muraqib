import test from "node:test";
import assert from "node:assert";
import { discoverDockerFiles } from "../../src/scan/core/context/docker-discovery.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("discoverDockerFiles", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-discovery-test-"));

  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  await t.test("separates .dockerignore from dockerfiles", async () => {
    await fs.writeFile(path.join(tmpDir, "Dockerfile"), "FROM ubuntu");
    await fs.writeFile(path.join(tmpDir, ".dockerignore"), "node_modules");

    const result = discoverDockerFiles(tmpDir);
    assert.deepStrictEqual(result.dockerfiles, ["Dockerfile"]);
    assert.deepStrictEqual(result.dockerignoreFiles, [".dockerignore"]);
  });

  await t.test("handles symlink loops without hanging", async () => {
    const loopDir = path.join(tmpDir, "loop");
    await fs.mkdir(loopDir);
    
    // Create a symlink that points to its parent
    try {
      await fs.symlink(loopDir, path.join(loopDir, "recursive"));
    } catch {
      // Symlinks might fail on Windows without admin rights, ignore if so.
      return;
    }

    await fs.writeFile(path.join(loopDir, "Dockerfile.loop"), "FROM scratch");

    const result = discoverDockerFiles(tmpDir);
    assert.ok(result.dockerfiles.includes(path.join("loop", "Dockerfile.loop")));
  });
});
