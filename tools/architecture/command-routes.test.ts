import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandRegistry } from '../../apps/uw-app/commands/registry.ts';
import { commandNames } from '../../packages/contracts/index.ts';
import { repoFiles } from '../repo-files.ts';

const appRoot = 'apps/uw-app/';
const handlerRoots = ['apps/uw-app/commands/handlers/', 'apps/uw-app/commands/person/'];
const dispatcher = 'apps/uw-app/commands/dispatch.ts';
const commandRoutes = 'apps/uw-app/commands/routes.ts';
const commandReads = 'apps/uw-app/commands/reads.ts';
const routeFiles = [
  'apps/uw-app/app.tsx',
  commandRoutes,
  'apps/uw-app/mcp/routes.ts',
  'apps/uw-app/acl/routes.ts',
  'apps/uw-app/agents/routes.ts',
  'apps/uw-app/pages/routes.ts',
  'apps/uw-app/health/routes.tsx',
  'apps/uw-app/auth/me.ts',
  'apps/uw-app/assets/routes.ts',
];

const sourceFile = /\.tsx?$/;
const testFile = /\.test\.tsx?$/;
const routeCall = /\b(?:app|routes)\s*\.\s*(?:get|post|put|patch|delete|all|on)\(\s*['"`]/;
const routeCalls = /\b(?:app|routes)\s*\.\s*(?:get|post|put|patch|delete|all|on)\(\s*['"`]/g;
const honoBinding = /\bnew\s+Hono\b/;
const builderCall = /\b(?:commandHandler|notWiredCommand)\s*\(/;
const literalAction = /\baction\s*:\s*['"](?:read|write|admin)['"]/;
const notWiredLiteral =
  /\bnotWiredCommand\s*\(\s*['"]\w+['"]\s*,\s*['"](?:read|write|admin)['"]\s*\)/;
const declaresName = /\bname\s*:\s*['"]\w+['"]/;
const canCall = /\bcan\s*\(/;
const runCall = /\.run\s*\(/;
const routeRegistration = /\broutes\s*\.\s*(?:get|post|put|patch|delete|all|on)\(/;
const arrowCall = /^\(\w+\)\s*=>\s*(\w+)\(/;
const namedArgument = /^(\w+)\s*\)/;
const topLevelFunction = /\n(?=export function |export async function |async function |function )/;
const functionName = /\bfunction (\w+)\(/;
const guardedEntry =
  /\bexecuteCommand\s*\(|\bkernel\s*\.\s*reads\s*\.\s*\w+\s*\(|\bkernel\s*\.\s*events\s*\.\s*read\s*\(|\bkernel\s*\.\s*gates\s*\.\s*view\s*\(/;

type Read = (file: string) => string;
const readReal: Read = (file) => readFileSync(file, 'utf8');

const plantedRoutes = [
  'async function handleCommand(c) {',
  '  return executeCommand(request, scope);',
  '}',
  'async function handleSneak(c) {',
  '  return c.json(await kernel.items.claim(caller, input));',
  '}',
  'async function handleEvents(c) {',
  '  return c.json(await kernel.events.read(caller, query));',
  '}',
  'export function harnessRoutes() {',
  "  routes.post('/:harness/commands/:name', (c) => handleCommand(c));",
  "  routes.get('/:harness/sneak', handleSneak);",
  "  routes.get('/:harness/events', handleEvents);",
  "  routes.get('/:harness/inline', async (c) => c.json({}));",
  '}',
].join('\n');

function appSources(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      file.startsWith(appRoot) &&
      sourceFile.test(file) &&
      !testFile.test(file) &&
      !file.includes('/testing/') &&
      !file.includes('node_modules/') &&
      !file.includes('/dist/'),
  );
}

function routesOutsideReviewedFiles(files: readonly string[], read: Read): string[] {
  return appSources(files)
    .filter((file) => !routeFiles.includes(file))
    .filter((file) => routeCall.test(read(file)) || honoBinding.test(read(file)))
    .sort();
}

function handlerFiles(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      handlerRoots.some((root) => file.startsWith(root)) &&
      sourceFile.test(file) &&
      !testFile.test(file),
  );
}

function builtWithLiteralAction(text: string): boolean {
  if (!builderCall.test(text)) return false;
  return literalAction.test(text) || notWiredLiteral.test(text);
}

function unbuiltHandlers(files: readonly string[], read: Read): string[] {
  return handlerFiles(files)
    .filter((file) => declaresName.test(read(file)) && !builtWithLiteralAction(read(file)))
    .sort();
}

function canPrecedesRun(text: string): boolean {
  const can = text.search(canCall);
  const run = text.search(runCall);
  return can >= 0 && run >= 0 && can < run;
}

function functionsIn(text: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const chunk of text.split(topLevelFunction)) {
    const name = functionName.exec(chunk)?.[1];
    if (name !== undefined) found.set(name, chunk);
  }
  return found;
}

function handlerOf(line: string): string | null {
  const rest = line.slice(line.indexOf(',') + 1).trim();
  return arrowCall.exec(rest)?.[1] ?? namedArgument.exec(rest)?.[1] ?? null;
}

function handlerNames(text: string): string[] {
  const lines = text.split('\n').filter((line) => routeRegistration.test(line));
  return lines.map(handlerOf).filter((name): name is string => name !== null);
}

function unguardedRoutes(text: string, handlers: string = text): string[] {
  const functions = functionsIn(handlers);
  const names = handlerNames(text);
  const registered = [...text.matchAll(routeCalls)].length;
  const unguarded = names.filter((name) => !guardedEntry.test(functions.get(name) ?? ''));
  const unresolved = registered - names.length;
  return [...unguarded, ...Array.from({ length: unresolved }, () => '<inline handler>')];
}

function plantedRead(texts: Readonly<Record<string, string>>): Read {
  return (file) => texts[file] ?? '';
}

describe('WB-1 the command routes are checked', () => {
  it('WB-1 the registry serves exactly the contract command names', () => {
    expect([...commandRegistry.keys()].sort()).toEqual([...commandNames].sort());
  });

  it('WB-1 every command handler is built by commandHandler or notWiredCommand with a literal action', () => {
    const files = repoFiles();
    expect(handlerFiles(files).length).toBeGreaterThan(0);
    expect(unbuiltHandlers(files, readReal)).toEqual([]);
  });

  it('WB-1 the dispatcher calls can() before it runs a handler', () => {
    expect(canPrecedesRun(readReal(dispatcher))).toBe(true);
  });

  it('WB-1 no route is registered outside the reviewed route files', () => {
    expect(routesOutsideReviewedFiles(repoFiles(), readReal)).toEqual([]);
  });

  it('WB-1 every route in the command routes reaches the dispatcher or a kernel read', () => {
    const text = readReal(commandRoutes);
    const handlers = `${text}\n${readReal(commandReads)}`;
    expect(handlerNames(text).length).toBeGreaterThan(1);
    expect(unguardedRoutes(text, handlers)).toEqual([]);
  });

  it('WB-1 flags a planted handler without a builder, a planted action that is not a literal, and a planted route file', () => {
    const bare = 'apps/uw-app/commands/handlers/bare.ts';
    const computed = 'apps/uw-app/commands/person/computed.ts';
    const built = 'apps/uw-app/commands/handlers/built.ts';
    const route = 'apps/uw-app/commands/sneak.ts';
    const binding = 'apps/uw-app/commands/sneak-binding.ts';
    const read = plantedRead({
      [bare]: "export const h = { name: 'claim', action: 'write', run };",
      [computed]: "export const h = commandHandler({ name: 'pause', action: level, run });",
      [built]: "export const h = commandHandler({ name: 'claim', action: 'write', run });",
      [route]: "routes.post('/x', (c) => c.json({}));",
      [binding]: 'const r = new Hono();',
    });
    expect(unbuiltHandlers([bare, computed, built], read)).toEqual([bare, computed].sort());
    expect(routesOutsideReviewedFiles([route, binding, built], read)).toEqual(
      [route, binding].sort(),
    );
  });
});

describe('the command route checks catch planted mistakes', () => {
  it('flags a planted dispatcher that runs before can()', () => {
    expect(canPrecedesRun('await handler.run(context, body); can(principal);')).toBe(false);
    expect(canPrecedesRun('await handler.run(context, body);')).toBe(false);
  });

  it('flags planted routes that skip the dispatcher and the kernel reads', () => {
    expect(unguardedRoutes(plantedRoutes)).toEqual(['handleSneak', '<inline handler>']);
    const route = "routes.get('/:harness/x', readSneak);";
    const sneak = 'async function readSneak(c) {\n  return c.json({});\n}';
    const guarded =
      'async function readSneak(c) {\n  return kernel.reads.inStage(caller, input);\n}';
    expect(unguardedRoutes(route, sneak)).toEqual(['readSneak']);
    expect(unguardedRoutes(route, guarded)).toEqual([]);
  });
});
