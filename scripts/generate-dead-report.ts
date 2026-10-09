import fs from 'node:fs';
import path from 'node:path';
import { performDeadCodeAudit } from '../src/rules/dead-code-guard.js';

const reportPath = path.resolve(process.cwd(), `dead-code-report-${Date.now()}.json`);
const result = performDeadCodeAudit(process.cwd());
fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
console.log('Saved dead-code report to', reportPath);
process.exit(0);
