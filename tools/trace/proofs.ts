const scenarioFile = /^sim\/scenarios\/([A-Z]{2}-\d+)\.[a-z0-9-]+\.ts$/;
const callKeyword = /\b(?:describe|it|test)(?![\w$])/g;
const modifier = /\.([A-Za-z]+)/y;
const title = /\(\s*['"`]([A-Z]{2}-\d+ [^'"`]*)/y;
const requirementId = /^[A-Z]{2}-\d+$/;
const modifiersWithArguments: ReadonlySet<string> = new Set(['each', 'for', 'skipIf', 'runIf']);
const modifiersThatProveNothing: ReadonlySet<string> = new Set(['todo', 'skip', 'fails']);

export const provingTestFile = /^(?:apps|packages|tools|sim)\/.*\.test\.ts$/;

export function scenarioProofs(paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const match = scenarioFile.exec(path);
    return match?.[1] ? [match[1]] : [];
  });
}

function skipBalanced(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') depth -= 1;
    if (depth === 0) return index + 1;
  }
  return -1;
}

function readModifiers(source: string, from: number): { names: string[]; end: number } {
  const names: string[] = [];
  let end = from;
  for (;;) {
    modifier.lastIndex = end;
    const match = modifier.exec(source);
    if (!match?.[1]) return { names, end };
    names.push(match[1]);
    end += match[0].length;
    if (modifiersWithArguments.has(match[1]) && source[end] === '(') {
      end = skipBalanced(source, end);
      if (end === -1) return { names, end: source.length };
    }
  }
}

function leadingIds(text: string): string[] {
  const words = text.split(' ');
  const stop = words.findIndex((word) => !requirementId.test(word));
  return stop === -1 ? words : words.slice(0, stop);
}

export function testProofs(source: string): string[] {
  return [...source.matchAll(callKeyword)].flatMap((keyword) => {
    if (source[keyword.index - 1] === '.') return [];
    const { names, end } = readModifiers(source, keyword.index + keyword[0].length);
    if (names.some((name) => modifiersThatProveNothing.has(name))) return [];
    title.lastIndex = end;
    const match = title.exec(source);
    return match?.[1] ? leadingIds(match[1]) : [];
  });
}
