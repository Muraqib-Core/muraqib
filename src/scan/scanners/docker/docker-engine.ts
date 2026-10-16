import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import ignore, { type Ignore } from "ignore";
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

interface ScanState {
  findings: ScanIssueInput[];
  diagnostics: string[];
  scannedInputs: string[];
  skippedInputs: string[];
  partial: boolean;
}

const BASE_COMPOSE = /^(?:docker-)?compose\.ya?ml$/;

/** A `compose.override.yml` next to a base compose file is merged into it, not scanned on its own. */
function isSupersededOverride(file: string, allCompose: string[]): boolean {
  const baseName = path.basename(file).toLowerCase();
  return /^(?:docker-)?compose\.override\.ya?ml$/.test(baseName) && allCompose.some(other =>
    path.dirname(other) === path.dirname(file) && BASE_COMPOSE.test(path.basename(other).toLowerCase()));
}

/** The file followed by the override files that merge into it (an override file stands alone). */
function composeMembers(file: string, allCompose: string[]): string[] {
  const baseName = path.basename(file).toLowerCase();
  if (/\.override\./.test(baseName)) return [file];
  const prefix = baseName.startsWith("docker-") ? "docker-compose" : "compose";
  const override = allCompose.filter(other => path.dirname(other) === path.dirname(file) &&
    new RegExp(`^${prefix}\\.override\\.ya?ml$`).test(path.basename(other).toLowerCase()));
  return [file, ...override];
}

/** Outcome of one build-analysis step: a value, or the diagnostic explaining why the service was skipped. */
type Step<T> = { value: T } | { skip: string };

/** Records a diagnostic and reports "incomplete". */
function skipped(diagnostics: string[], message: string): true {
  diagnostics.push(message);
  return true;
}

/** Resolves the service's local build context directory, which must exist inside the project. */
async function resolveBuildContext(build: unknown, file: string, root: string, service: string): Promise<Step<string>> {
  const rawContext = typeof build === "string" ? build : (build as { context?: unknown }).context;
  if (typeof rawContext !== "string" || !rawContext || /^(https?:|git@|docker-image:)/i.test(rawContext)) {
    return { skip: `Local build context for service ${service} is unsupported or unresolved.` };
  }
  const contextPath = path.resolve(path.dirname(path.resolve(root, file)), rawContext);
  let contextReal: string;
  try { contextReal = await fs.realpath(contextPath); }
  catch { return { skip: `Local build context inaccessible for service ${service}.` }; }
  if (!within(root, contextReal)) return { skip: `Build context outside project skipped for service ${service}.` };
  return { value: contextReal };
}

/** Reads the build's Dockerfile (default `Dockerfile` in the context), which must be inside the project. */
async function readBuildDockerfile(
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
  if (!within(root, real)) return { skip: `Build Dockerfile outside project skipped for service ${service}.` };
  try { return { value: { real, content: await fs.readFile(real, "utf8") } }; }
  catch { return { skip: `Build Dockerfile unreadable for service ${service}.` }; }
}

/** Reads the `.dockerignore` that applies to the build (`<Dockerfile>.dockerignore` wins); a missing file means no rules. */
async function readIgnoreRules(dockerfileReal: string, contextReal: string, root: string, service: string): Promise<Step<string>> {
  const specialIgnore = `${dockerfileReal}.dockerignore`;
  const defaultIgnore = path.join(contextReal, ".dockerignore");
  const selectedIgnore = await fs.stat(specialIgnore).then(() => specialIgnore).catch(() => defaultIgnore);
  try {
    const ignoreReal = await fs.realpath(selectedIgnore);
    if (!within(root, ignoreReal)) return { skip: `Ignore file outside project skipped for service ${service}.` };
    const rules = await fs.readFile(ignoreReal, "utf8");
    if (rules.length > 1024 * 1024) return { skip: `Ignore file too large for service ${service}.` };
    return { value: rules };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return { skip: `Ignore file unreadable for service ${service}.` };
    return { value: "" };
  }
}

interface DockerfileStage {
  alias?: string;
  line: number;
  user: string | undefined;
  scratch: boolean;
}

interface DockerfileState {
  aliases: Set<string>;
  args: Map<string, string>;
  /** Effective USER per named stage, so a final stage built FROM an earlier stage inherits it. */
  stageUsers: Map<string, string | undefined>;
  stage: DockerfileStage | null;
}

/** An image with an explicit `:latest` tag, or with neither a tag nor a digest. */
function isMutableTag(image: string): boolean {
  return image.endsWith(":latest") || (!image.includes(":") && !image.includes("@"));
}

