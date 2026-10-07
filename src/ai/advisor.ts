/**
 * AI Advisor - Provides AI-powered recommendations for audit issues
 */

export interface AIRecommendation {
  issue: string;
  recommendation: string;
  examples: string[];
  confidence: number;
}

export async function getAIRecommendation(
  issueType: string,
  _details?: string
): Promise<AIRecommendation> {
  const recommendations: Record<string, AIRecommendation> = {
    memory_leak: {
      issue: "Memory leak detected",
      recommendation: "Use WeakMap for cached references and add cleanup in destructors",
      examples: [
        "const cache = new WeakMap()",
        "useEffect(() => () => cleanup(), [])",
      ],
      confidence: 0.95,
    },
    security_header: {
      issue: "Missing security header",
      recommendation: "Add Content-Security-Policy header to prevent XSS",
      examples: [
        "res.setHeader('Content-Security-Policy', \"default-src 'self'\")",
      ],
      confidence: 0.92,
    },
    large_bundle: {
      issue: "Bundle size exceeds budget",
      recommendation: "Use code splitting and lazy loading for heavy modules",
      examples: [
        "const Module = lazy(() => import('./heavy-module'))",
        "Dynamic imports: import('./module')",
      ],
      confidence: 0.88,
    },
  };

  return (
    recommendations[issueType] || {
      issue: issueType,
      recommendation: "Review the issue and apply best practices",
      examples: [],
      confidence: 0.5,
    }
  );
}
