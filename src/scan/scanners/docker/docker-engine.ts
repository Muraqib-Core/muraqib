import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import ignore from "ignore";
import type { ScannerEngine, ScanContext, ScanResult } from "../../core/contracts/scanner-engine.js";
import { createScanIssue, type ScanIssueInput } from "../../core/findings/finding.js";

const execFileAsync = promisify(execFile);
const TIMEOUT = 10_000;
const MAX_OUTPUT = 2 * 1024 * 1024;
const SENSITIVE = [".env", ".env.local", ".env.production", ".env.development"];

type ComposeDocument = { services?: Record<string, Record<string, unknown>> };

type DockerCommand = (args: string[], cwd: string) => Promise<string>;

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeName(name: string): string {
  return name.replace(/[^\w./-]/g, "_").slice(0, 180);
}

async function defaultDocker(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("docker", args, { cwd, timeout: TIMEOUT, maxBuffer: MAX_OUTPUT });
  return result.stdout;
}

function instructions(content: string): Array<{ text: string; line: number }> {
  const result: Array<{ text: string; line: number }> = [];
  let current = "";
  let start = 1;
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const trimmed = raw.trim();
    if (!current) start = index + 1;
    if (!trimmed || trimmed.startsWith("#")) continue;
    const continuation = trimmed.endsWith("\\");
    current += (current ? " " : "") + (continuation ? trimmed.slice(0, -1).trim() : trimmed);
    if (!continuation) {
      result.push({ text: current, line: start });
      current = "";
    }
  }
  if (current) result.push({ text: current, line: start });
  return result;
}

/**
 * Oldest release of an official image that still receives upstream security fixes, as [major, minor].
 * Review this table when upstream support windows change.
 */
const MIN_SUPPORTED: Record<string, readonly [number, number]> = {
  node: [22, 0],
  python: [3, 10],
  ubuntu: [22, 4],
  debian: [12, 0],
};

/** Returns "name:version" when the image is an official, end-of-life release; otherwise null. */
function endOfLifeRelease(image: string): string | null {
  const match = /^(?:docker\.io\/)?(?:library\/)?(node|python|ubuntu|debian):(\d+)(?:\.(\d+))?(?:[.\-@]|$)/i.exec(image);
  const name = match?.[1]?.toLowerCase();
  const minimum = name ? MIN_SUPPORTED[name] : undefined;
  if (!name || !minimum || !match?.[2]) return null;
  const major = Number(match[2]);
  const minor = Number(match[3] ?? 0);
  const eol = major < minimum[0] || (major === minimum[0] && minor < minimum[1]);
  return eol ? `${name}:${match[2]}${match[3] !== undefined ? `.${match[3]}` : ""}` : null;
}

function runsAsRoot(user: string | undefined): boolean {
  if (user === undefined) return true;
  const name = (user.split(":")[0] ?? "").toLowerCase();
  return name === "root" || name === "0";
}

