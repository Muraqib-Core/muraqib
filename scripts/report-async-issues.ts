import { performAsyncAudit } from '../src/core/async-guard.js';

(async () => {
  const res = performAsyncAudit(process.cwd());
  console.log('reports:', res.reports.length);
  console.log('reports detail:\n', res.reports.join('\n'));
  console.log('unhandledPromises:', res.unhandledPromises);
  console.log('missingAwait:', res.missingAwait);
  console.log('floatingPromises:', res.floatingPromises);
})();
