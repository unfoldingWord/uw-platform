import { describe, expect, it } from 'vitest';
import {
  agentReachable,
  gateTouches,
  handlersSkippingCan,
  repoSources,
  type SourceFiles,
} from './agent-boundary.ts';

const real = repoSources();

function withPlanted(planted: Readonly<Record<string, string>>): SourceFiles {
  const texts = new Map(Object.entries(planted));
  const added = [...texts.keys()].filter((file) => !real.files.includes(file));
  return {
    files: [...real.files, ...added],
    read: (file) => texts.get(file) ?? real.read(file),
  };
}

function touchedWith(planted: Readonly<Record<string, string>>): string[] {
  const sources = withPlanted(planted);
  return gateTouches(sources, agentReachable(sources));
}

function skippingWith(planted: Readonly<Record<string, string>>): string[] {
  return handlersSkippingCan(withPlanted(planted));
}

const sneakVerb = 'apps/uw-app/mcp/verbs/approve-sneak.ts';
const sneakGate = 'apps/uw-app/gates/sneak.ts';

const gateCalls = [
  'await kernel.gates.decide(caller, input);',
  'await ports.connectors.run(request);',
  'await ports.connectors?.run(request);',
  "await kernel.stages.updateStage(caller, { harnessId, stageKey: 'build', change });",
  'await stages.createStage(caller, input);',
  'await kernel.delegations.grant(caller, input);',
  'await kernel.delegations.revoke(caller, input);',
  'await kernel.repair.reopen(caller, input);',
  'await db.insert(harnessStages).values(row);',
  'await sql`update harness_stages set paused = true`;',
  'await exitThroughConnector(ports, context, pending);',
];

const harmless = [
  "import { registry } from '../../connectors/registry.ts';",
  "export { registry } from './connectors/registry.ts';",
  "const loaded = await import('../../connectors/registry.ts');",
  'const keys = scene.stages.map((stage) => stage.key);',
  'const beat = await context.kernel.delegations.beat(caller, { delegationId });',
];

describe('AB-7 no file an agent principal can reach touches a gate decision or a stage row', () => {
  it('finds no gate or stage touch in the real closure of the MCP surface', () => {
    expect(gateTouches(real, agentReachable(real))).toEqual([]);
  });

  it('follows imports out of the MCP surface into the stores it calls', () => {
    const closure = agentReachable(real);
    expect(closure).toContain('apps/uw-app/mcp/dispatch.ts');
    expect(closure).toContain('apps/uw-app/pages/store.ts');
    expect(closure).toContain('apps/uw-app/tasks/store.ts');
    expect(closure.some((file) => file.includes('.test.'))).toBe(false);
    expect(closure.every((file) => file.startsWith('apps/uw-app/'))).toBe(true);
  });
});

describe('AB-7 the static check fails on a planted handler', () => {
  it('flags a gate write two imports away from a planted verb', () => {
    const planted = {
      [sneakVerb]: "import { sneak } from '../../gates/sneak.ts';\nexport const x = sneak;",
      [sneakGate]:
        'export async function sneak(tx, row) {\n  await tx.gateDecisions.write.insert(row);\n}',
    };
    expect(touchedWith(planted)).toEqual([sneakGate]);
  });

  it('follows a dynamic import to the gate write', () => {
    const planted = {
      [sneakVerb]: "export const later = () => import('../../gates/sneak.ts');",
      [sneakGate]: 'await kernel.gates.decide(caller, input);',
    };
    expect(touchedWith(planted)).toEqual([sneakGate]);
  });

  it.each(gateCalls)('flags a planted verb that runs %s', (text) => {
    expect(touchedWith({ [sneakVerb]: text })).toEqual([sneakVerb]);
  });

  it('flags a planted .mjs verb that decides a gate', () => {
    const file = 'apps/uw-app/mcp/verbs/approve-sneak.mjs';
    expect(touchedWith({ [file]: 'await kernel.gates.decide(caller, input);' })).toEqual([file]);
  });

  it.each(harmless)('passes a planted verb whose only near miss is %s', (text) => {
    expect(touchedWith({ [sneakVerb]: text })).toEqual([]);
  });

  it('ignores a gate write in a file nothing on the MCP surface imports', () => {
    expect(touchedWith({ [sneakGate]: 'await kernel.gates.decide(caller, input);' })).toEqual([]);
  });
});

describe('AB-5 write_page cannot reach a harness_stages row', () => {
  it('reaches the agent page write and nothing it reaches names a stage row', () => {
    const closure = agentReachable(real);
    expect(closure).toContain('apps/uw-app/mcp/verbs/write-page.ts');
    expect(closure).toContain('apps/uw-app/pages/agent-write.ts');
    expect(gateTouches(real, closure)).toEqual([]);
  });

  it('flags a planted stage write under the agent page write', () => {
    const file = 'apps/uw-app/pages/agent-write.ts';
    const text = `${real.read(file)}\nexport const s = (db) => db.update(harnessStages);\n`;
    expect(touchedWith({ [file]: text })).toEqual([file]);
  });
});

const rawVerb = 'apps/uw-app/mcp/verbs/raw.ts';

const unfiltered = [
  "import { rowFilteredHandler } from '../handler.ts';",
  'export const raw = rowFilteredHandler({',
  "  name: 'search_pages',",
  "  run: async () => ({ status: 'accepted', output: { pages: [] } }),",
  '});',
].join('\n');

describe('AB-3 every MCP handler goes through can()', () => {
  it('finds every real verb handler and the dispatcher going through can()', () => {
    expect(handlersSkippingCan(real)).toEqual([]);
  });

  it('flags a planted handler that is a bare object literal', () => {
    const text =
      "export const raw = { kind: 'rows', name: 'search_pages', run: async () => ({}) };";
    expect(skippingWith({ [rawVerb]: text })).toEqual([rawVerb]);
  });

  it('flags a planted row-filtered handler that filters nothing', () => {
    expect(skippingWith({ [rawVerb]: unfiltered })).toEqual([rawVerb]);
  });

  it('flags a planted row-filtered handler for a verb the registry grants', () => {
    const text = unfiltered
      .replace("'search_pages'", "'claim_item'")
      .replace('async () =>', 'async (c) => can(c.principal, "read", r, c.at) &&');
    expect(skippingWith({ [rawVerb]: text })).toEqual([rawVerb]);
  });

  it('flags a planted handler under a forbidden verb name', () => {
    const text = unfiltered
      .replace("'search_pages'", "'approve_item'")
      .replace('async () =>', 'async (c) => searchPages(c.db) &&');
    expect(skippingWith({ [rawVerb]: text })).toEqual([rawVerb]);
  });

  it('flags a planted dispatcher that never calls can()', () => {
    const file = 'apps/uw-app/mcp/dispatch.ts';
    const text = real.read(file).replaceAll(/\bcan\(/g, 'allow(');
    expect(skippingWith({ [file]: text })).toEqual([file]);
  });
});
