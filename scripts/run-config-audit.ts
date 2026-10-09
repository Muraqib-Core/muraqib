import { performConfigAudit } from '../src/core/config-guard.js';

const res = performConfigAudit(process.cwd());
console.log(JSON.stringify(res, null, 2));
