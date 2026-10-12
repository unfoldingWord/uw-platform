import { databaseErrorFacts } from '@uw/db/errors';
import type { Scenario, ScenarioReport } from '../scenario.ts';
import { readWorldLog } from './log.ts';
import type { World } from '../world.ts';

export type LoadedScenario = { readonly name: string; readonly scenario: Scenario };

export type ScenarioResult = {
  readonly name: string;
  readonly title: string;
  readonly report: ScenarioReport | null;
  readonly failure: string | null;
};

export function selectScenarios(
  all: readonly LoadedScenario[],
  selector: string,
): LoadedScenario[] {
  if (selector === 'all') return [...all];
  return all.filter((loaded) => loaded.name === selector || loaded.scenario.id === selector);
}

function failureOf(error: unknown): string {
  const facts = databaseErrorFacts(error);
  if (facts === null) return error instanceof Error ? error.message : String(error);
  const details = [
    facts.code === null ? null : `SQLSTATE ${facts.code}`,
    facts.constraint === null ? null : `constraint ${facts.constraint}`,
  ].filter((detail) => detail !== null);
  return details.length === 0 ? facts.name : `${facts.name} (${details.join(', ')})`;
}

const scenarioTimeout = 30_000;

async function withinTime<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the scenario did not finish within ${milliseconds} ms`)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function runAndRead(scenario: Scenario, world: World): Promise<ScenarioReport> {
  const outcome = await scenario.run(world);
  const log = await readWorldLog(world.adapters.store);
  const [firstDrift] = log.drift;
  if (firstDrift !== undefined) throw new Error(`projection drift: ${firstDrift}`);
  return { events: log.events, state: outcome.state };
}

export async function runScenario(
  loaded: LoadedScenario,
  openWorld: () => Promise<World>,
  milliseconds: number = scenarioTimeout,
): Promise<ScenarioResult> {
  const { name, scenario } = loaded;
  const world = await openWorld();
  try {
    const report = await withinTime(runAndRead(scenario, world), milliseconds);
    return { name, title: scenario.title, report, failure: null };
  } catch (error) {
    return { name, title: scenario.title, report: null, failure: failureOf(error) };
  } finally {
    await world.close();
  }
}
