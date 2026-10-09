import { performDependencyAudit } from '../src/core/dependency-guard.js';

const res = performDependencyAudit(process.cwd());
console.log('Deprecated imports:');
console.log(res.deprecatedImports.join('\n') || '(none)');
console.log('\nReports summary length:', res.reports.length);
process.exit(0);
