import type { FixClass, PlanStep } from "../types.js";

/** Full new content of one file. `file` is project-relative with `/` separators; a missing file is created. */
export interface FileEdit {
  file: string;
  content: string;
}

/** One repair a fixer wants to make, with everything needed to verify, patch and explain it. */
export interface ProposedFix {
  /** Stable across rounds: `fixClass|title`. */
  id: string;
  fixClass: FixClass;
  title: string;
  /** Plan-step issue ids (`PlanStep.issueId`) this fix is meant to make disappear. */
  resolves: string[];
  edits: FileEdit[];
  /** Shown to the user next to the fix (for example "rotate this credential"). Never contains a secret value. */
  warnings: string[];
  /**
   * True when the edits remove a secret literal. The removed text would appear in a diff, so these
   * fixes are never written to the patch file; they are only applied by the `apply` mode.
   */
  removesSecret: boolean;
}

export interface FixOption {
  key: string;
  label: string;
}

/** The fixer will not guess: the user must pick one option (`--choose <issueId>=<key>`). */
export interface FixDecision {
  issueId: string;
  question: string;
  options: FixOption[];
}

export type FixerResult =
  | { kind: "fix"; fix: ProposedFix }
  | { kind: "decision"; decision: FixDecision }
  | { kind: "skip"; issueId: string; reason: string };

export interface FixContext {
  projectRoot: string;
  /** User choices for decisions, keyed by issue id. */
  choices: ReadonlyMap<string, string>;
}

/** A repair strategy for one fix class. Pure: it reads the project and returns proposals, it never writes. */
export interface Fixer {
  readonly fixClass: FixClass;
  propose(steps: readonly PlanStep[], context: FixContext): FixerResult[];
}

export type FixMode = "propose" | "apply";