/**
 * Docker scanner class.
 */
export class DockerScanner implements ScannerEngine {
  readonly name = "docker";
  constructor(private readonly docker: DockerCommand = defaultDocker, private readonly nativeValidation = false) {}

  /**
   * Supports.
   *
   * @param context - Context
   * @returns Supports result
   */
  supports(context: ScanContext): boolean {
    return Boolean(context.dockerfiles?.length || context.composeFiles?.length);
  }

  /**
   * Scan.
   *
   * @param context - Context
   * @returns Scan result
   */
  async scan(context: ScanContext): Promise<ScanResult> {
    const state: ScanState = { findings: [], diagnostics: [], scannedInputs: [], skippedInputs: [], partial: false };
    const root = await fs.realpath(context.projectPath).catch(() => path.resolve(context.projectPath));
    const dockerAvailable = await this.probeNativeDocker(root, state);

    for (const file of context.dockerfiles ?? []) {
      await this.scanDockerfile(file, root, dockerAvailable, state);
    }

    const allCompose = context.composeFiles ?? [];
    for (const file of allCompose) {
      if (isSupersededOverride(file, allCompose)) continue;
      await this.scanComposeFile(file, composeMembers(file, allCompose), root, dockerAvailable, state);
    }

    return {
      scanner: this.name,
      status: state.partial ? "partial" : "success",
      findings: state.findings.map(createScanIssue),
      scannedInputs: state.scannedInputs,
      skippedInputs: state.skippedInputs,
      diagnostics: state.diagnostics,
    };
  }

  /** Whether the Docker CLI can be used; only probed when native validation was requested. */
  private async probeNativeDocker(root: string, state: ScanState): Promise<boolean> {
    if (!this.nativeValidation) return false;
    try {
      await this.docker(["--version"], root);
      return true;
    } catch {
      state.partial = true;
      state.diagnostics.push("Requested Docker-native validation is unavailable; static rules still ran.");
      return false;
    }
  }

  private async scanDockerfile(file: string, root: string, dockerAvailable: boolean, state: ScanState): Promise<void> {
    const filePath = path.resolve(root, file);
    if (!within(root, filePath)) {
      state.skippedInputs.push(file);
      state.partial = true;
      state.diagnostics.push(`Dockerfile outside project skipped: ${safeName(file)}`);
      return;
    }
    try {
      const real = await fs.realpath(filePath);
      if (!within(root, real)) throw new Error("outside root");
      const content = await fs.readFile(real, "utf8");
      if (content.length > 1024 * 1024) throw new Error("too large");
      state.scannedInputs.push(file);
      this.analyzeDockerfile(content, file, state.findings);
      if (dockerAvailable) await this.nativeBuildCheck(real, file, state);
    } catch {
      state.skippedInputs.push(file);
      state.partial = true;
      state.diagnostics.push(`Failed to read Dockerfile: ${safeName(file)}`);
    }
  }

  private async nativeBuildCheck(real: string, file: string, state: ScanState): Promise<void> {
    try {
      await this.docker(["build", "--check", "-f", real, "."], path.dirname(real));
    } catch {
      state.partial = true;
      state.diagnostics.push(`Docker-native build validation could not complete for ${safeName(file)}; static rules still ran.`);
    }
  }

  private async scanComposeFile(
    file: string,
    members: string[],
    root: string,
    dockerAvailable: boolean,
    state: ScanState
  ): Promise<void> {
    const document = await this.readComposeDocument(file, members, root, state);
    if (!document) return;
    if (members.length === 1) this.analyzeCompose(document.value, file, state.findings, "inferred");
    if (dockerAvailable) await this.analyzeWithDocker(document.value, file, members, root, state);
    else await this.analyzeWithoutDocker(document.value, file, members, root, state);
  }

  /** Parses the compose file and its overrides; on any problem records why and returns undefined. */
  private async readComposeDocument(
    file: string,
    members: string[],
    root: string,
    state: ScanState
  ): Promise<{ value: ComposeDocument } | undefined> {
    const filePath = path.resolve(root, file);
    if (!within(root, filePath)) {
      state.skippedInputs.push(file);
      state.partial = true;
      state.diagnostics.push(`Compose file outside project skipped: ${safeName(file)}`);
      return undefined;
    }
    try {
      const real = await fs.realpath(filePath);
      if (!within(root, real)) throw new Error("outside root");
      const content = await fs.readFile(real, "utf8");
      if (content.length > 1024 * 1024) throw new Error("too large");
      const value = yaml.parse(content) as ComposeDocument;
      state.scannedInputs.push(file);
      for (const additional of members.slice(1)) {
        await this.validateOverride(additional, root);
        state.scannedInputs.push(additional);
      }
      return { value };
    } catch {
      state.findings.push({ id: "CO-01", title: "Invalid or unreadable Compose file", message: "Compose file could not be parsed or read.", severity: "high", category: "validation", source: this.name, confidence: "confirmed", file });
      state.skippedInputs.push(file);
      state.partial = true;
      return undefined;
    }
  }

