import { pageTypeRegistry, verbRegistry } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { moduleSchema, modules, type Module } from './modules.ts';

const keys = modules.map((declared) => declared.key);

function moduleOf(key: string): Module {
  const found = modules.find((declared) => declared.key === key);
  if (found === undefined) throw new Error(`no module ${key}`);
  return found;
}

const undeclaredDependencies = (declared: (typeof modules)[number]): string[] =>
  declared.depends_on.filter((dependency) => !keys.includes(dependency));

const dependsOnLaterModule = (declared: (typeof modules)[number], position: number): boolean =>
  declared.depends_on.some((dependency) => keys.indexOf(dependency) >= position);

describe('the module registry', () => {
  it('declares core, agents, strategy and charts', () => {
    expect(keys).toEqual(['core', 'agents', 'strategy', 'charts']);
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
});

describe('the module registry claims every page type and verb once', () => {
  it('declares every registered page type once: knowledge, entry, profile and policy under core, the cascade and charters under strategy, resources, measures and dashboards under charts, the rest, decisions among them, under agents', () => {
    expect(moduleOf('core').page_types).toEqual(['knowledge', 'entry', 'profile', 'policy']);
    expect(moduleOf('strategy').page_types).toEqual([
      'portfolio',
      'program',
      'project',
      'okr',
      'charter',
    ]);
    expect(moduleOf('charts').page_types).toEqual(['resource', 'measure', 'dashboard']);
    expect(
      ['agents', 'core', 'strategy', 'charts'].flatMap((key) => moduleOf(key).page_types),
    ).toEqual(Object.keys(pageTypeRegistry));
  });

  it('declares the measure verbs and render_chart under charts and every other registered verb under agents', () => {
    expect(moduleOf('charts').mcp_tools).toEqual([
      'save_measure',
      'save_dashboard',
      'run_measure',
      'read_measure_run',
      'read_metric',
      'read_observations',
      'preview_dashboard',
      'render_chart',
    ]);
    expect([...moduleOf('agents').mcp_tools, ...moduleOf('charts').mcp_tools]).toEqual(
      verbRegistry.map((entry) => entry.name),
    );
  });

  it('ADR 0036 gives charts the measures tables, none of them offline', () => {
    expect(moduleOf('charts')).toMatchObject({
      tables: ['measure_activations', 'measure_runs', 'observations'],
      depends_on: ['core', 'strategy'],
      offline_eligibility: 'never',
    });
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
