import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';
import { dataModules, misplacedQueries, type Sources } from './data-files.ts';

const drizzle = "import { eq } from 'drizzle" + "-orm';";
const schema = "import { pages } from '@uw/db" + "/schema';";
const owner = "export const owns = ['pages'] as const;";

function repoSources(): Sources {
  const paths = repoFiles().filter((path) => /^(?:apps|packages|sim)\/.+\.tsx?$/.test(path));
  return new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]));
}

function planted(files: Readonly<Record<string, string>>): Sources {
  return new Map([['apps/uw-platform/pages/store.ts', owner], ...Object.entries(files)]);
}

describe('AGENTS.md rule 2: a query lives in a data file of a module that owns tables', () => {
  it('finds no query outside a data module, in a route or in a view', () => {
    expect(misplacedQueries(repoSources())).toEqual([]);
  });

  it('finds the modules that own tables', () => {
    const modules = dataModules(repoSources());
    expect(modules).toContain('apps/uw-platform/pages/');
    expect(modules).toContain('apps/uw-ingest/deliveries/');
  });

  it('allows a query beside the owner declaration, in the connection and in test support', () => {
    const sources = planted({
      'apps/uw-platform/pages/reads.ts': drizzle,
      'apps/uw-platform/pages/query/scope.ts': schema,
      'apps/uw-platform/database.ts': drizzle,
      'apps/uw-platform/testing/world.ts': schema,
      'apps/uw-platform/views/page.test.tsx': schema,
      'packages/db/store/items.ts': drizzle,
    });
    expect(misplacedQueries(sources)).toEqual([]);
  });

  it.each([
    ['a module that owns no table', 'apps/uw-platform/health/reads.ts', drizzle],
    ['a schema import outside a data module', 'apps/uw-platform/mcp/tools.ts', schema],
    [
      'a Drizzle subpath import',
      'apps/uw-ingest/webhooks/read.ts',
      "from 'drizzle" + "-orm/pg-core'",
    ],
    ['a dynamic import', 'apps/uw-platform/runs/step.ts', "await import('drizzle" + "-orm')"],
    ['a package other than the database package', 'packages/core/acl.ts', drizzle],
    ['the sim', 'sim/adapters/store.ts', drizzle],
  ])('fails on a planted query in %s', (_name, path, text) => {
    expect(misplacedQueries(planted({ [path]: text }))).toEqual([
      `${path} queries the database outside a module that owns tables`,
    ]);
  });
});

describe('AGENTS.md rule 2: a route, a handler or a view never queries the database', () => {
  it.each([
    ['a route file', 'apps/uw-platform/pages/routes.ts'],
    ['a component', 'apps/uw-platform/pages/panel.tsx'],
    ['a view', 'apps/uw-platform/pages/views/list.ts'],
    ['an island', 'apps/uw-platform/pages/islands/editor.ts'],
    ['a handler file the router registers', 'apps/uw-platform/pages/read-handlers.ts'],
    ['a single handler', 'apps/uw-platform/commands/handler.ts'],
    ['a named route file', 'apps/uw-platform/pages/file-routes.ts'],
  ])('fails on a planted query in %s, even inside a data module', (_name, path) => {
    expect(misplacedQueries(planted({ [path]: schema }))).toEqual([
      `${path} is a route, a handler or a view and queries the database`,
    ]);
  });

  it('fails on a planted query in any file that imports the web framework', () => {
    const path = 'apps/uw-platform/pages/reads.ts';
    const text = `import type { Context } from 'ho` + `no';\n${schema}`;
    expect(misplacedQueries(planted({ [path]: text }))).toEqual([
      `${path} is a route, a handler or a view and queries the database`,
    ]);
  });
});
