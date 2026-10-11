/**
 * Blank out string literals, template-literal text and comments so line-based heuristics only
 * ever look at real code. Code that is merely *data* (for example a browser script held in a
 * template literal) must not be reported as if it were executed by the audited module.
 *
 * The result has exactly the same length and line breaks as the input, so line and column
 * numbers computed on the masked text still point at the original source. Quote characters and
 * `${` / `}` delimiters are kept; expressions inside `${...}` are real code and stay visible.
 */
export function maskLiteralsAndComments(source: string): string {
  const out: string[] = [];
  /** One entry per open `${` expression: how many `{` are still open inside it. */
  const expressionDepths: number[] = [];
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;
  let inTemplateText = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);

    if (ch === "\n") {
      out.push(ch);
      lineComment = false;
      quote = null; // a quoted string never spans lines; recover from regex literals holding quotes
      continue;
    }
    if (lineComment) {
      out.push(" ");
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        out.push("  ");
        i++;
        blockComment = false;
      } else {
        out.push(" ");
      }
      continue;
    }
    if (quote !== null) {
      if (ch === "\\") {
        out.push(" ", next === "\n" ? "\n" : " ");
        i++;
      } else if (ch === quote) {
        out.push(ch);
        quote = null;
      } else {
        out.push(" ");
      }
      continue;
    }
    if (inTemplateText) {
      if (ch === "\\") {
        out.push(" ", next === "\n" ? "\n" : " ");
        i++;
      } else if (ch === "`") {
        out.push(ch);
        inTemplateText = false;
      } else if (ch === "$" && next === "{") {
        out.push("${");
        i++;
        inTemplateText = false;
        expressionDepths.push(0);
      } else {
        out.push(" ");
      }
      continue;
    }

    // Plain code.
    if (ch === "/" && next === "/") {
      lineComment = true;
      out.push("  ");
      i++;
    } else if (ch === "/" && next === "*") {
      blockComment = true;
      out.push("  ");
      i++;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out.push(ch);
    } else if (ch === "`") {
      inTemplateText = true;
      out.push(ch);
    } else if (ch === "{" && expressionDepths.length > 0) {
      expressionDepths[expressionDepths.length - 1] = (expressionDepths[expressionDepths.length - 1] ?? 0) + 1;
      out.push(ch);
    } else if (ch === "}" && expressionDepths.length > 0) {
      const depth = expressionDepths[expressionDepths.length - 1] ?? 0;
      if (depth === 0) {
        expressionDepths.pop();
        inTemplateText = true;
      } else {
        expressionDepths[expressionDepths.length - 1] = depth - 1;
      }
      out.push(ch);
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}