  private async validateOverride(additional: string, root: string): Promise<void> {
    const resolved = await fs.realpath(path.resolve(root, additional));
    if (!within(root, resolved)) throw new Error("override outside root");
    const overrideContent = await fs.readFile(resolved, "utf8");
    if (overrideContent.length > 1024 * 1024) throw new Error("override too large");
    yaml.parse(overrideContent);
  }

  /** Without a Docker CLI, overrides cannot be merged, so only a lone file is analysed for build contexts. */
  private async analyzeWithoutDocker(
    document: ComposeDocument,
    file: string,
    members: string[],
    root: string,
    state: ScanState
  ): Promise<void> {
    if (members.length > 1) {
      state.partial = true;
      state.diagnostics.push(`Compose overrides for ${safeName(file)} require Docker Compose to resolve; effective settings were skipped.`);
    } else if (await this.analyzeContexts(document, file, root, state.findings, state.diagnostics)) {
      state.partial = true;
    }
  }

  private async analyzeWithDocker(
    document: ComposeDocument,
    file: string,
    members: string[],
    root: string,
    state: ScanState
  ): Promise<void> {
    try {
      // The CLI resolves variables and paths. Never expose its normalized output or errors in reports.
      const filesArgs = members.flatMap(member => ["-f", path.resolve(root, member)]);
      const output = await this.docker(["compose", ...filesArgs, "config", "--format", "json"], path.dirname(path.resolve(root, file)));
      const effective = JSON.parse(output) as ComposeDocument;
      if (!effective || typeof effective.services !== "object") throw new Error("invalid model");
      // Prefer effective Compose values when available; avoid duplicate literal findings.
      state.findings.splice(0, state.findings.length, ...state.findings.filter(f => f.file !== file || !["PR-02", "PR-05", "PR-03", "PR-04"].includes(f.id)));
      this.analyzeCompose(effective, file, state.findings);
      if (await this.analyzeContexts(effective, file, root, state.findings, state.diagnostics)) state.partial = true;
    } catch {
      state.partial = true;
      state.diagnostics.push(`Effective Compose model unavailable for ${safeName(file)}; no cross-file claims were made.`);
      // Explicit literal values can still be reported from the parsed file, but are inferred until merge resolution.
      if (members.length === 1 && await this.analyzeContexts(document, file, root, state.findings, state.diagnostics)) state.partial = true;
    }
  }

  private analyzeDockerfile(content: string, file: string, findings: ScanIssueInput[]): void {
    const state: DockerfileState = { aliases: new Set(), args: new Map(), stageUsers: new Map(), stage: null };
    for (const { text, line } of instructions(content)) {
      const arg = /^ARG\s+([\w]+)(?:=(\S+))?/i.exec(text);
      if (arg?.[1] && arg[2]) state.args.set(arg[1], arg[2]);
      const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(text);
      if (from?.[1]) this.startStage(from[1], from[2], line, file, state, findings);
      const user = /^USER\s+(\S+)/i.exec(text);
      if (user?.[1] && state.stage) state.stage.user = user[1].includes("$") ? "variable" : user[1];
      if (/^(ARG|ENV)\s/i.test(text) && /password|secret|token|key|cred/i.test(text)) {
        findings.push({ id: "SE-01", title: "Potential secret in build instruction", message: "A potentially sensitive name is used in ARG or ENV.", severity: "high", category: "security", source: this.name, confidence: "inferred", file, line, remediation: "Use a build secret mount instead of ARG or ENV for secrets." });
      }
    }
    // Only the final stage produces the runtime image.
    const last = state.stage;
    if (last && !last.scratch && runsAsRoot(last.user)) {
      findings.push({ id: "IM-03", title: "Container runs as root", message: "The final image stage has no non-root USER, so the container runs as root.", severity: "medium", category: "security", source: this.name, confidence: "inferred", file, line: last.line, remediation: "Add a USER instruction with a non-root user before the final CMD or ENTRYPOINT." });
    }
  }

