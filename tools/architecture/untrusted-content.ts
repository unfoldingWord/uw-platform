import { importsOf, specifiersOf, type SourceFiles } from './agent-boundary.ts';

type Call = { readonly name: string; readonly args: string };

const wrapperFile = 'packages/harness/untrusted.ts';
const scannedRoot = /^(?:apps|packages)\//;
const sourceFile = /\.[cm]?[jt]sx?$/;
const testFile = /\.test\.[cm]?[jt]sx?$/;
const testingHelper = /(?:^|\/)testing(?:\/|\.ts$)/;

const builderDeclaration = /\bexport\s+(?:function\s+(\w+Prompt)\s*\(|const\s+(\w+Prompt)\s*=)/g;
const builderAlias = /\b(\w+Prompt)\s+as\s+(\w+)/g;
const anyCall = /\b(\w+)\s*\(/g;
const wrapperCall = /\buntrusted\s*\(/;

const forgeries = [
  /\bas\s+UntrustedContent\b/,
  /<\s*UntrustedContent\s*>/,
  /\bnew\s+UntrustedContent\b/,
  /\bclass\s+UntrustedContent\b/,
  /\.constructor\b/,
];

const outsideReads = [
  /\bgithubFacts\b/,
  /\breviewDiff\b/,
  /\bgh(?:Issues|Prs|Reviews|CheckRuns|Milestones)\b/,
  /\bgh_(?:issues|prs|reviews|check_runs|milestones)\b/,
  /['"`](?:resolve_context|read_page|search_pages|query_entities)['"`]/,
  /\bbodyMd\b/,
  /\bfindings\b/,
  /\bissue\s*\??\.\s*(?:title|body)\b/,
];

const outsideFields =
  /\b(?:diff|context|related|issueBody|reviewComments)\??\s*:\s*(?:readonly )?string\b/;
const outsideModules = [/\/github\//, /\/pages\//, /^@uw\/db\/schema/, /^drizzle-orm/];

const cacheMarker = /[Cc]ache/;
const modelOutput = /\b(?:EngineWorkResult|ModelDone|TurnResult)\b/;
const clearanceCall = /\bclearanceKey\s*\(/;

function scannedFiles(sources: SourceFiles): string[] {
  return sources.files.filter(
    (file) =>
      scannedRoot.test(file) &&
      sourceFile.test(file) &&
      !testFile.test(file) &&
      !file.includes('node_modules/'),
  );
}

function buildersIn(text: string): string[] {
  return [...text.matchAll(builderDeclaration)].map((match) => match[1] ?? match[2] ?? '');
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '(') depth += 1;
    if (text[at] === ')') depth -= 1;
    if (depth === 0) return at;
  }
  return text.length;
}

function callsIn(text: string): Call[] {
  return [...text.matchAll(anyCall)].map((match) => {
    const open = (match.index ?? 0) + match[0].length - 1;
    return { name: match[1] ?? '', args: text.slice(open, closingParen(text, open) + 1) };
  });
}

function withoutWrapped(text: string): string {
  let kept = text;
  for (let found = wrapperCall.exec(kept); found !== null; found = wrapperCall.exec(kept)) {
    const open = found.index + found[0].length - 1;
    kept = kept.slice(0, found.index) + kept.slice(closingParen(kept, open) + 1);
  }
  return kept;
}

function boundBuilders(text: string, names: ReadonlySet<string>): ReadonlyMap<string, string> {
  const bound = new Map([...names].map((name) => [name, name]));
  for (const match of text.matchAll(builderAlias)) {
    if (names.has(match[1] ?? '')) bound.set(match[2] ?? '', match[1] ?? '');
  }
  return bound;
}

function readsOutside(text: string): boolean {
  return outsideReads.some((pattern) => pattern.test(text));
}

function outsideModule(specifier: string): boolean {
  return outsideModules.some((pattern) => pattern.test(specifier));
}

function importsOutside(text: string): boolean {
  return specifiersOf(text).some(outsideModule);
}

export function promptBuilderFiles(sources: SourceFiles): string[] {
  return scannedFiles(sources)
    .filter((file) => buildersIn(sources.read(file)).length > 0)
    .sort();
}

function builderNames(sources: SourceFiles): ReadonlySet<string> {
  return new Set(promptBuilderFiles(sources).flatMap((file) => buildersIn(sources.read(file))));
}

export function buildersTakingOutsideText(sources: SourceFiles): string[] {
  return promptBuilderFiles(sources).filter((file) => {
    const text = sources.read(file);
    return outsideFields.test(text) || readsOutside(text) || importsOutside(text);
  });
}

export function unwrappedBuilderCalls(sources: SourceFiles): string[] {
  const names = builderNames(sources);
  const found: string[] = [];
  for (const file of scannedFiles(sources)) {
    const text = sources.read(file);
    const bound = boundBuilders(text, names);
    for (const call of callsIn(text)) {
      const builder = bound.get(call.name);
      if (builder !== undefined && readsOutside(withoutWrapped(call.args))) {
        found.push(`${file}: ${builder}`);
      }
    }
  }
  return found.sort();
}

export function forgedWrappers(sources: SourceFiles): string[] {
  return scannedFiles(sources)
    .filter((file) => file !== wrapperFile)
    .filter((file) => forgeries.some((pattern) => pattern.test(sources.read(file))))
    .sort();
}

function buildsPrompts(
  sources: SourceFiles,
  file: string,
  builders: readonly string[],
  names: ReadonlySet<string>,
): boolean {
  if (builders.includes(file)) return true;
  const text = sources.read(file);
  const bound = boundBuilders(text, names);
  if (callsIn(text).some((call) => bound.has(call.name))) return true;
  return importsOf(file, text).some((target) => builders.includes(target));
}

export function promptFilesReadingDirectly(sources: SourceFiles): string[] {
  const builders = promptBuilderFiles(sources);
  const names = builderNames(sources);
  return scannedFiles(sources)
    .filter((file) => buildsPrompts(sources, file, builders, names))
    .filter((file) => importsOutside(sources.read(file)))
    .sort();
}

export function cachesWithoutClearance(sources: SourceFiles): string[] {
  return scannedFiles(sources)
    .filter((file) => !testingHelper.test(file))
    .filter((file) => {
      const text = sources.read(file);
      return cacheMarker.test(text) && modelOutput.test(text) && !clearanceCall.test(text);
    })
    .sort();
}
