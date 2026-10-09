import fs from 'node:fs';
import path from 'node:path';

// Find latest dead-code report in workspace
const reports = fs.readdirSync(process.cwd()).filter((f) => f.startsWith('dead-code-report-') && f.endsWith('.json'));
if (reports.length === 0) {
  console.error('No dead-code-report-*.json found in repo root.');
  process.exit(1);
}

reports.sort();
const reportPath = path.resolve(process.cwd(), reports[reports.length - 1]);
console.log('Using report:', reportPath);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
const unreachable: string[] = report.unreachableBranches || report.reports?.filter((r: string) => r.startsWith('Unreachable code:')) || [];

function parseEntry(e: string) {
  // Accept either 'src\\file.ts:123' or full report lines 'Unreachable code: src\\file.ts:123 — ...'
  const m = e.match(/(?:Unreachable code:\s*)?(.+?):(\d+)/);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]) };
}

const entries = (report.unreachableBranches || unreachable).map((e: string) => parseEntry(e)).filter(Boolean) as {file:string,line:number}[];

for (const ent of entries) {
  const filePath = path.resolve(process.cwd(), ent.file);
  if (!fs.existsSync(filePath)) {
    console.warn('Missing file for annotation:', ent.file);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const idx = Math.max(0, Math.min(lines.length - 1, ent.line - 1));

  // Check if the annotation already exists within 2 lines above
  const already = (lines[idx-1] && lines[idx-1].includes('muraqib-unreachable')) ||
    (lines[idx] && lines[idx].includes('muraqib-unreachable')) ||
    (lines[idx+1] && lines[idx+1].includes('muraqib-unreachable'));
  if (already) {
    console.log(`Skipping (already annotated): ${ent.file}:${ent.line}`);
    continue;
  }

  const annotation = '// muraqib-unreachable: flagged by automated triage. Review before removal.';

  // Insert annotation above the target line
  lines.splice(idx, 0, annotation);

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  console.log(`Annotated ${ent.file}:${ent.line}`);
}

console.log('Annotation complete.');
process.exit(0);