  /** Handles a `FROM`: closes the previous stage, opens a new one and checks the base image. */
  private startStage(
    rawImage: string,
    alias: string | undefined,
    line: number,
    file: string,
    state: DockerfileState,
    findings: ScanIssueInput[]
  ): void {
    // Remember the finished stage's effective USER so a later stage built FROM it inherits it.
    if (state.stage?.alias) state.stageUsers.set(state.stage.alias, state.stage.user);
    const image = rawImage.replace(/^\$\{?(\w+)\}?$/, (_, key: string) => state.args.get(key) ?? "unknown");
    const parent = image.toLowerCase();
    const isStageRef = state.aliases.has(parent);
    state.stage = {
      ...(alias ? { alias: alias.toLowerCase() } : {}),
      line,
      user: isStageRef ? state.stageUsers.get(parent) : undefined,
      scratch: parent === "scratch",
    };
    if (image !== "unknown" && parent !== "scratch" && !isStageRef && isMutableTag(image)) {
      findings.push({ id: "IM-01", title: "Mutable base image tag", message: `Base image reference ${safeName(image)} uses an implicit or explicit latest tag.`, severity: "medium", category: "reliability", source: this.name, confidence: "inferred", file, line, remediation: "Use an immutable digest for reproducible builds." });
    }
    const eol = isStageRef ? null : endOfLifeRelease(image);
    if (eol) {
      findings.push({ id: "IM-02", title: "End-of-life base image", message: `Base image ${safeName(eol)} is no longer supported upstream and receives no security fixes.`, severity: "medium", category: "security", source: this.name, confidence: "inferred", file, line, remediation: "Move to a currently supported release of the base image." });
    }
    if (alias) state.aliases.add(alias.toLowerCase());
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
      if (await this.analyzeServiceBuild(name, build, file, root, findings, diagnostics)) incomplete = true;
    }
    return incomplete;
  }

  /** Checks one service's build for sensitive files copied into it. Returns true when it could not be fully checked. */
  private async analyzeServiceBuild(
    name: string,
    build: unknown,
    file: string,
    root: string,
    findings: ScanIssueInput[],
    diagnostics: string[]
  ): Promise<boolean> {
    const service = safeName(name);
    const context = await resolveBuildContext(build, file, root, service);
    if ("skip" in context) return skipped(diagnostics, context.skip);
    const contextReal = context.value;

    const dockerfile = await readBuildDockerfile(build, contextReal, root, service);
    if ("skip" in dockerfile) return skipped(diagnostics, dockerfile.skip);

    const rules = await readIgnoreRules(dockerfile.value.real, contextReal, root, service);
    if ("skip" in rules) return skipped(diagnostics, rules.skip);

    let matcher: Ignore;
    try { matcher = ignore().add(rules.value); }
    catch { return skipped(diagnostics, `Ignore rules unsupported for service ${service}.`); }

    return this.findSensitiveCopies(service, contextReal, root, dockerfile.value, matcher, findings, diagnostics);
  }

  /** Reports unignored sensitive files that a COPY/ADD in the build Dockerfile would pull in. */
  private async findSensitiveCopies(
    service: string,
    contextReal: string,
    root: string,
    dockerfile: { real: string; content: string },
    matcher: Ignore,
    findings: ScanIssueInput[],
    diagnostics: string[]
  ): Promise<boolean> {
    let incomplete = false;
    for (const candidate of SENSITIVE) {
      let candidateReal: string;
      try { candidateReal = await fs.realpath(path.join(contextReal, candidate)); }
      catch { continue; }
      if (!within(contextReal, candidateReal)) { incomplete = skipped(diagnostics, `Sensitive candidate symlink skipped for service ${service}.`); continue; }
      if (matcher.ignores(candidate)) continue;
      for (const instruction of instructions(dockerfile.content)) {
        if (!/^(COPY|ADD)\s/i.test(instruction.text) || /\s--from(?:=|\s)/i.test(instruction.text)) continue;
        const sources = copySources(instruction.text);
        if (!sources) { incomplete = skipped(diagnostics, `COPY form unsupported for service ${service}.`); continue; }
        if (sources.some(s => sourceMatches(s, candidate))) {
          findings.push({ id: "IM-05", title: "Sensitive file copied into build stage", message: `Service ${service} copies unignored sensitive file "${candidate}" into a build stage.`, severity: "high", category: "security", source: this.name, confidence: "inferred", file: path.relative(root, dockerfile.real), line: instruction.line, remediation: `Exclude ${candidate} with the selected .dockerignore or narrow the COPY source.` });
        }
      }
    }
    return incomplete;
  }
}
