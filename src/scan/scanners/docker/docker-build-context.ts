/**
 * Compose build analysis: resolving build contexts, Dockerfiles and `.dockerignore` rules,
 * and matching COPY/ADD sources against sensitive files.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isWithinRoot } from "../../../shared/paths.js";

export const SENSITIVE = [".env", ".env.local", ".env.production", ".env.development"];

export function copySources(text: string): string[] | null {
  const body = text.replace(/^(COPY|ADD)\s+/i, "").replace(/^(--[\w-]+(?:=\S+)?\s+)*/i, "").trim();
  if (/^\[/.test(body)) {
    try {
      const values: unknown = JSON.parse(body);
      return Array.isArray(values) && values.length > 1 && values.every(v => typeof v === "string")
        ? values.slice(0, -1) : null;
    } catch { return null; }
  }
  const values = body.split(/\s+/);
  return values.length > 1 ? values.slice(0, -1) : null;
}

export function sourceMatches(source: string, candidate: string): boolean {
  if (source === "." || source === "./" || source === "*" || source === "./*") return true;
  const normalized = source.replace(/^\.\//, "");
  if (normalized === candidate) return true;
  if (normalized.includes("*") && !normalized.includes("/")) {
    const pattern = new RegExp(`^${normalized.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return pattern.test(candidate);
  }
  return false;
}

/** Outcome of one build-analysis step: a value, or the diagnostic explaining why the service was skipped. */
export type Step<T> = { value: T } | { skip: string };

/** Records a diagnostic and reports "incomplete". */
export function skipped(diagnostics: string[], message: string): true {
  diagnostics.push(message);
  return true;
}

/** Resolves the service's local build context directory, which must exist inside the project. */
export async function resolveBuildContext(build: unknown, file: string, root: string, service: string): Promise<Step<string>> {
  const rawContext = typeof build === "string" ? build : (build as { context?: unknown }).context;
  if (typeof rawContext !== "string" || !rawContext || /^(https?:|git@|docker-image:)/i.test(rawContext)) {
    return { skip: `Local build context for service ${service} is unsupported or unresolved.` };
  }
  const contextPath = path.resolve(path.dirname(path.resolve(root, file)), rawContext);
  let contextReal: string;
  try { contextReal = await fs.realpath(contextPath); }
  catch { return { skip: `Local build context inaccessible for service ${service}.` }; }
  if (!isWithinRoot(root, contextReal)) return { skip: `Build context outside project skipped for service ${service}.` };
  return { value: contextReal };
}

/** Reads the build's Dockerfile (default `Dockerfile` in the context), which must be inside the project. */
export async function readBuildDockerfile(
  build: unknown,
  contextReal: string,
  root: string,
  service: string
): Promise<Step<{ real: string; content: string }>> {
  const declared = typeof build === "object" && build ? (build as { dockerfile?: unknown }).dockerfile : undefined;
  const dockerfileName = typeof declared === "string" ? declared : "Dockerfile";
  let real: string;
  try { real = await fs.realpath(path.resolve(contextReal, dockerfileName)); }
  catch { return { skip: `Build Dockerfile inaccessible for service ${service}.` }; }
  if (!isWithinRoot(root, real)) return { skip: `Build Dockerfile outside project skipped for service ${service}.` };
  try { return { value: { real, content: await fs.readFile(real, "utf8") } }; }
  catch { return { skip: `Build Dockerfile unreadable for service ${service}.` }; }
}

/** Reads the `.dockerignore` that applies to the build (`<Dockerfile>.dockerignore` wins); a missing file means no rules. */
export async function readIgnoreRules(dockerfileReal: string, contextReal: string, root: string, service: string): Promise<Step<string>> {
  const specialIgnore = `${dockerfileReal}.dockerignore`;
  const defaultIgnore = path.join(contextReal, ".dockerignore");
  const selectedIgnore = await fs.stat(specialIgnore).then(() => specialIgnore).catch(() => defaultIgnore);
  try {
    const ignoreReal = await fs.realpath(selectedIgnore);
    if (!isWithinRoot(root, ignoreReal)) return { skip: `Ignore file outside project skipped for service ${service}.` };
    const rules = await fs.readFile(ignoreReal, "utf8");
    if (rules.length > 1024 * 1024) return { skip: `Ignore file too large for service ${service}.` };
    return { value: rules };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { skip: `Ignore file unreadable for service ${service}.` };
    return { value: "" };
  }
}
