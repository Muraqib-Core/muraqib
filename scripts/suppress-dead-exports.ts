import fs from 'node:fs';
import path from 'node:path';

const reports = fs.readdirSync(process.cwd()).filter((f) => f.startsWith('dead-code-report-') && f.endsWith('.json'));
if (reports.length === 0) {
  console.error('No dead-code-report-*.json found in repo root.');
  process.exit(1);
}
reports.sort();
const reportPath = path.resolve(process.cwd(), reports[reports.length - 1]);
console.log('Using report:', reportPath);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
const unused = report.unusedExports || report.reports?.filter((r: string) => r.startsWith('Potentially unused export:')) || [];

function parseUnused(e: string) {
  // Accept 'src\\file.ts:123 (Name)'
  const m = e.match(/(?:Potentially unused export:\s*)?(.+?):(\d+)\s*\(([^)]+)\)/);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), name: m[3] };
}

const entries = (report.unusedExports || unused).map((e: string) => parseUnused(e)).filter(Boolean) as {file:string,line:number,name:string}[];

for (const ent of entries) {
  const filePath = path.resolve(process.cwd(), ent.file);
  if (!fs.existsSync(filePath)) {
    console.warn('Missing file for suppression:', ent.file);
    continue;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const idx = Math.max(0, Math.min(lines.length - 1, ent.line - 1));

  const lineText = lines[idx] || '';
  if (lineText.includes('muraqib-ignore-dead')) {
    console.log(`Already suppressed: ${ent.file}:${ent.line} (${ent.name})`);
    continue;
  }

  // Append suppression comment to the export line
  lines[idx] = `${lineText} // muraqib-ignore-dead: auto-suppressed by script for ${ent.name}`;
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  console.log(`Suppressed ${ent.file}:${ent.line} (${ent.name})`);
}

console.log('Suppression complete.');
process.exit(0);
