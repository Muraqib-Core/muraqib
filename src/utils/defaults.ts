/**
 * Default-value helpers.
 *
 * `??` only falls back on null/undefined. Several inputs (environment variables,
 * CLI arguments) must also treat an empty string as "not provided"; these helpers
 * make that intent explicit instead of relying on `||`.
 */

/**
 * Return the first candidate that is neither undefined, null nor an empty string.
 * @param candidates - Values in priority order
 * @returns The first non-empty string, or undefined when none qualifies
 */
export function firstNonEmpty(...candidates: Array<string | null | undefined>): string | undefined {
  return candidates.find((value): value is string => typeof value === "string" && value !== "");
}

/**
 * Return `value` unless it is undefined, null or an empty string, otherwise `fallback`.
 * @param value - Candidate value
 * @param fallback - Value used when the candidate is missing or empty
 * @returns The candidate or the fallback
 */
export function nonEmpty(value: string | null | undefined, fallback: string): string {
  return firstNonEmpty(value) ?? fallback;
}
