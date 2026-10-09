import { performDependencyAudit } from '../src/core/dependency-guard.js';

const res = performDependencyAudit(process.cwd());
console.log('reports:', res.reports.length);
console.log('deprecatedImports:', res.deprecatedImports);
console.log('circularDependencies:', res.circularDependencies.length);
console.log('outdatedPackages:', res.outdatedPackages);
console.log('duplicatePackages:', res.duplicatePackages);