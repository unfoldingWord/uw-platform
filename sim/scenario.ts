import type { HarnessEvent } from '@uw/contracts';
import type { World } from './world.ts';

export type ScenarioReport = {
  readonly events: readonly HarnessEvent[];
  readonly state: Readonly<Record<string, unknown>>;
};

export type Scenario = {
  readonly id: string;
  readonly title: string;
  run(world: World): Promise<ScenarioReport>;
};

export function defineScenario(scenario: Scenario): Scenario {
  return scenario;
}
