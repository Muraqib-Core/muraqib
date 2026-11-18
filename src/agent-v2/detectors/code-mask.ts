/** Kind of a character in a JavaScript/TypeScript source file. */
export const KIND_CODE = 0;
export const KIND_STRING = 1;
export const KIND_COMMENT = 2;

/** Length of the `${` that opens a template expression. */
const EXPRESSION_OPEN = 2;

/*
 * One token of source text that is not plain code, tried left to right: a `// ...` or block
 * comment, a "double" or 'single' quoted one-line literal, a `template` literal (may span lines),
 * or a regex literal (only where a slash cannot be a division: not after a word character, ")" or "]").
 * Matches:  "// note"   "x = /ab[/]c/g"   "'it\\'s'"   "`x ${y}`"
 * Rejects:  "a / b / c" (division)   "\"unterminated"
 * Tester:   https://regex101.com/?regex=%5C%2F%5C%2F%5B%5E%5Cn%5D%2A%7C%5C%2F%5C%2A%5B%5Cs%5CS%5D%2A%3F%5C%2A%5C%2F%7C%22%28%3F%3A%5B%5E%22%5C%5C%5Cn%5D%7C%5C%5C.%29%2A%22%7C%27%28%3F%3A%5B%5E%27%5C%5C%5Cn%5D%7C%5C%5C.%29%2A%27%7C%60%28%3F%3A%5B%5E%60%5C%5C%5D%7C%5C%5C%5B%5Cs%5CS%5D%29%2A%60%7C%28%3F%3C%21%5B%5Cw%29%5C%5D%5D%5Cs%2A%29%5C%2F%28%3F%21%5B%2A%2F%5D%29%28%3F%3A%5B%5E%2F%5C%5C%5Cn%5B%5D%7C%5C%5C.%7C%5C%5B%28%3F%3A%5B%5E%5C%5D%5C%5C%5Cn%5D%7C%5C%5C.%29%2A%5C%5D%29%2B%5C%2F%5Ba-z%5D%2A&flags=g&flavor=javascript&testString=%2F%2F%20note%0Ax%20%3D%20%2Fab%5B%2F%5Dc%2Fg%0As%20%3D%20%22a%20b%22%20%2B%20%27it%5C%27s%27%20%2B%20%60x%20%24%7By%7D%60%0Ar%20%3D%20a%20%2F%20b%20%2F%20c%0A
 */
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`|(?<![\w)\]]\s*)\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/g;

/*
 * A `${ expression }` inside a template literal; the expression has no braces of its own.
 * Matches:  "${a.b}"   "${process.env.X}"      Rejects:  "${ {a: 1} }"   "$a"
 * Tester:   https://regex101.com/?regex=%5C%24%5C%7B%28%5B%5E%7B%7D%5D%2A%29%5C%7D&flags=g&flavor=javascript&testString=%60%24%7Ba.b%7D%20%24%7Bprocess.env.X%7D%20%24a%60
 */
const TEMPLATE_EXPRESSION = /\$\{([^{}]*)\}/g;

/**
 * Classifies every character of `content` as code, string/regex text or comment. It is a small
 * scanner, not a parser: a wrong guess (for example a regex mistaken for a division) only affects
 * the text around it, because each token is matched on its own and scanning continues after it.
 * `${}` expressions inside template literals count as code.
 *
 * @param content - Source text
 * @returns One kind per character
 */
export function classifyCode(content: string): Uint8Array {
  const kinds = new Uint8Array(content.length);
  [...content.matchAll(TOKEN)].forEach((match) => markToken(kinds, content, match[0], match.index));
  return kinds;
}

function markToken(kinds: Uint8Array, content: string, token: string, start: number): void {
  const isComment = token.startsWith("//") || token.startsWith("/*");
  kinds.fill(isComment ? KIND_COMMENT : KIND_STRING, start, start + token.length);
  if (!token.startsWith("`")) return;
  [...token.matchAll(TEMPLATE_EXPRESSION)].forEach((expression) => {
    const inner = expression[1] ?? "";
    const innerStart = start + expression.index + EXPRESSION_OPEN;
    kinds.set(classifyCode(content.slice(innerStart, innerStart + inner.length)), innerStart);
  });
}

/**
 * 1-based numbers of the lines whose first visible character belongs to a comment (a `//` line,
 * or any line inside or opening a block comment). A trailing comment after code does not make its line a comment line.
 *
 * @param content - Source text
 * @param kinds - Result of {@link classifyCode} for the same text; computed when omitted
 * @returns The comment-only line numbers
 */
export function commentOnlyLines(content: string, kinds: Uint8Array = classifyCode(content)): Set<number> {
  const lines = content.split("\n");
  const starts = lines.reduce<number[]>((acc, _text, index) => {
    acc.push(index === 0 ? 0 : (acc[index - 1] ?? 0) + (lines[index - 1]?.length ?? 0) + 1);
    return acc;
  }, []);
  return new Set(
    lines.flatMap((text, index) => {
      const indent = text.length - text.trimStart().length;
      const visible = text.trim() !== "";
      return visible && kinds[(starts[index] ?? 0) + indent] === KIND_COMMENT ? [index + 1] : [];
    }),
  );
}
