import type { AuditEngine } from "../core/session.js";

let cached: Promise<AuditEngine> | undefined;

/**
 * Load muraqib-core lazily. The core package is ESM-only while a VS Code extension host loads
 * CommonJS, so it must be reached through a dynamic `import()`, which TypeScript keeps as-is
 * under `module: Node16`.
 */
function loadEngine(): Promise<AuditEngine> {
  cached ??= import("muraqib-core").then(
    (core): AuditEngine => ({
      runAudit: (options) => core.runAuditForAgent(options),
      getDocsHtml: (nonce) => Promise.resolve(core.getWebviewHtml(nonce)),
    })
  );
  // A failed load (for example muraqib-core not built) must be retried on the next command.
  cached.catch(() => {
    cached = undefined;
  });
  return cached;
}

/** An {@link AuditEngine} whose functions load muraqib-core on first use. */
export const lazyEngine: AuditEngine = {
  runAudit: async (options) => (await loadEngine()).runAudit(options),
  getDocsHtml: async (nonce) => (await loadEngine()).getDocsHtml(nonce),
};
