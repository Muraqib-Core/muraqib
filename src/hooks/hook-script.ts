/**
 * Hook script blocks.
 *
 * Muraqib never owns a hook file. It owns one clearly marked block inside it, so an existing hook
 * (hand-written, Husky, lint-staged, ...) keeps working and `uninstall` removes only what was added.
 */

/** Git hooks Muraqib can manage. */
export const HOOK_NAMES = ["pre-commit", "pre-push"] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/** Where hook scripts look for a project-local Muraqib binary, relative to the repository root. */
export const DEFAULT_BIN = "node_modules/.bin/muraqib";

/** Environment variable that skips every Muraqib hook for one command. */
export const SKIP_ENV = "MURAQIB_SKIP_HOOKS";

const SHELL_SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:ba|z|da|k|a)?sh(?:\s|$)/;

/** Marker line that opens a managed block. */
export const blockStart = (hook: HookName): string => `# >>> muraqib ${hook} >>>`;
/** Marker line that closes a managed block. */
export const blockEnd = (hook: HookName): string => `# <<< muraqib ${hook} <<<`;

const BYPASS_NOTE: Record<HookName, string> = {
  "pre-commit": "Scans only the staged changes for secrets. Bypass once: git commit --no-verify",
  "pre-push": "Runs the security audit before pushing. Bypass once: git push --no-verify",
};

/**
 * The managed block for a hook, as lines (no trailing newline).
 * The block blocks the git operation only when Muraqib exits with 1 (findings); a missing binary or
 * an internal error (any other status) prints a warning and lets the operation continue.
 *
 * @param hook - Hook to render
 * @param bin - Project-local binary path relative to the repository root
 */
export function renderHookBlock(hook: HookName, bin: string = DEFAULT_BIN): string[] {
  return [
    blockStart(hook),
    "# Managed by `muraqib hook install`; remove with `muraqib hook uninstall`.",
    `# ${BYPASS_NOTE[hook]} (or ${SKIP_ENV}=1)`,
    `if [ -z "\${${SKIP_ENV}:-}" ]; then`,
    "  muraqib_status=0",
    `  if [ -x "./${bin}" ]; then`,
    `    "./${bin}" hook run ${hook} "$@" || muraqib_status=$?`,
    "  elif command -v muraqib >/dev/null 2>&1; then",
    `    muraqib hook run ${hook} "$@" || muraqib_status=$?`,
    "  else",
    `    echo "muraqib: not installed, skipping ${hook} check" >&2`,
    "  fi",
    '  if [ "$muraqib_status" -eq 1 ]; then exit 1; fi',
    "fi",
    blockEnd(hook),
  ];
}

/** Result of changing a hook file's text. */
export interface HookEdit {
  content: string;
  action: "created" | "appended" | "updated" | "unchanged" | "removed" | "absent";
  /** After a removal: nothing but an optional shebang remains, so the file can be deleted. */
  empty?: boolean;
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function findBlock(lines: readonly string[], hook: HookName): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line.trim() === blockStart(hook));
  if (start < 0) return undefined;
  const offset = lines.slice(start + 1).findIndex((line) => line.trim() === blockEnd(hook));
  if (offset < 0) throw new Error(`Found "${blockStart(hook)}" without its closing marker; fix or delete the block by hand.`);
  return { start, end: start + 1 + offset };
}

/** Whether a hook file can hold a shell block (no shebang, or a POSIX-style shell shebang). */
export function isShellHook(content: string): boolean {
  const first = content.split(/\r?\n/, 1)[0] ?? "";
  return !first.startsWith("#!") || SHELL_SHEBANG.test(first);
}

/**
 * Add or refresh the managed block in a hook file's text.
 *
 * @param existing - Current file text, or undefined when the file does not exist
 * @param hook - Hook the block is for
 * @param bin - Project-local binary path relative to the repository root
 * @returns The new text and what changed
 * @throws When the existing block is malformed
 */
export function upsertHookBlock(existing: string | undefined, hook: HookName, bin: string = DEFAULT_BIN): HookEdit {
  const block = renderHookBlock(hook, bin);
  if (existing === undefined) return { content: ["#!/bin/sh", ...block, ""].join("\n"), action: "created" };

  const eol = eolOf(existing);
  const lines = existing.split(/\r?\n/);
  const found = findBlock(lines, hook);
  if (found) {
    const next = [...lines.slice(0, found.start), ...block, ...lines.slice(found.end + 1)];
    const content = next.join(eol);
    return { content, action: content === existing ? "unchanged" : "updated" };
  }
  const at = lines[0]?.startsWith("#!") ? 1 : 0;
  const content = [...lines.slice(0, at), ...block, "", ...lines.slice(at)].join(eol);
  return { content, action: "appended" };
}

/**
 * Remove the managed block from a hook file's text, leaving everything else untouched.
 *
 * @param existing - Current file text
 * @param hook - Hook whose block to remove
 * @returns The new text; `action` is `absent` when there was no block
 * @throws When the existing block is malformed
 */
export function removeHookBlock(existing: string, hook: HookName): HookEdit {
  const eol = eolOf(existing);
  const lines = existing.split(/\r?\n/);
  const found = findBlock(lines, hook);
  if (!found) return { content: existing, action: "absent" };

  const after = lines.slice(found.end + 1);
  const before = lines.slice(0, found.start);
  // Drop the blank separator line that install added after the block.
  if (after[0] === "" && (before.length === 0 || (before.length === 1 && before[0]?.startsWith("#!")))) after.shift();
  const next = [...before, ...after];
  const empty = next.every((line, index) => line.trim() === "" || (index === 0 && line.startsWith("#!")));
  return { content: next.join(eol), action: "removed", empty };
}
