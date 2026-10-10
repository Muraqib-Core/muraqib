// Shared implementation lives in src/ai (single source of truth).
// The scan layer's findings are passed straight to the shared advisor.
export { generateFindingsAdvisory as generateAdvisory } from "../../ai/advisor.js";
