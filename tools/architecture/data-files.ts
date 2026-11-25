import { dirname } from 'node:path';

export type Sources = ReadonlyMap<string, string>;

const queryImport = /['"](?:drizzle-orm|@uw\/db\/schema)['"/]/;
const ownerDeclaration = /export const owns\b/;
const scanned = /^(?:apps|sim|packages\/(?!db\/)[^/]+)\/.+\.tsx?$/;
const testFile = /\.test\.tsx?$/;
const testSupport = /\/testing\//;
const surface = /(?:\.tsx$|\/routes\.ts$|\/views\/|\/islands\/)/;
const connections: readonly string[] = ['apps/uw-platform/database.ts'];

export function dataModules(sources: Sources): string[] {
  return [...sources]
    .filter(([path, text]) => !testFile.test(path) && ownerDeclaration.test(text))
    .map(([path]) => `${dirname(path)}/`);
}

function problemsOf(path: string, modules: readonly string[]): string[] {
  if (connections.includes(path) || testSupport.test(path)) return [];
  if (surface.test(path)) return [`${path} is a route or a view and queries the database`];
  if (modules.some((module) => path.startsWith(module))) return [];
  return [`${path} queries the database outside a module that owns tables`];
}

export function misplacedQueries(sources: Sources): string[] {
  const modules = dataModules(sources);
  return [...sources]
    .filter(([path, text]) => scanned.test(path) && !testFile.test(path) && queryImport.test(text))
    .flatMap(([path]) => problemsOf(path, modules));
}
