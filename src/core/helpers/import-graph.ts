import path from "path";
import { maskLiteralsAndComments } from "../../utils/code-mask.js";

/** Twin source extensions tried when an import specifier uses a JavaScript extension (TS ESM style). */
const JS_TO_TS_TWINS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
  ".jsx": [".tsx"],
};

/** Extensions appended to extension-less specifiers, in priority order. */
const APPEND_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

/** Matches `import x from "m"`, `export {x} from "m"`, `export * from "m"` (clause may span lines). */
const FROM_CLAUSE = /(?<![.\w$])(?:import|export)\b[\w$\s{},*]*?\bfrom\s*(['"])/g;
/** Matches side-effect imports: `import "m"`. */
const SIDE_EFFECT_IMPORT = /(?<![.\w$])import\s*(['"])/g;
/** Matches dynamic imports and CommonJS requires with a literal specifier. */
const CALL_IMPORT = /(?<![.\w$])(?:import|require)\s*\(\s*(['"])/g;

/**
 * Extract every module specifier referenced by static imports, re-exports, side-effect imports,
 * dynamic `import("x")` and `require("x")` calls. Comments are ignored. Detection runs on a
 * masked copy of the source (same length), and the specifier text is read back from the original.
 *
 * @param source - Source code of a TypeScript/JavaScript file
 * @returns Specifiers in order of appearance, without duplicates
 */
export function extractImportSpecifiers(source: string): string[] {
  const masked = maskLiteralsAndComments(source);
  const found = new Set<string>();

  for (const regex of [FROM_CLAUSE, SIDE_EFFECT_IMPORT, CALL_IMPORT]) {
    for (const match of masked.matchAll(regex)) {
      const quote = match[1];
      if (quote === undefined) continue;
      const open = match.index + match[0].length - 1;
      const close = masked.indexOf(quote, open + 1);
      if (close === -1) continue;
      const specifier = source.slice(open + 1, close);
      if (specifier.length > 0 && !specifier.includes("\n")) {
        found.add(specifier);
      }
    }
  }
  return [...found];
}

/**
 * Resolve a relative (or `/`-prefixed) specifier to a known file.
 * Order: exact file, TS twin of a JS extension, appended extensions, directory index files.
 *
 * @param fromFile - Absolute path of the importing file
 * @param specifier - Import specifier (`./a.js`, `../lib`, ...)
 * @param exists - Predicate telling whether an absolute path is a known file
 * @returns Absolute path of the resolved file, or undefined for bare/unresolvable specifiers
 */
export function resolveImportTarget(
  fromFile: string,
  specifier: string,
  exists: (absolutePath: string) => boolean
): string | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates: string[] = [base];

  const ext = path.extname(base);
  const twins = JS_TO_TS_TWINS[ext];
  if (twins !== undefined) {
    const stem = base.slice(0, base.length - ext.length);
    for (const twin of twins) candidates.push(stem + twin);
  }
  for (const extension of APPEND_EXTENSIONS) candidates.push(base + extension);
  for (const extension of APPEND_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));

  return candidates.find((candidate) => exists(candidate));
}

/**
 * Rotate a cycle (`[a, b, c, a]`) so it starts at its smallest node, keeping the closing node.
 *
 * @param cycle - Cycle whose last element repeats the first
 * @returns Canonical form used to deduplicate cycles
 */
function normaliseCycle(cycle: string[]): string[] {
  const nodes = cycle.slice(0, -1);
  if (nodes.length === 0) return cycle;
  let minIndex = 0;
  nodes.forEach((node, index) => {
    if (node < (nodes[minIndex] ?? node)) minIndex = index;
  });
  const rotated = [...nodes.slice(minIndex), ...nodes.slice(0, minIndex)];
  const first = rotated[0];
  return first === undefined ? cycle : [...rotated, first];
}

/**
 * Find circular dependencies with an iterative depth-first search.
 * Each distinct cycle is returned once, rotated to start at its smallest node and closed
 * by repeating that node (`[a, b, a]`).
 *
 * @param graph - Adjacency map from file to the files it imports
 * @returns Distinct cycles
 */
export function findCycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const onStack = new Set<string>();

  for (const root of graph.keys()) {
    if (visited.has(root)) continue;

    const pathStack: string[] = [root];
    const iterators: Array<Iterator<string>> = [(graph.get(root) ?? new Set<string>()).values()];
    visited.add(root);
    onStack.add(root);

    while (pathStack.length > 0) {
      const iterator = iterators[iterators.length - 1];
      if (iterator === undefined) break;
      const step = iterator.next();

      if (step.done === true) {
        const finished = pathStack.pop();
        iterators.pop();
        if (finished !== undefined) onStack.delete(finished);
        continue;
      }

      const neighbor = step.value;
      if (!graph.has(neighbor)) continue;

      if (onStack.has(neighbor)) {
        const start = pathStack.indexOf(neighbor);
        const cycle = normaliseCycle([...pathStack.slice(start), neighbor]);
        const key = cycle.join("\u0000");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!visited.has(neighbor)) {
        visited.add(neighbor);
        onStack.add(neighbor);
        pathStack.push(neighbor);
        iterators.push((graph.get(neighbor) ?? new Set<string>()).values());
      }
    }
  }
  return cycles;
}
