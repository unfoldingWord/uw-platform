import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { findVerb, isForbiddenVerbName } from '../../packages/contracts/index.ts';
import { repoFiles } from '../repo-files.ts';

export type SourceFiles = { readonly files: readonly string[]; read(file: string): string };

const appRoot = 'apps/uw-app/';
const mcpRoot = 'apps/uw-app/mcp/';
const verbsRoot = 'apps/uw-app/mcp/verbs/';
const verbsIndex = 'apps/uw-app/mcp/verbs/index.ts';
const dispatchFile = 'apps/uw-app/mcp/dispatch.ts';

const sourceFile = /\.(?:tsx?|m?js)$/;
const testFile = /\.test\.(?:tsx?|m?js)$/;

const relativeImports = [
  /\bfrom\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g,
  /\bimport\s*\(\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g,
  /\bimport\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g,
];
const moduleSpecifier = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])[^'"\n]*\2/g;

const gateReach =
  /\bgateDecisions\b|\bgate_decisions\b|\bharnessStages\b|\bharness_stages\b|\.gates\s*\??\.|\bkernel\s*\??\.\s*stages\b|\bstages\s*\??\.\s*activate\s*\(|\b(?:createStage|updateStage|reorderStages)\s*\(|\.repair\s*\??\.|\.delegations\s*\??\.\s*(?:grant|revoke)\b|\bexitThroughConnector\b|\bconnectors\s*\??\./;

const handlerBuilder = /\b(?:gatedHandler|rowFilteredHandler)\s*\(/;
const rowsBuilder = /\browFilteredHandler\s*\(/;
const rowFilter =
  /\bcan\s*\(|\breadableAreas\s*\(|\bsearchPages\s*\(|\.reads\s*\??\.\s*poll\s*\(|\bentityQueries\b/;
const declaresHandler = /\brun\s*:|\bkind\s*:\s*['"](?:gated|rows)['"]/;
const nameLiteral = /\bname\s*:\s*['"](\w+)['"]/g;
const canCall = /\bcan\s*\(/;

export function repoSources(): SourceFiles {
  return { files: repoFiles(), read: (file) => readFileSync(file, 'utf8') };
}

function isSource(file: string): boolean {
  return sourceFile.test(file) && !testFile.test(file) && !file.includes('node_modules/');
}

function importsOf(file: string, text: string): string[] {
  const directory = posix.dirname(file);
  return relativeImports.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) =>
      posix.normalize(posix.join(directory, match[2] ?? '')),
    ),
  );
}

export function agentReachable(sources: SourceFiles): string[] {
  const known = new Set(sources.files.filter((file) => file.startsWith(appRoot) && isSource(file)));
  const pending = [...known].filter((file) => file.startsWith(mcpRoot));
  const reached = new Set(pending);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const target of importsOf(file, sources.read(file))) {
      if (known.has(target) && !reached.has(target)) {
        reached.add(target);
        pending.push(target);
      }
    }
  }
  return [...reached].sort();
}

function withoutModulePaths(text: string): string {
  return text.replaceAll(moduleSpecifier, "$1''");
}

export function gateTouches(sources: SourceFiles, files: readonly string[]): string[] {
  return files.filter((file) => gateReach.test(withoutModulePaths(sources.read(file)))).sort();
}

function namesIn(text: string): string[] {
  return [...text.matchAll(nameLiteral)].map((match) => match[1] ?? '');
}

function verbModules(sources: SourceFiles): string[] {
  const registered = new Set(importsOf(verbsIndex, sources.read(verbsIndex)));
  return sources.files.filter(
    (file) =>
      file.startsWith(verbsRoot) &&
      isSource(file) &&
      file !== verbsIndex &&
      (registered.has(file) || declaresHandler.test(sources.read(file))),
  );
}

function rowsHandlerSkips(text: string): boolean {
  if (!rowsBuilder.test(text)) return false;
  const granted = namesIn(text).some((name) => (findVerb(name)?.grant ?? null) !== null);
  return granted || !rowFilter.test(text);
}

function handlerSkips(text: string): boolean {
  if (!handlerBuilder.test(text)) return false;
  return rowsHandlerSkips(text) || namesIn(text).some(isForbiddenVerbName);
}

export function handlersSkippingCan(sources: SourceFiles): string[] {
  const unbuilt = verbModules(sources).filter((file) => !handlerBuilder.test(sources.read(file)));
  const app = sources.files.filter((file) => file.startsWith(appRoot) && isSource(file));
  const skipping = app.filter((file) => handlerSkips(sources.read(file)));
  const dispatch = canCall.test(sources.read(dispatchFile)) ? [] : [dispatchFile];
  return [...new Set([...unbuilt, ...skipping, ...dispatch])].sort();
}