function copySources(text: string): string[] | null {
  const body = text.replace(/^(COPY|ADD)\s+/i, "").replace(/^(--[\w-]+(?:=\S+)?\s+)*/i, "").trim();
  if (/^\[/.test(body)) {
    try {
      const values: unknown = JSON.parse(body);
      return Array.isArray(values) && values.length > 1 && values.every(v => typeof v === "string")
        ? values.slice(0, -1) as string[] : null;
    } catch { return null; }
  }
  const values = body.split(/\s+/);
  return values.length > 1 ? values.slice(0, -1) : null;
}

function sourceMatches(source: string, candidate: string): boolean {
  if (source === "." || source === "./" || source === "*" || source === "./*") return true;
  const normalized = source.replace(/^\.\//, "");
  if (normalized === candidate) return true;
  if (normalized.includes("*") && !normalized.includes("/")) {
    const pattern = new RegExp(`^${normalized.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return pattern.test(candidate);
  }
  return false;
}

export class DockerScanner implements ScannerEngine {
  readonly name = "docker";
  constructor(private readonly docker: DockerCommand = defaultDocker, private readonly nativeValidation = false) {}

  supports(context: ScanContext): boolean {
    return Boolean(context.dockerfiles?.length || context.composeFiles?.length);
  }

  async scan(context: ScanContext): Promise<ScanResult> {
    const findings: ScanIssueInput[] = [];
    const diagnostics: string[] = [];
    const scannedInputs: string[] = [];
    const skippedInputs: string[] = [];
    let partial = false;
    const root = await fs.realpath(context.projectPath).catch(() => path.resolve(context.projectPath));
    let dockerAvailable = false;
    if (this.nativeValidation) {
      try { await this.docker(["--version"], root); dockerAvailable = true; }
      catch { partial = true; diagnostics.push("Requested Docker-native validation is unavailable; static rules still ran."); }
    }

    for (const file of context.dockerfiles ?? []) {
      const filePath = path.resolve(root, file);
      if (!within(root, filePath)) { skippedInputs.push(file); partial = true; diagnostics.push(`Dockerfile outside project skipped: ${safeName(file)}`); continue; }
      try {
        const real = await fs.realpath(filePath);
        if (!within(root, real)) throw new Error("outside root");
        const content = await fs.readFile(real, "utf8");
        if (content.length > 1024 * 1024) throw new Error("too large");
        scannedInputs.push(file);
        this.analyzeDockerfile(content, file, findings);
        if (dockerAvailable) {
          try { await this.docker(["build", "--check", "-f", real, "."], path.dirname(real)); }
          catch { partial = true; diagnostics.push(`Docker-native build validation could not complete for ${safeName(file)}; static rules still ran.`); }
        }
      } catch {
        skippedInputs.push(file); partial = true; diagnostics.push(`Failed to read Dockerfile: ${safeName(file)}`);
      }
    }

    const allCompose = context.composeFiles ?? [];
    for (const file of allCompose) {
      const baseName = path.basename(file).toLowerCase();
      if (/^(?:docker-)?compose\.override\.ya?ml$/.test(baseName) && allCompose.some(other =>
        path.dirname(other) === path.dirname(file) && /^(?:docker-)?compose\.ya?ml$/.test(path.basename(other).toLowerCase()))) continue;
      const prefix = baseName.startsWith("docker-") ? "docker-compose" : "compose";
      const override = allCompose.filter(other => path.dirname(other) === path.dirname(file) &&
        new RegExp(`^${prefix}\\.override\\.ya?ml$`).test(path.basename(other).toLowerCase()));
      const members = /\.override\./.test(baseName) ? [file] : [file, ...override];
      const filePath = path.resolve(root, file);
      if (!within(root, filePath)) { skippedInputs.push(file); partial = true; diagnostics.push(`Compose file outside project skipped: ${safeName(file)}`); continue; }
      let document: ComposeDocument;
      try {
        const real = await fs.realpath(filePath);
        if (!within(root, real)) throw new Error("outside root");
        const content = await fs.readFile(real, "utf8");
        if (content.length > 1024 * 1024) throw new Error("too large");
        document = yaml.parse(content) as ComposeDocument;
        scannedInputs.push(file);
        for (const additional of members.slice(1)) {
          const full = path.resolve(root, additional);
          const resolved = await fs.realpath(full);
          if (!within(root, resolved)) throw new Error("override outside root");
          const overrideContent = await fs.readFile(resolved, "utf8");
          if (overrideContent.length > 1024 * 1024) throw new Error("override too large");
          yaml.parse(overrideContent);
          scannedInputs.push(additional);
        }
      } catch {
        findings.push({ id: "CO-01", title: "Invalid or unreadable Compose file", message: "Compose file could not be parsed or read.", severity: "high", category: "validation", source: this.name, confidence: "confirmed", file });
        skippedInputs.push(file); partial = true; continue;
      }
      if (members.length === 1) this.analyzeCompose(document, file, findings, "inferred");
      if (!dockerAvailable) {
        if (members.length > 1) { partial = true; diagnostics.push(`Compose overrides for ${safeName(file)} require Docker Compose to resolve; effective settings were skipped.`); }
        else if (await this.analyzeContexts(document, file, root, findings, diagnostics)) partial = true;
        continue;
      }
      try {
        // The CLI resolves variables and paths. Never expose its normalized output or errors in reports.
        const filesArgs = members.flatMap(member => ["-f", path.resolve(root, member)]);
        const output = await this.docker(["compose", ...filesArgs, "config", "--format", "json"], path.dirname(filePath));
        const effective = JSON.parse(output) as ComposeDocument;
        if (!effective || typeof effective.services !== "object") throw new Error("invalid model");
        // Prefer effective Compose values when available; avoid duplicate literal findings.
        findings.splice(0, findings.length, ...findings.filter(f => f.file !== file || !["PR-02", "PR-05", "PR-03", "PR-04"].includes(f.id)));
        this.analyzeCompose(effective, file, findings);
        if (await this.analyzeContexts(effective, file, root, findings, diagnostics)) partial = true;
      } catch {
        partial = true;
        diagnostics.push(`Effective Compose model unavailable for ${safeName(file)}; no cross-file claims were made.`);
        // Explicit literal values can still be reported from the parsed file, but are inferred until merge resolution.
        if (members.length === 1 && await this.analyzeContexts(document, file, root, findings, diagnostics)) partial = true;
      }
    }

    return { scanner: this.name, status: partial ? "partial" : "success", findings: findings.map(createScanIssue), scannedInputs, skippedInputs, diagnostics };
  }

  private analyzeDockerfile(content: string, file: string, findings: ScanIssueInput[]): void {
    const aliases = new Set<string>();
    const args = new Map<string, string>();
    // Effective USER per named stage, so a final stage built FROM an earlier stage inherits it.
    const stageUsers = new Map<string, string | undefined>();
    let stage: { alias?: string; line: number; user: string | undefined; scratch: boolean } | null = null;
    const finishStage = (): void => {
      if (stage?.alias) stageUsers.set(stage.alias, stage.user);
    };
    for (const { text, line } of instructions(content)) {
      const arg = /^ARG\s+([\w]+)(?:=(\S+))?/i.exec(text);
      if (arg?.[1] && arg[2]) args.set(arg[1], arg[2]);
      const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(text);
      if (from?.[1]) {
        finishStage();
        const image = from[1].replace(/^\$\{?(\w+)\}?$/, (_, key: string) => args.get(key) ?? "unknown");
        const parent = image.toLowerCase();
        stage = {
          ...(from[2] ? { alias: from[2].toLowerCase() } : {}),
          line,
          user: aliases.has(parent) ? stageUsers.get(parent) : undefined,
          scratch: parent === "scratch",
        };
        if (image !== "unknown" && image.toLowerCase() !== "scratch" && !aliases.has(image.toLowerCase()) &&
            (image.endsWith(":latest") || (!image.includes(":") && !image.includes("@")))) {
          findings.push({ id: "IM-01", title: "Mutable base image tag", message: `Base image reference ${safeName(image)} uses an implicit or explicit latest tag.`, severity: "medium", category: "reliability", source: this.name, confidence: "inferred", file, line, remediation: "Use an immutable digest for reproducible builds." });
        }
        const eol = aliases.has(parent) ? null : endOfLifeRelease(image);
        if (eol) {
          findings.push({ id: "IM-02", title: "End-of-life base image", message: `Base image ${safeName(eol)} is no longer supported upstream and receives no security fixes.`, severity: "medium", category: "security", source: this.name, confidence: "inferred", file, line, remediation: "Move to a currently supported release of the base image." });
        }
        if (from[2]) aliases.add(from[2].toLowerCase());
      }
      const user = /^USER\s+(\S+)/i.exec(text);
      if (user?.[1] && stage) stage.user = user[1].includes("$") ? "variable" : user[1];
      if (/^(ARG|ENV)\s/i.test(text) && /password|secret|token|key|cred/i.test(text)) {
        findings.push({ id: "SE-01", title: "Potential secret in build instruction", message: "A potentially sensitive name is used in ARG or ENV.", severity: "high", category: "security", source: this.name, confidence: "inferred", file, line, remediation: "Use a build secret mount instead of ARG or ENV for secrets." });
      }
    }
    // Only the final stage produces the runtime image.
    const last = stage as { line: number; user: string | undefined; scratch: boolean } | null;
    if (last && !last.scratch && runsAsRoot(last.user)) {
      findings.push({ id: "IM-03", title: "Container runs as root", message: "The final image stage has no non-root USER, so the container runs as root.", severity: "medium", category: "security", source: this.name, confidence: "inferred", file, line: last.line, remediation: "Add a USER instruction with a non-root user before the final CMD or ENTRYPOINT." });
    }
  }

  private analyzeCompose(doc: ComposeDocument, file: string, findings: ScanIssueInput[], confidence: "confirmed" | "inferred" = "confirmed"): void {
    for (const [name, service] of Object.entries(doc.services ?? {})) {
      if (!service || typeof service !== "object") continue;
      const key = safeName(name);
      if (service.privileged === true) findings.push({ id: "PR-02", title: "Privileged Compose service", message: `Service ${key} enables privileged mode.`, severity: "high", category: "security", source: this.name, confidence, file, key: `services.${key}.privileged`, remediation: "Remove privileged mode and grant only required capabilities." });
      if (Array.isArray(service.volumes) && service.volumes.some(v => {
        const source = typeof v === "string" ? v.split(":")[0] : (v && typeof v === "object" ? (v as { source?: unknown }).source : null);
        return source === "/var/run/docker.sock" || source === "/run/docker.sock";
      })) findings.push({ id: "PR-05", title: "Docker socket mounted", message: `Service ${key} mounts the Docker socket.`, severity: "critical", category: "security", source: this.name, confidence, file, key: `services.${key}.volumes`, remediation: "Avoid mounting the Docker daemon socket." });
      if (service.network_mode === "host" || service.pid === "host" || service.ipc === "host") findings.push({ id: "PR-04", title: "Host namespace shared", message: `Service ${key} explicitly shares a host namespace.`, severity: "medium", category: "security", source: this.name, confidence, file, key: `services.${key}`, remediation: "Use isolated namespaces unless host access is required." });
      if (Array.isArray(service.cap_add) && service.cap_add.some(c => c === "SYS_ADMIN" || c === "ALL")) findings.push({ id: "PR-03", title: "Broad Linux capability added", message: `Service ${key} adds a broad capability.`, severity: "high", category: "security", source: this.name, confidence, file, key: `services.${key}.cap_add`, remediation: "Remove broad capabilities and grant only what is required." });
    }
  }

  private async analyzeContexts(doc: ComposeDocument, file: string, root: string, findings: ScanIssueInput[], diagnostics: string[]): Promise<boolean> {
    let incomplete = false;
    for (const [name, service] of Object.entries(doc.services ?? {})) {
      const build = service?.build;
      if (!build) continue;
      const rawContext = typeof build === "string" ? build : (build as { context?: unknown }).context;
      if (typeof rawContext !== "string" || !rawContext || /^(https?:|git@|docker-image:)/i.test(rawContext)) {
        incomplete = true; diagnostics.push(`Local build context for service ${safeName(name)} is unsupported or unresolved.`); continue;
      }
      const contextPath = path.resolve(path.dirname(path.resolve(root, file)), rawContext);
      let contextReal: string;
      try { contextReal = await fs.realpath(contextPath); }
      catch { incomplete = true; diagnostics.push(`Local build context inaccessible for service ${safeName(name)}.`); continue; }
      if (!within(root, contextReal)) { incomplete = true; diagnostics.push(`Build context outside project skipped for service ${safeName(name)}.`); continue; }
      const dockerfileName = typeof build === "object" && build && typeof (build as { dockerfile?: unknown }).dockerfile === "string" ? (build as { dockerfile: string }).dockerfile : "Dockerfile";
      const dockerfilePath = path.resolve(contextReal, dockerfileName);
      let dockerfileReal: string;
      try { dockerfileReal = await fs.realpath(dockerfilePath); }
      catch { incomplete = true; diagnostics.push(`Build Dockerfile inaccessible for service ${safeName(name)}.`); continue; }
      if (!within(root, dockerfileReal)) { incomplete = true; diagnostics.push(`Build Dockerfile outside project skipped for service ${safeName(name)}.`); continue; }
      let content: string;
      try { content = await fs.readFile(dockerfileReal, "utf8"); }
      catch { incomplete = true; diagnostics.push(`Build Dockerfile unreadable for service ${safeName(name)}.`); continue; }
      const specialIgnore = `${dockerfileReal}.dockerignore`;
      const defaultIgnore = path.join(contextReal, ".dockerignore");
      const selectedIgnore = await fs.stat(specialIgnore).then(() => specialIgnore).catch(() => defaultIgnore);
      let rules = "";
      try {
        const ignoreReal = await fs.realpath(selectedIgnore);
        if (!within(root, ignoreReal)) { incomplete = true; diagnostics.push(`Ignore file outside project skipped for service ${safeName(name)}.`); continue; }
        rules = await fs.readFile(ignoreReal, "utf8");
        if (rules.length > 1024 * 1024) { incomplete = true; diagnostics.push(`Ignore file too large for service ${safeName(name)}.`); continue; }
      }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") { incomplete = true; diagnostics.push(`Ignore file unreadable for service ${safeName(name)}.`); continue; }
      }
      let matcher;
      try { matcher = ignore().add(rules); }
      catch { incomplete = true; diagnostics.push(`Ignore rules unsupported for service ${safeName(name)}.`); continue; }
      for (const candidate of SENSITIVE) {
        const candidatePath = path.join(contextReal, candidate);
        let candidateReal: string;
        try { candidateReal = await fs.realpath(candidatePath); }
        catch { continue; }
        if (!within(contextReal, candidateReal)) { incomplete = true; diagnostics.push(`Sensitive candidate symlink skipped for service ${safeName(name)}.`); continue; }
        if (matcher.ignores(candidate)) continue;
        for (const instruction of instructions(content)) {
          if (!/^(COPY|ADD)\s/i.test(instruction.text) || /\s--from(?:=|\s)/i.test(instruction.text)) continue;
          const sources = copySources(instruction.text);
          if (!sources) { incomplete = true; diagnostics.push(`COPY form unsupported for service ${safeName(name)}.`); continue; }
          if (sources.some(s => sourceMatches(s, candidate))) {
            findings.push({ id: "IM-05", title: "Sensitive file copied into build stage", message: `Service ${safeName(name)} copies unignored sensitive file "${candidate}" into a build stage.`, severity: "high", category: "security", source: this.name, confidence: "inferred", file: path.relative(root, dockerfileReal), line: instruction.line, remediation: `Exclude ${candidate} with the selected .dockerignore or narrow the COPY source.` });
          }
        }
      }
    }
    return incomplete;
  }
}
