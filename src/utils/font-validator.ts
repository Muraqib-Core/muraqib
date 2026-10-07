// src/utils/font-validator.ts
export function auditHtmlFontLoading(htmlContent: string): { isValid: boolean; reason?: string } { // muraqib-ignore-dead: auto-suppressed by script for auditHtmlFontLoading
  const fontRegex = /fonts\.googleapis\.com\/css\?family=([^"']+)/;
  const match = htmlContent.match(fontRegex); 
  
  if (match && match[1]) {
    const fontParams = match[1];
    const fontFamilies = fontParams.split('|');
    
    if (fontFamilies.length > 2) { 
      return {
        isValid: false,
        reason: `🚨 [Muraqib Font Guard Failure]: Found ${fontFamilies.length} external font families loaded via a single request. Optimize by hosting fonts locally.`,
      };
    }
  }

  return { isValid: true };
// (triage) previously flagged as unreachable — reviewed and retained.
}