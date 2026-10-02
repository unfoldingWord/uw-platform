import { afterAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedGrant } from '@uw/db/test-seed';
import type { Scenario, ScenarioReport } from '../scenario.ts';
import { grantOutsideItsArea } from '../scenarios/DX-2.store-is-embedded-postgres.ts';
import { createWorld, type World } from '../world.ts';
import { runScenario, selectScenarios, type LoadedScenario } from './run.ts';

afterAll(closeEmbeddedTemplate);

const worldTimeout = 60_000;
const emptyReport: ScenarioReport = { events: [], state: { done: true } };

function loaded(name: string, run: Scenario['run']): LoadedScenario {
  return { name, scenario: { id: name.split('.')[0] ?? name, title: `the ${name} fixture`, run } };
}

const all = [
  loaded('ZZ-1.one', async () => emptyReport),
  loaded('ZZ-1.two', async () => emptyReport),
  loaded('ZZ-2.three', async () => emptyReport),
];

function recordingWorld(): { readonly open: () => Promise<World>; closed(): boolean } {
  let closed = false;
  const open = async (): Promise<World> => {
    const world = await createWorld();
    return {
      ...world,
      close: async () => {
        closed = true;
        await world.close();
      },
    };
  };
  return { open, closed: () => closed };
}

async function refuseAreaGrant(world: World): Promise<ScenarioReport> {
  await seedGrant(world.database.db, grantOutsideItsArea(world.adapters.clock.now()));
  return emptyReport;
}

describe('DX-4 selecting scenarios', () => {
  it('selects all, by requirement ID, by full name, or none', () => {
    const names = (selector: string) => selectScenarios(all, selector).map((each) => each.name);
    expect(names('all')).toEqual(['ZZ-1.one', 'ZZ-1.two', 'ZZ-2.three']);
    expect(names('ZZ-1')).toEqual(['ZZ-1.one', 'ZZ-1.two']);
    expect(names('ZZ-1.one')).toEqual(['ZZ-1.one']);
    expect(names('ZZ-7')).toEqual([]);
  });
});

describe('DX-4 running a scenario', () => {
  it(
    'returns the report and no failure when the scenario resolves',
    async () => {
      const result = await runScenario(all[0]!, () => createWorld());
      expect(result).toEqual({
        name: 'ZZ-1.one',
        title: 'the ZZ-1.one fixture',
        report: emptyReport,
        failure: null,
      });
    },
    worldTimeout,
  );

  it(
    'resolves with the failure and closes the world when the scenario throws',
    async () => {
      const world = recordingWorld();
      const boom = loaded('ZZ-3.boom', async () => {
        throw new Error('boom');
      });
      const result = await runScenario(boom, world.open);
      expect(result).toMatchObject({ report: null, failure: 'boom' });
      expect(world.closed()).toBe(true);
    },
    worldTimeout,
  );

  it(
    'reports a database refusal by error name, SQLSTATE and constraint, never the database text',
    async () => {
      const result = await runScenario(loaded('ZZ-4.refused', refuseAreaGrant), () =>
        createWorld(),
      );
      expect(result.report).toBeNull();
      expect(result.failure).toBe(
        'error (SQLSTATE 23514, constraint role_grants_area_matches_scope)',
      );
    },
    worldTimeout,
  );
});
