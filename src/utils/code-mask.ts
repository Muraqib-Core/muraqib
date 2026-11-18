type Mode = "code" | "line-comment" | "block-comment" | "quote" | "template-text";

interface MaskState {
  out: string[];
  mode: Mode;
  /** The opening quote while `mode` is "quote". */
  quote: string;
  /** One entry per open `${` expression: how many `{` are still open inside it. */
  expressionDepths: number[];
}

/** A handler masks the character at hand and returns how many extra characters it consumed. */
type ModeHandler = (state: MaskState, ch: string, next: string) => number;

/** A backslash escape blanks both characters, but keeps a line break so line numbers survive. */
function maskEscape(state: MaskState, next: string): number {
  state.out.push(" ", next === "\n" ? "\n" : " ");
  return 1;
}

function maskBlockComment(state: MaskState, ch: string, next: string): number {
  if (ch === "*" && next === "/") {
    state.out.push("  ");
    state.mode = "code";
    return 1;
  }
  state.out.push(" ");
  return 0;
}

function maskQuoted(state: MaskState, ch: string, next: string): number {
  if (ch === "\\") return maskEscape(state, next);
  if (ch === state.quote) {
    state.out.push(ch);
    state.mode = "code";
  } else {
    state.out.push(" ");
  }
  return 0;
}

function maskTemplateText(state: MaskState, ch: string, next: string): number {
  if (ch === "\\") return maskEscape(state, next);
  if (ch === "`") {
    state.out.push(ch);
    state.mode = "code";
    return 0;
  }
  if (ch === "$" && next === "{") {
    state.out.push("${");
    state.mode = "code";
    state.expressionDepths.push(0);
    return 1;
  }
  state.out.push(" ");
  return 0;
}

/** Tracks `{`/`}` inside a `${...}` expression; its closing `}` returns to template text. */
function maskExpressionBrace(state: MaskState, ch: string): void {
  const top = state.expressionDepths.length - 1;
  const depth = state.expressionDepths[top] ?? 0;
  if (ch === "{") {
    state.expressionDepths[top] = depth + 1;
  } else if (depth === 0) {
    state.expressionDepths.pop();
    state.mode = "template-text";
  } else {
    state.expressionDepths[top] = depth - 1;
  }
  state.out.push(ch);
}

function maskCode(state: MaskState, ch: string, next: string): number {
  if (ch === "/" && (next === "/" || next === "*")) {
    state.mode = next === "/" ? "line-comment" : "block-comment";
    state.out.push("  ");
    return 1;
  }
  if (ch === "'" || ch === '"') {
    state.mode = "quote";
    state.quote = ch;
  } else if (ch === "`") {
    state.mode = "template-text";
  } else if ((ch === "{" || ch === "}") && state.expressionDepths.length > 0) {
    maskExpressionBrace(state, ch);
    return 0;
  }
  state.out.push(ch);
  return 0;
}

const MODE_HANDLERS: Record<Mode, ModeHandler> = {
  code: maskCode,
  "line-comment": (state) => {
    state.out.push(" ");
    return 0;
  },
  "block-comment": maskBlockComment,
  quote: maskQuoted,
  "template-text": maskTemplateText,
};

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
  const state: MaskState = { out: [], mode: "code", quote: "", expressionDepths: [] };

  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === "\n") {
      state.out.push(ch);
      // A line comment ends here, and a quoted string never spans lines (this recovers from regex literals holding quotes).
      if (state.mode === "line-comment" || state.mode === "quote") state.mode = "code";
      continue;
    }
    i += MODE_HANDLERS[state.mode](state, ch, source.charAt(i + 1));
  }
  return state.out.join("");
}
