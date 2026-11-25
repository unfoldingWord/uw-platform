import { dirname } from 'node:path';

export type Sources = ReadonlyMap<string, string>;

const queryImport = /['"](?:drizzle-orm|@uw\/db\/schema)['"/]/;
const ownerDeclaration = /export const owns\b/;
const scanned = /^(?:apps|sim|packages\/(?!db\/)[^/]+)\/.+\.tsx?$/;
const testFile = /\.test\.tsx?$/;
const testSupport = /\/testing\//;
const surfacePath = /(?:\.tsx$|(?:^|[/-])(?:routes|handlers?)\.ts$|\/views\/|\/islands\/)/;
const webFramework = /['"]hono['"/]/;
const connections: readonly string[] = ['apps/uw-platform/database.ts'];

export function dataModules(sources: Sources): string[] {
  return [...sources]
    .filter(([path, text]) => !testFile.test(path) && ownerDeclaration.test(text))
    .map(([path]) => `${dirname(path)}/`);
}

function problemsOf(path: string, text: string, modules: readonly string[]): string[] {
  if (connections.includes(path) || testSupport.test(path)) return [];
  if (surfacePath.test(path) || webFramework.test(text)) {
    return [`${path} is a route, a handler or a view and queries the database`];
  }
  if (modules.some((module) => path.startsWith(module))) return [];
  return [`${path} queries the database outside a module that owns tables`];
}

export function misplacedQueries(sources: Sources): string[] {
  const modules = dataModules(sources);
  return [...sources]
    .filter(([path, text]) => scanned.test(path) && !testFile.test(path) && queryImport.test(text))
    .flatMap(([path, text]) => problemsOf(path, text, modules));
}
