import { performAsyncAudit } from '../src/core/async-guard.js';
const res = performAsyncAudit(process.cwd());
console.log('Async reports length:', res.reports.length);
console.log(res.reports.join('\n'));
process.exit(0);
