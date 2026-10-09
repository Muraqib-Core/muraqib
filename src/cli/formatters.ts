/**
 * Output Formatters for different formats (JSON, Text, HTML, CSV)
 */
import type { AuditReport } from "./types.js";

export function formatJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatText(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("╔════════════════════════════════════════════╗");
  lines.push("║         Muraqib Audit Report              ║");
  lines.push("╚════════════════════════════════════════════╝");
  lines.push("");

  lines.push(`📁 Project Root: ${report.projectRoot}`);
  lines.push(
    `⏱️  Generated: ${new Date(report.timestamp).toLocaleString()}`
  );
  lines.push("");

  lines.push("📊 Summary");
  lines.push("──────────────────────────────");
  lines.push(`  Total Issues:  ${report.summary.total}`);
  lines.push(`  🔴 Critical:   ${report.summary.critical}`);
  lines.push(`  🟠 High:       ${report.summary.high}`);
  lines.push(`  🟡 Medium:     ${report.summary.medium}`);
  lines.push(`  🔵 Low:        ${report.summary.low}`);
  lines.push("");

  // Module breakdown
  const moduleCount = Object.keys(report.modules).length;
  if (moduleCount > 0) {
    lines.push("🔍 Module Results");
    lines.push("──────────────────────────────");

    for (const [moduleName, moduleData] of Object.entries(report.modules)) {
      if (typeof moduleData === "object" && moduleData !== null) {
        let status = "❓";
        if ("status" in moduleData) {
          const statusValue = (moduleData as unknown as { status: string }).status;
          status = statusValue;
        } else if ("issues" in moduleData) {
          const issuesValue = (moduleData as unknown as { issues: unknown[] }).issues;
          status = Array.isArray(issuesValue) && issuesValue.length > 0 ? "⚠️" : "✅";
        }
        lines.push(`  ${status} ${moduleName}`);
      }
    }
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════");
  lines.push("End of Report");

  return lines.join("\n");
}

export function formatHtml(report: AuditReport): string {
  const criticalColor = "#dc2626";
  const highColor = "#ea580c";
  const mediumColor = "#eab308";
  const lowColor = "#0ea5e9";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Muraqib Audit Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      padding: 20px;
      color: #1f2937;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }

    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }

    .header p {
      opacity: 0.9;
      font-size: 1.1em;
    }

    .content {
      padding: 40px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .summary-card {
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      border-left: 4px solid #ddd;
    }

    .summary-card.critical {
      background: #fecaca;
      border-color: ${criticalColor};
    }

    .summary-card.high {
      background: #fed7aa;
      border-color: ${highColor};
    }

    .summary-card.medium {
      background: #fef08a;
      border-color: ${mediumColor};
    }

    .summary-card.low {
      background: #cffafe;
      border-color: ${lowColor};
    }

    .summary-card h3 {
      font-size: 2em;
      margin-bottom: 5px;
      font-weight: bold;
    }

    .summary-card p {
      font-size: 0.9em;
      opacity: 0.8;
    }

    .meta {
      background: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      font-size: 0.95em;
    }

    .meta-item {
      margin: 8px 0;
    }

    .meta-label {
      font-weight: 600;
      color: #6b7280;
    }

    .modules {
      margin-top: 30px;
    }

    .module-item {
      background: #f9fafb;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 6px;
      border-left: 4px solid #ddd;
    }

    .module-item.ok {
      border-left-color: #10b981;
    }

    .module-item.issues {
      border-left-color: #f59e0b;
    }

    .module-item.error {
      border-left-color: #ef4444;
    }

    .footer {
      background: #f3f4f6;
      padding: 20px 40px;
      text-align: center;
      font-size: 0.9em;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 600;
      margin-right: 8px;
    }

    .status-badge.critical {
      background: ${criticalColor};
      color: white;
    }

    .status-badge.high {
      background: ${highColor};
      color: white;
    }

    .status-badge.medium {
      background: ${mediumColor};
      color: black;
    }

    .status-badge.low {
      background: ${lowColor};
      color: white;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Muraqib Audit Report</h1>
      <p>Comprehensive Code Quality & Security Analysis</p>
    </div>

    <div class="content">
      <div class="meta">
        <div class="meta-item">
          <span class="meta-label">📁 Project Root:</span>
          ${report.projectRoot}
        </div>
        <div class="meta-item">
          <span class="meta-label">⏱️ Generated:</span>
          ${new Date(report.timestamp).toLocaleString()}
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary-card">
          <h3>${report.summary.total}</h3>
          <p>Total Issues</p>
        </div>
        <div class="summary-card critical">
          <h3>${report.summary.critical}</h3>
          <p>Critical</p>
        </div>
        <div class="summary-card high">
          <h3>${report.summary.high}</h3>
          <p>High</p>
        </div>
        <div class="summary-card medium">
          <h3>${report.summary.medium}</h3>
          <p>Medium</p>
        </div>
        <div class="summary-card low">
          <h3>${report.summary.low}</h3>
          <p>Low</p>
        </div>
      </div>

      <div class="modules">
        <h2>Module Results</h2>
        ${Object.entries(report.modules)
          .map(
            ([name]) => `
          <div class="module-item issues">
            <strong>${name}</strong>
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    <div class="footer">
      <p>Generated by Muraqib Core • ${new Date().getFullYear()}</p>
    </div>
  </div>
</body>
</html>`;

  return html;
}

export function formatCsv(report: AuditReport): string {
  const lines: string[] = [
    "Module,Severity,Count",
    `Summary,Critical,${report.summary.critical}`,
    `Summary,High,${report.summary.high}`,
    `Summary,Medium,${report.summary.medium}`,
    `Summary,Low,${report.summary.low}`,
  ];

  return lines.join("\n");
}

export function formatReport(
  report: AuditReport,
  format: "json" | "text" | "html" | "csv"
): string {
  switch (format) {
    case "json":
      return formatJson(report);
    case "html":
      return formatHtml(report);
    case "csv":
      return formatCsv(report);
    case "text":
    default:
      return formatText(report);
  }
}
