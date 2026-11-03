import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/agent-v2-demo");

/** Fake Stripe-style key assembled at runtime so no secret-like literal is committed. */
export function fakeSecret(): string {
  return ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");
}

export function makeTmpProject(prefix = "agent-v2-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeProjectFile(root: string, relative: string, content: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

export function removeProject(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Generates the full demo project (floating promises, hardcoded secret, undocumented env) in a tmp dir. */
export function generateDemoFixture(): string {
  const root = makeTmpProject("agent-v2-demo-");
  mkdirSync(join(root, "src"), { recursive: true });
  copyFileSync(join(FIXTURE_DIR, "server.ts.fixture"), join(root, "src/server.ts"));
  copyFileSync(join(FIXTURE_DIR, "env.ts.fixture"), join(root, "src/env.ts"));
  copyFileSync(join(FIXTURE_DIR, "env.example.fixture"), join(root, ".env.example"));
  writeProjectFile(root, "src/config.ts", `export const stripeKey: string = "${fakeSecret()}";\n`);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "agent-v2-demo", version: "1.0.0" }));
  return root;
}
