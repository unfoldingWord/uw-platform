import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { findVerb, isForbiddenVerbName } from '../../packages/contracts/index.ts';
import { repoFiles } from '../repo-files.ts';

export type SourceFiles = { readonly files: readonly string[]; read(file: string): string };

const appRoot = 'apps/uw-app/';
const mcpRoot = 'apps/uw-app/mcp/';
export const personSurface = 'apps/uw-app/commands/person/';
const entryPoints = ['apps/uw-app/app.tsx', 'apps/uw-app/index.ts'];
const verbsRoot = 'apps/uw-app/mcp/verbs/';
const verbsIndex = 'apps/uw-app/mcp/verbs/index.ts';
const canCallers = ['apps/uw-app/mcp/dispatch.ts', 'apps/uw-app/mcp/handler.ts'];

const sourceFile = /\.[cm]?[jt]sx?$/;
const testFile = /\.test\.[cm]?[jt]sx?$/;
const relativePath = /^\.{1,2}\//;

const moduleSpecifiers = [
  /^(\s*(?:import|export)\b[^;'"`=()]*\bfrom\s*)(['"])([^'"\n]*)\2/gm,
  /^(\s*import\s*)(['"])([^'"\n]*)\2/gm,
  /(\bimport\s*\(\s*)(['"])([^'"\n]*)\2/g,
];

const gateReach = [
  /\bgateDecisions\b|\bgate_decisions\b|\bharnessStages\b|\bharness_stages\b/,
  /\.gates\s*\??\./,
  /\bkernel\s*\??\.\s*stages\b/,
  /\bstages\s*\??\.\s*(?:activate|pause|resume)\s*\(/,
  /\b(?:createStage|updateStage|reorderStages|removeStage)\s*\(/,
  /\.repair\s*\??\./,
  /\.delegations\s*\??\.\s*(?:grant|revoke|write)\b/,
  /\.personas\s*\??\.\s*activate\b/,
  /\bkernel\s*\??\.\s*personas\b/,
  /\bexitThroughConnector\b/,
  /\bconnectors\s*\??\./,
  /\[\s*['"`](?:gates|stages|repair|connectors|personas)['"`]\s*\]/,
  /\bdelegations\s*\??\.?\s*\[\s*['"`](?:grant|revoke|write)['"`]\s*\]/,
  /\bpersonas\s*\??\.?\s*\[\s*['"`]activate['"`]\s*\]/,
  /\{[^{}]*\b(?:gates|repair|connectors|personas)\b[^{}]*\}\s*=(?![=>])/,
  /\{[^{}]*\b(?:grant|revoke|write)\b[^{}]*\}\s*=\s*[\w.?]*delegations\b/,
  /\{[^{}]*\bactivate\b[^{}]*\}\s*=\s*[\w.?]*personas\b/,
];

const personSurfaceCalls = [
  /\bkernel\s*\??\.\s*gates\s*\??\.\s*\w+\s*\(/g,
  /\bkernel\s*\??\.\s*stages\s*\??\.\s*\w+\s*\(/g,
  /\bkernel\s*\??\.\s*delegations\s*\??\.\s*(?:grant|revoke)\s*\(/g,
  /\bkernel\s*\??\.\s*personas\s*\??\.\s*activate\s*\(/g,
];

const handlerBuilder = /\b(?:gatedHandler|rowFilteredHandler)\s*\(/;
const rowsBuilder = /\browFilteredHandler\s*\(/;
const rowsReply = /\breply\s*:/;
const returnedArrows = [
  /=>\s*(?:\(([^()]*)\)|(\w+))\s*=>/g,
  /\breturn\s+(?:\(([^()]*)\)|(\w+))\s*=>/g,
  /\breturn\s+function\b[^(]*\(([^()]*)\)/g,
];
const moduleLets = [/^(?:let|var)\b/m, /^export[ \t]+(?:let|var)\b/m];
const declaresHandler = /\brun\s*[:(,}]|\bkind\s*(?::\s*['"](?:gated|rows)['"]|[,}])/;
const nameLiteral = /\bname\s*:\s*['"](\w+)['"]/g;
const canCall = /\bcan\s*\(/;

export function repoSources(): SourceFiles {
  return { files: repoFiles(), read: (file) => readFileSync(file, 'utf8') };
}

function isSource(file: string): boolean {
  return sourceFile.test(file) && !testFile.test(file) && !file.includes('node_modules/');
}

export function specifiersOf(text: string): string[] {
  return moduleSpecifiers.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[3] ?? ''),
  );
}

export function importsOf(file: string, text: string): string[] {
  const directory = posix.dirname(file);
  return specifiersOf(text)
    .filter((specifier) => relativePath.test(specifier))
    .map((specifier) => posix.normalize(posix.join(directory, specifier)));
}

function isSeed(file: string): boolean {
  return file.startsWith(mcpRoot) || entryPoints.includes(file);
}

function reachableFrom(sources: SourceFiles, seed: (file: string) => boolean): string[] {
  const known = new Set(sources.files.filter((file) => file.startsWith(appRoot) && isSource(file)));
  const pending = [...known].filter(seed);
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

export function agentReachable(sources: SourceFiles): string[] {
  return reachableFrom(sources, isSeed);
}

export function mcpReachable(sources: SourceFiles): string[] {
  return reachableFrom(sources, (file) => file.startsWith(mcpRoot));
}

export function importsLeavingApp(sources: SourceFiles, files: readonly string[]): string[] {
  return files
    .filter((file) =>
      importsOf(file, sources.read(file)).some((target) => !target.startsWith(appRoot)),
    )
    .sort();
}

function withoutModulePaths(text: string): string {
  return moduleSpecifiers.reduce((stripped, pattern) => stripped.replaceAll(pattern, "$1''"), text);
}

const shadowFollow = 'apps/uw-app/github/join.ts';
const shadowRecordCall = /\bkernel\s*\??\.\s*gates\s*\??\.\s*recordShadowVerdicts\s*\(/;

function withoutPersonSurfaceCalls(file: string, text: string): string {
  if (file === shadowFollow) return text.replace(shadowRecordCall, '(');
  if (!file.startsWith(personSurface)) return text;
  return personSurfaceCalls.reduce((stripped, pattern) => stripped.replaceAll(pattern, '('), text);
}

export function gateTouches(sources: SourceFiles, files: readonly string[]): string[] {
  return files
    .filter((file) => {
      const text = withoutPersonSurfaceCalls(file, withoutModulePaths(sources.read(file)));
      return gateReach.some((pattern) => pattern.test(text));
    })
    .sort();
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
      ((file !== verbsIndex && registered.has(file)) || declaresHandler.test(sources.read(file))),
  );
}

const rowFilters = /\bresources\s*:/g;

function resourcesSegments(text: string): string[] {
  return [...text.matchAll(rowFilters)].map((match) => {
    const rest = text.slice(match.index);
    const end = rest.slice(1).search(rowsReply);
    return end < 0 ? rest : rest.slice(0, end + 1);
  });
}

function takesARow(parameters: string): boolean {
  const first = parameters.split(',')[0]?.trim() ?? '';
  return first !== '' && !first.startsWith('_');
}

function mapsEachRow(segment: string): boolean {
  const mappers = returnedArrows.flatMap((pattern) =>
    [...segment.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? ''),
  );
  return mappers.length > 0 && mappers.every(takesARow);
}

function mapsEveryRow(text: string): boolean {
  const segments = resourcesSegments(text);
  return segments.length > 0 && segments.every(mapsEachRow);
}

function rowsHandlerSkips(text: string): boolean {
  if (!rowsBuilder.test(text)) return false;
  const granted = namesIn(text).some((name) => (findVerb(name)?.grant ?? null) !== null);
  return granted || !mapsEveryRow(text) || moduleLets.some((pattern) => pattern.test(text));
}

function handlerSkips(text: string): boolean {
  if (!handlerBuilder.test(text)) return false;
  return rowsHandlerSkips(text) || namesIn(text).some(isForbiddenVerbName);
}

export function handlersSkippingCan(sources: SourceFiles): string[] {
  const unbuilt = verbModules(sources).filter((file) => !handlerBuilder.test(sources.read(file)));
  const app = sources.files.filter((file) => file.startsWith(appRoot) && isSource(file));
  const skipping = app.filter((file) => handlerSkips(sources.read(file)));
  const uncan = canCallers.filter((file) => !canCall.test(sources.read(file)));
  return [...new Set([...unbuilt, ...skipping, ...uncan])].sort();
}
