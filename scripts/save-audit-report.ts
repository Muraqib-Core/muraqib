import fs from 'fs';
import path from 'path';
import { runAudit } from '../src/index.js';

async function run() {
  const res = await runAudit({ silent: true });
  const outPath = path.join(process.cwd(), `muraqib-report-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(res, null, 2), 'utf-8');
  console.log('Saved audit to', outPath);
}

run().catch((e) => { console.error(e); process.exit(1); });
