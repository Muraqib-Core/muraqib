/** One validation failure in the unified shape every public engine reports. */
export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
  path: (string | number)[];
}

/** Issue reported when a schema throws something other than its own validation error. */
export function unknownErrorIssue(error: unknown, code = "UNKNOWN_ERROR"): ValidationIssue {
  return {
    field: "unknown",
    message: error instanceof Error ? error.message : String(error),
    code,
    path: [],
  };
}

/** Returns `result.data`, or throws one `Validation failed: ...` error listing every issue. */
export function dataOrThrow(result: { success: boolean; errors: ValidationIssue[]; data?: unknown }): unknown {
  if (!result.success) {
    const messages = result.errors.map(e => `${e.field}: ${e.message}`).join("; ");
    throw new Error(`Validation failed: ${messages}`);
  }
  return result.data;
}
