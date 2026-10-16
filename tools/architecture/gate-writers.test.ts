import { describe, expect, it } from 'vitest';
import { agentReachable, gateTouches, repoSources, type SourceFiles } from './agent-boundary.ts';
import { agentKernelClosure, gateWriteSites, gateWriteViolations } from './gate-writers.ts';

const real = repoSources();
const delegatedShip = 'packages/harness/gates/delegated-ship.ts';
const cronRoot = 'apps/uw-app/cron/delegated-exits.ts';
const sneakVerb = 'apps/uw-app/mcp/verbs/merge-sneak.ts';

function withPlanted(planted: Readonly<Record<string, string>>): SourceFiles {
  const texts = new Map(Object.entries(planted));
  const added = [...texts.keys()].filter((file) => !real.files.includes(file));
  return { files: [...real.files, ...added], read: (file) => texts.get(file) ?? real.read(file) };
}

function violationsWith(planted: Readonly<Record<string, string>>): string[] {
  return gateWriteViolations(withPlanted(planted));
}

function touchedWith(planted: Readonly<Record<string, string>>): string[] {
  const sources = withPlanted(planted);
  return gateTouches(sources, agentReachable(sources));
}

const writer = (name: string, body: string) =>
  `export async function ${name}(tx: Tx, row: Row): Promise<void> {\n  ${body}\n}\n`;

describe('MD-5 exactly two named functions write a gate decision, and agent verbs reach only the delegated one', () => {
  it('MD-5 finds the gate command and the delegated Ship exit and nothing else on the tree', () => {
    expect(gateWriteSites(real)).toEqual([
      { file: 'packages/harness/gates/decide.ts', fn: 'recordDecision' },
      { file: delegatedShip, fn: 'recordDelegatedDecision' },
    ]);
    expect(gateWriteViolations(real)).toEqual([]);
  });

  it('MD-5 the closure of the item, run and read commands holds the delegated exit and never the person writer', () => {
    const closure = agentKernelClosure(real);
    expect(closure).toContain(delegatedShip);
    expect(closure).toContain('packages/harness/items/submit.ts');
    expect(closure).not.toContain('packages/harness/gates/decide.ts');
    expect(closure).not.toContain('packages/harness/gates/commands.ts');
  });

  it('MD-5 the minute job may call exactly kernel.gates.exitDelegated, from exactly its own file', () => {
    expect(touchedWith({})).toEqual([]);
  });
});

describe('MD-5 a planted second delegated writer fails', () => {
  it('MD-5 flags a second delegated writer an agent verb reaches', () => {
    const planted = {
      'packages/harness/items/fast-ship.ts': writer(
        'fastShip',
        'await tx.gateDecisions.write.insert({ ...row, delegationId: row.id });',
      ),
    };
    expect(violationsWith(planted)).toEqual([
      'packages/harness/items/fast-ship.ts writes gate_decisions in fastShip',
      'an agent verb reaches the gate_decisions write in packages/harness/items/fast-ship.ts#fastShip',
    ]);
  });

  it("MD-5 flags a second function writing in the delegated exit's own file", () => {
    const planted = {
      [delegatedShip]: `${real.read(delegatedShip)}\n${writer('shipAgain', 'await tx.gateDecisions.write.insert(row);')}`,
    };
    expect(violationsWith(planted)).toContain(
      `${delegatedShip} writes gate_decisions in shipAgain`,
    );
  });
});

describe('MD-5 a planted write in any form fails', () => {
  it.each([
    ['aliased', 'const decisions = tx.gateDecisions;\n  await decisions.write.insert(row);'],
    ['bracketed', "await tx.gateDecisions['write'].insert(row);"],
    ['destructured', 'const { write } = tx.gateDecisions;\n  await write.insert(row);'],
    ['raw', 'await sql`INSERT INTO gate_decisions VALUES (${row.id})`;'],
  ])('MD-5 flags a %s write anywhere in the kernel', (_form, body) => {
    const planted = { 'packages/harness/stages/stray.ts': writer('stray', body) };
    expect(violationsWith(planted)).toContain(
      'packages/harness/stages/stray.ts writes gate_decisions in stray',
    );
  });
});

describe('MD-5 a planted reach into the person writer or the exit call fails', () => {
  it('MD-5 flags an item command importing the person writer', () => {
    const planted = {
      'packages/harness/items/shortcut.ts':
        "import { decide } from '../gates/decide.ts';\nexport const shortcut = decide;\n",
    };
    expect(violationsWith(planted)).toContain(
      'an agent verb reaches packages/harness/gates/decide.ts',
    );
  });

  it("MD-5 flags the exit call anywhere but the minute job's file, and any other gate call in that file", () => {
    const call = 'await kernel.gates.exitDelegated(caller, { limit: 50 });';
    const elsewhere = 'apps/uw-app/cron/other-exits.ts';
    expect(touchedWith({ [sneakVerb]: call })).toEqual([sneakVerb]);
    expect(
      touchedWith({ [sneakVerb]: "import '../../cron/other-exits.ts';", [elsewhere]: call }),
    ).toEqual([elsewhere]);
    const widened = `${call}\nawait kernel.gates.decide(caller, input);`;
    expect(
      touchedWith({ [sneakVerb]: "import '../../cron/delegated-exits.ts';", [cronRoot]: widened }),
    ).toEqual([cronRoot]);
    expect(
      touchedWith({ [sneakVerb]: "import '../../cron/delegated-exits.ts';", [cronRoot]: call }),
    ).toEqual([]);
  });
});
