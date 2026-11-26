import { pageTypeRegistry, verbRegistry } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { moduleSchema, modules } from './modules.ts';

const keys = modules.map((declared) => declared.key);

const undeclaredDependencies = (declared: (typeof modules)[number]): string[] =>
  declared.depends_on.filter((dependency) => !keys.includes(dependency));

const dependsOnLaterModule = (declared: (typeof modules)[number], position: number): boolean =>
  declared.depends_on.some((dependency) => keys.indexOf(dependency) >= position);

describe('the module registry', () => {
  it('declares core and agents', () => {
    expect(keys).toEqual(['core', 'agents', 'strategy']);
  });

  it.each(modules)('declares $key in the plan §14 shape', (declared) => {
    expect(moduleSchema.parse(declared)).toEqual(declared);
  });

  it('has unique keys', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('depends only on declared modules', () => {
    const undeclared = modules.flatMap(undeclaredDependencies);
    expect(undeclared).toEqual([]);
  });

  it('declares each module after everything it depends on', () => {
    const outOfOrder = modules.filter(dependsOnLaterModule);
    expect(outOfOrder).toEqual([]);
  });

  it('lets no two modules claim the same table', () => {
    const tables = modules.flatMap((declared) => [...declared.tables]);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('declares every registered page type once: knowledge, entry, profile and policy under core, the cascade and charters under strategy, the rest, decisions among them, under agents', () => {
    const core = modules.find((declared) => declared.key === 'core');
    const agents = modules.find((declared) => declared.key === 'agents');
    const strategy = modules.find((declared) => declared.key === 'strategy');
    expect(core?.page_types).toEqual(['knowledge', 'entry', 'profile', 'policy']);
    expect(strategy?.page_types).toEqual(['portfolio', 'program', 'project', 'okr', 'charter']);
    expect([
      ...(agents?.page_types ?? []),
      ...(core?.page_types ?? []),
      ...(strategy?.page_types ?? []),
    ]).toEqual(Object.keys(pageTypeRegistry));
  });

  it('declares the registered verbs under agents', () => {
    const agents = modules.find((declared) => declared.key === 'agents');
    expect(agents?.mcp_tools).toEqual(verbRegistry.map((entry) => entry.name));
  });

  it('refuses a module outside the §14 shape', () => {
    expect(moduleSchema.safeParse({ key: 'core', name: 'Core' }).success).toBe(false);
  });
});

describe('#198 the pdf export routes', () => {
  it('#198 declares the pdf export routes and the export screen under core', () => {
    const core = modules.find((declared) => declared.key === 'core');
    expect(core?.routes).toEqual(
      expect.arrayContaining([
        '/api/exports',
        '/api/exports/:exportId',
        '/api/exports/:exportId/file',
        '/exports/:exportId',
      ]),
    );
  });
});
