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

/** One answer the user can give to a {@link FixDecision}. */
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

/** What a fixer returns per plan step: a fix, a question for the user, or a skip with a reason. */
export type FixerResult =
  | { kind: "fix"; fix: ProposedFix }
  | { kind: "decision"; decision: FixDecision }
  | { kind: "skip"; issueId: string; reason: string };

/** Read-only information a fixer receives alongside the plan steps. */
export interface FixContext {
  projectRoot: string;
  /** The real project when `projectRoot` is a temp copy (the copy has no `.git`); used for git-history checks. */
  originalRoot?: string;
  /** User choices for decisions, keyed by issue id. */
  choices: ReadonlyMap<string, string>;
}

/** A repair strategy for one fix class. Pure: it reads the project and returns proposals, it never writes. */
export interface Fixer {
  readonly fixClass: FixClass;
  /**
   * Reads the project and proposes repairs; never writes.
   *
   * @param steps - Plan steps of this fixer's class
   * @param context - Project root and user choices
   * @returns One result per step
   */
  propose(steps: readonly PlanStep[], context: FixContext): FixerResult[];
}

/** `propose` writes a patch only; `apply` edits files on a new git branch after approval. */
export type FixMode = "propose" | "apply";
