/** One validation failure in the unified shape every public engine reports. */
export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
  path: (string | number)[];
}
