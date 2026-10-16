import { describe, expect, it } from 'vitest';
import {
  agentReachable,
  gateTouches,
  handlersSkippingCan,
  importsLeavingApp,
  mcpReachable,
  personSurface,
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
const gateCommands = 'apps/uw-app/commands/person/gates.ts';
const inProcessHost = 'apps/uw-app/mcp/in-process.ts';
const commandApi = 'apps/uw-app/commands/';
const gateGitHubHolders = [
  'apps/uw-app/commands/person/gate-kernel.ts',
  'apps/uw-app/commands/person/gate-github.ts',
  'apps/uw-app/commands/person-deps.ts',
];
const sneakGate = 'apps/uw-app/gates/sneak.ts';

const gateCalls = [
  'await kernel.gates.decide(caller, input);',
  'await ports.connectors.run(request);',
  'await ports.connectors?.run(request);',
  "await kernel.stages.updateStage(caller, { harnessId, stageKey: 'build', change });",
  'await stages.createStage(caller, input);',
  'await stages.removeStage(caller, input);',
  'await stages.pause(caller, input);',
  'await context.stages?.resume(caller, input);',
  'await kernel.delegations.grant(caller, input);',
  'await kernel.delegations.revoke(caller, input);',
  'await kernel.repair.reopen(caller, input);',
  'await db.insert(harnessStages).values(row);',
  'await sql`update harness_stages set paused = true`;',
  'await exitThroughConnector(ports, context, pending);',
  'await tx.delegations.write.insert(row);',
  'const rows = await sql`select * from "gate_decisions"`;',
  'export const read = sql`select * from "gate_decisions"`;',
  'const { gates } = context.kernel;',
  'const { repair: fix } = kernel;',
  'const { hub, connectors } = ports;',
  'const { grant } = context.kernel.delegations;',
  'const { revoke: undo } = kernel?.delegations;',
  "await kernel['gates'].decide(caller, input);",
  'await kernel?.["stages"].activate(caller, input);',
  'await kernel[`repair`].reopen(caller, input);',
  "await ports['connectors'].run(request);",
  "await kernel.delegations['grant'](caller, input);",
  'await tx.delegations?.["write"].insert(row);',
];

const personaActivations = [
  'const { personas } = context.kernel; await personas.activate(caller, input);',
  "await kernel['personas'].activate(caller, input);",
  "await kernel.personas['activate'](caller, input);",
  'const { activate } = kernel.personas; await activate(caller, input);',
  "await kernel['personas']['activate'](caller, input);",
  "await personas['activate'](caller, input);",
  'const p = kernel.personas; await p.activate(caller, input);',
  'const { personas: p } = context?.kernel; await p.activate(caller, input);',
];

const harmless = [
  "import { registry } from '../../connectors/registry.ts';",
  "export { registry } from './connectors/registry.ts';",
  "const loaded = await import('../../connectors/registry.ts');",
  'const keys = scene.stages.map((stage) => stage.key);',
  'const beat = await context.kernel.delegations.beat(caller, { delegationId });',
  'const dashboard = await kernel.views.persona(caller, input);',
  "routes.get('/personas/:pageId', personaScreen);",
];

describe('AB-7 no file an agent principal can reach touches a gate decision or a stage row', () => {
  it('AB-7 gate, stage and delegation-grant touches reachable from app.tsx live only in the person surface', () => {
    const closure = agentReachable(real);
    expect(closure).toContain(gateCommands);
    expect(
      gateTouches(
        real,
        closure.filter((file) => !file.startsWith(personSurface)),
      ),
    ).toEqual([]);
    expect(real.read(gateCommands)).toMatch(/\bkernel\.gates\.decide\(/);
  });

  it('AB-7 nothing the MCP surface reaches imports the command API', () => {
    const closure = mcpReachable(real);
    expect(closure).toContain(inProcessHost);
    expect(closure).toContain('apps/uw-app/mcp/dispatch.ts');
    expect(closure.filter((file) => file.startsWith(commandApi))).toEqual([]);
    for (const holder of gateGitHubHolders) expect(closure).not.toContain(holder);
  });

  it('reaches every route an agent principal can call, through the app entry', () => {
    const closure = agentReachable(real);
    expect(closure).toContain('apps/uw-app/app.tsx');
    expect(closure).toContain('apps/uw-app/acl/routes.ts');
    expect(closure).toContain('apps/uw-app/agents/routes.ts');
    expect(closure).toContain('apps/uw-app/pages/routes.ts');
    expect(closure).toContain('apps/uw-app/mcp/routes.ts');
  });

  it('finds no file in the real closure importing out of the app by a relative path', () => {
    expect(importsLeavingApp(real, agentReachable(real))).toEqual([]);
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

  it.each(['mjs', 'mts', 'cjs', 'cts', 'jsx'])(
    'flags a planted .%s verb that decides a gate',
    (ext) => {
      const file = `apps/uw-app/mcp/verbs/approve-sneak.${ext}`;
      expect(touchedWith({ [file]: 'await kernel.gates.decide(caller, input);' })).toEqual([file]);
    },
  );

  it.each(personaActivations)(
    'flags a planted verb that reaches persona activation as %s',
    (text) => {
      expect(touchedWith({ [sneakVerb]: text })).toEqual([sneakVerb]);
    },
  );

  it.each(harmless)('passes a planted verb whose only near miss is %s', (text) => {
    expect(touchedWith({ [sneakVerb]: text })).toEqual([]);
  });

  it('ignores a gate write in a file nothing on the MCP surface imports', () => {
    expect(touchedWith({ [sneakGate]: 'await kernel.gates.decide(caller, input);' })).toEqual([]);
  });
});

const registryFile = 'apps/uw-app/commands/registry.ts';

function underRegistry(file: string, text: string): Record<string, string> {
  const specifier = `./${file.slice(commandApi.length)}`;
  return { [registryFile]: `import '${specifier}';\n${real.read(registryFile)}`, [file]: text };
}

function reachedFromMcp(planted: Readonly<Record<string, string>>): string[] {
  return mcpReachable(withPlanted(planted)).filter((file) => file.startsWith(commandApi));
}

const carvedOut = [
  'await kernel.gates.decide(caller, input);',
  'await kernel?.gates?.recoverConnectors(caller, input);',
  'await context.kernel.stages.createStage(caller, input);',
  'await kernel.delegations.grant(caller, input);',
  'await kernel.delegations.revoke(caller, input);',
  'await context.kernel.personas.activate(caller, input);',
];

const notCarvedOut = [
  'const decide = kernel.gates.decide;',
  'const { gates } = context.kernel;',
  "await kernel['gates'].decide(caller, input);",
  'await db.insert(gateDecisions).values(row);',
  'await sql`update harness_stages set paused = true`;',
  'await kernel.repair.reopen(caller, input);',
  'await ports.connectors.run(request);',
  'await exitThroughConnector(ports, context, pending);',
  'await tx.delegations.write.insert(row);',
  'await stages.removeStage(caller, input);',
  'const activate = kernel.personas.activate;',
  ...personaActivations,
];

const personSneak = 'apps/uw-app/commands/person/sneak.ts';

describe('AB-7 a planted gate touch outside the person surface fails, and a planted MCP import of the command API fails', () => {
  it('flags a gate decision in a command handler outside the person surface', () => {
    const file = 'apps/uw-app/commands/handlers/sneak.ts';
    expect(touchedWith(underRegistry(file, carvedOut[0] ?? ''))).toEqual([file]);
  });

  it('flags a persona activation in a command handler outside the person surface', () => {
    const file = 'apps/uw-app/commands/handlers/activate.ts';
    const text = 'await kernel.personas.activate(caller, input);';
    expect(touchedWith(underRegistry(file, text))).toEqual([file]);
  });

  it('flags a gate decision in a file that only shares the person surface prefix', () => {
    const file = 'apps/uw-app/commands/person-sneak.ts';
    expect(touchedWith(underRegistry(file, carvedOut[0] ?? ''))).toEqual([file]);
  });

  it.each(carvedOut)('passes a planted person-surface handler that runs %s', (text) => {
    expect(touchedWith(underRegistry(personSneak, text))).toEqual([]);
  });

  it.each(notCarvedOut)('flags a planted person-surface handler that runs %s', (text) => {
    expect(touchedWith(underRegistry(personSneak, text))).toEqual([personSneak]);
  });

  it('flags a planted verb importing the command dispatcher', () => {
    const planted = { [sneakVerb]: "import { executeCommand } from '../../commands/dispatch.ts';" };
    expect(reachedFromMcp(planted)).toContain('apps/uw-app/commands/dispatch.ts');
  });

  it('flags a planted verb importing the person gate commands, which the carve-out would pass', () => {
    const planted = { [sneakVerb]: "import '../../commands/person/gates.ts';" };
    expect(reachedFromMcp(planted)).toContain(gateCommands);
    expect(touchedWith(planted)).toEqual([]);
  });

  it('follows three hops from a planted verb to the person deps', () => {
    const planted = {
      [sneakVerb]: "import { hop } from '../../pages/hop.ts';\nexport const x = hop;",
      'apps/uw-app/pages/hop.ts': "export { hop } from '../http/hop.ts';",
      'apps/uw-app/http/hop.ts':
        "import { platformPersonDeps } from '../commands/person-deps.ts';\nexport const hop = platformPersonDeps;",
    };
    expect(reachedFromMcp(planted)).toContain('apps/uw-app/commands/person-deps.ts');
  });

  it('follows the in-process host through a dynamic import to the gate kernel', () => {
    const planted = {
      [inProcessHost]: `import { later } from '../agents/hop.ts';\n${real.read(inProcessHost)}`,
      'apps/uw-app/agents/hop.ts':
        "export const later = () => import('../commands/person/gate-kernel.ts');",
    };
    const reached = reachedFromMcp(planted);
    expect(reached).toContain('apps/uw-app/commands/person/gate-kernel.ts');
    expect(reached).not.toContain('apps/uw-app/commands/person-deps.ts');
  });
});

describe('persona activation is reached only from the person surface, in every syntactic form', () => {
  it.each(personaActivations)(
    'flags a command handler outside the person surface that reaches it as %s',
    (text) => {
      const file = 'apps/uw-app/commands/handlers/activate.ts';
      expect(touchedWith(underRegistry(file, text))).toEqual([file]);
    },
  );
});

describe('AB-7 the static check fails on a planted route or a way out of the app', () => {
  it('flags a gate call in an /api route an agent service token reaches', () => {
    const file = 'apps/uw-app/acl/routes.ts';
    const text = `${real.read(file)}\nexport const s = (kernel) => kernel.gates.decide;\n`;
    expect(touchedWith({ [file]: text })).toEqual([file]);
  });

  it('follows a planted .cts helper a route imports', () => {
    const helper = 'apps/uw-app/acl/sneak.cts';
    const route = 'apps/uw-app/acl/routes.ts';
    const planted = {
      [route]: `import { sneak } from './sneak.cts';\n${real.read(route)}`,
      [helper]: 'export const sneak = (kernel) => kernel.repair.reopen;',
    };
    expect(touchedWith(planted)).toEqual([helper]);
  });

  it('flags a planted verb importing kernel internals by a relative path', () => {
    const text = "import { decide } from '../../../../packages/harness/gates/decide.ts';";
    const sources = withPlanted({ [sneakVerb]: text });
    expect(importsLeavingApp(sources, agentReachable(sources))).toEqual([sneakVerb]);
  });

  it('passes a planted verb importing a package by name', () => {
    const sources = withPlanted({ [sneakVerb]: "import { can } from '@uw/core/acl';" });
    expect(importsLeavingApp(sources, agentReachable(sources))).toEqual([]);
  });
});

describe('AB-7 the pull-request follow may record a shadow verdict and nothing else at a gate', () => {
  it('passes the shadow verdict call in the follow and flags a gate decision planted beside it', () => {
    const file = 'apps/uw-app/github/join.ts';
    expect(gateTouches(real, agentReachable(real))).toEqual([]);
    const text = `${real.read(file)}\nexport const s = (kernel) => kernel.gates.decide;\n`;
    expect(touchedWith({ [file]: text })).toEqual([file]);
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
  '  rows: async () => [],',
  "  reply: () => ({ status: 'accepted', output: { pages: [] } }),",
  '});',
].join('\n');

const withResources = (resources: string): string =>
  unfiltered.replace('  reply:', `  resources: ${resources},\n  reply:`);

const filtered = withResources("async () => (page) => ({ kind: 'area', area: page.jdArea })");

const blockFiltered = withResources(
  'async (context, _input, pages) => {\n    const seen = pages.length;\n    return (page) => (seen > 0 ? null : page.area);\n  }',
);

const rowless = [
  'async () => () => null',
  "async () => () => ({ kind: 'org' })",
  "async () => (_page) => ({ kind: 'org' })",
  "async () => _ => ({ kind: 'org' })",
  "async () => {\n    return () => ({ kind: 'org' });\n  }",
  "async () => {\n    return function () {\n      return { kind: 'org' };\n    };\n  }",
  'async () => everything',
];

const shorthand = [
  "const kind = 'rows' as const;",
  "const name = 'search_pages' as const;",
  "const run = async () => ({ status: 'accepted', output: { pages: [] } });",
  'export const hidden = { kind, name, run };',
].join('\n');

describe('AB-3 every MCP handler goes through can()', () => {
  it('finds every real verb handler, the builders and the dispatcher going through can()', () => {
    expect(handlersSkippingCan(real)).toEqual([]);
  });

  it('passes a planted row-filtered handler that names its resources', () => {
    expect(skippingWith({ [rawVerb]: filtered })).toEqual([]);
  });

  it('passes a planted row-filtered handler whose block-bodied resources return a row mapper', () => {
    expect(skippingWith({ [rawVerb]: blockFiltered })).toEqual([]);
  });

  it.each(rowless)('flags a planted resources mapper that takes no row: %s', (resources) => {
    expect(skippingWith({ [rawVerb]: withResources(resources) })).toEqual([rawVerb]);
  });

  it.each(['let seen = 0;', 'export let seen = 0;', 'var seen = 0;'])(
    'flags a planted row-filtered handler file with a module-level %s',
    (line) => {
      expect(skippingWith({ [rawVerb]: `${line}\n${filtered}` })).toEqual([rawVerb]);
    },
  );

  it('flags a planted file whose second row-filtered handler maps no row', () => {
    const second = withResources('async () => () => null').replace(
      'export const raw',
      'export const raw2',
    );
    expect(skippingWith({ [rawVerb]: `${filtered}\n${second}` })).toEqual([rawVerb]);
  });

  it('passes a planted row-filtered handler file whose only let is inside a function', () => {
    const text = `${filtered}\nexport function count() {\n  let seen = 0;\n  seen += 1;\n  return seen;\n}`;
    expect(skippingWith({ [rawVerb]: text })).toEqual([]);
  });

  it('flags a planted row-filtered handler that filters nothing', () => {
    expect(skippingWith({ [rawVerb]: unfiltered })).toEqual([rawVerb]);
  });

  it('flags a planted row-filtered handler for a verb the registry grants', () => {
    const text = filtered.replace("'search_pages'", "'claim_item'");
    expect(skippingWith({ [rawVerb]: text })).toEqual([rawVerb]);
  });

  it('flags a planted handler under a forbidden verb name', () => {
    const text = filtered.replace("'search_pages'", "'approve_item'");
    expect(skippingWith({ [rawVerb]: text })).toEqual([rawVerb]);
  });

  it.each(['dispatch', 'handler'])('flags a planted %s.ts that never calls can()', (name) => {
    const file = `apps/uw-app/mcp/${name}.ts`;
    const text = real.read(file).replaceAll(/\bcan\(/g, 'allow(');
    expect(skippingWith({ [file]: text })).toEqual([file]);
  });
});

describe('AB-3 a hand-built handler fails the static check', () => {
  it('flags a planted handler that is a bare object literal', () => {
    const text =
      "export const raw = { kind: 'rows', name: 'search_pages', run: async () => ({}) };";
    expect(skippingWith({ [rawVerb]: text })).toEqual([rawVerb]);
  });

  it('flags a shorthand literal re-exported through a real verb', () => {
    const file = 'apps/uw-app/mcp/verbs/search-pages.ts';
    const hidden = 'apps/uw-app/mcp/verbs/hidden.ts';
    const planted = {
      [hidden]: shorthand,
      [file]: `${real.read(file)}\nexport { hidden } from './hidden.ts';\n`,
    };
    expect(skippingWith(planted)).toEqual([hidden]);
  });

  it('flags a literal handler written inside the verb index', () => {
    const file = 'apps/uw-app/mcp/verbs/index.ts';
    const planted = { [file]: `${real.read(file)}\n${shorthand}\n` };
    expect(skippingWith(planted)).toEqual([file]);
  });
});
