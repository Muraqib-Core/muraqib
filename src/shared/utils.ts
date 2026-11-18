/** Safely extract a string message from an unknown caught value. */
export function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type MuraqibIssue = { path?: unknown; field?: unknown; message?: string };

/**
 * Flattens a validation failure into `path: message` lines. Understands Muraqib's own custom errors,
 * Zod-style `issues` and generic `errors` arrays; anything else becomes its message.
 *
 * @param error - The caught value
 * @returns One line per problem (never empty)
 */
export function extractEnvErrors(error: unknown): string[] {
  if (
    error !== null &&
    typeof error === "object" &&
    "isMuraqibCustom" in error &&
    (error as { isMuraqibCustom: boolean }).isMuraqibCustom &&
    "errors" in error &&
    Array.isArray((error as { errors: MuraqibIssue[] }).errors)
  ) {
    return (error as { errors: MuraqibIssue[] }).errors.map(
      (e) => `${String(e.path ?? e.field ?? "unknown")}: ${e.message ?? "invalid"}`
    );
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues: MuraqibIssue[] }).issues)
  ) {
    return (error as { issues: MuraqibIssue[] }).issues.map((e) => {
      const p = Array.isArray(e.path) ? (e.path as unknown[]).join(".") : String(e.path ?? "unknown");
      return `${p}: ${e.message ?? "invalid"}`;
    });
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray((error as { errors: MuraqibIssue[] }).errors)
  ) {
    return (error as { errors: MuraqibIssue[] }).errors.map((e) => {
      const p = Array.isArray(e.path) ? (e.path as unknown[]).join(".") : String(e.path ?? e.field ?? "unknown");
      return `${p}: ${e.message ?? "invalid"}`;
    });
  }
  return [toMessage(error)];
}

/**
 * Value that follows `flag` in a CLI argument list.
 *
 * @param args - Raw arguments
 * @param flag - Flag to look for, e.g. `--path`
 * @returns The next argument, or undefined when the flag is absent or followed by another flag
 */
export function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0) {
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      return next;
    }
  }
  return undefined;
}
