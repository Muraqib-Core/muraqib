import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mapIssuesToDiagnostics } from "../src/core/diagnostics.js";
import { renderReportHtml } from "../src/core/report-html.js";
import { NONCE } from "./fixtures.js";

// Needs the root build (`npm run build` at the repository root); skipped when dist/ is absent.
const coreBuilt = existsSync(path.resolve(__dirname, "../../dist/index.js"));

describe.skipIf(!coreBuilt)("muraqib-core integration", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "muraqib-ext-int-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("renders a real agent report and maps its diagnostics", async () => {
    const core = await import("muraqib-core");
    const report = await core.runAuditForAgent({ projectRoot: dir, modules: ["config"] });
    expect(typeof report.ok).toBe("boolean");
    const html = renderReportHtml(report, { nonce: NONCE });
    expect(html).toContain("<!DOCTYPE html>");
    mapIssuesToDiagnostics(report, dir);
  });

  it("returns the documentation page for the same nonce used in the CSP", async () => {
    const core = await import("muraqib-core");
    const html = core.getWebviewHtml(NONCE);
    expect(html).toContain(`script-src 'nonce-${NONCE}'`);
  });
});
