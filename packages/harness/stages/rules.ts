import type { Harness, Stage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { connectorRegistered, connectorRegistry } from '../connectors/registry.ts';
import { refused, type Refused } from '../outcome.ts';
import { describeViolation, templateProperty } from '../template-property.ts';
import { validatorRegistry } from '../validators/registry.ts';
import type { EffectConnector, Ports, StoreTransaction } from '../ports.ts';
import type { TemplateStage } from '../templates/types.ts';

export function agentRefusal(caller: Caller): Refused | null {
  return isAgent(caller.actor) ? refused('not_permitted', { actor: caller.actor.identity }) : null;
}

export async function adminRefusal(
  ports: Pick<Ports, 'grants'>,
  tx: StoreTransaction,
  caller: Caller,
  harness: Pick<Harness, 'jdArea'>,
  at: Date,
): Promise<Refused | null> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const personId = caller.actor.personId;
  if (personId === null) return refused('not_permitted', { jdArea: harness.jdArea });
  const grants = await ports.grants.lockAndReread(tx, personId, at);
  return allowed({ ...caller.actor, grants: [...grants] }, 'admin', harness, at)
    ? null
    : refused('not_permitted', { jdArea: harness.jdArea });
}

type Registries = {
  readonly keys: ReadonlySet<string>;
  readonly registry: ReadonlySet<EffectConnector>;
};

function problemOf(stage: Stage, { keys, registry }: Registries): Refused | null {
  const validator = stage.validators.find((key) => !validatorRegistry.has(key));
  if (validator !== undefined) {
    return refused('unknown_validator', { stage: stage.key, validator });
  }
  if (!connectorRegistered(stage.connector, registry)) {
    return refused('connector_not_registered', { stage: stage.key, connector: stage.connector });
  }
  const target = stage.feeds.find((feed) => !keys.has(feed));
  return target === undefined ? null : refused('unknown_feed_target', { stage: stage.key, target });
}

export function stageProblems(
  stages: readonly Stage[],
  registry: ReadonlySet<EffectConnector> = connectorRegistry,
): Refused | null {
  const registries = { keys: new Set(stages.map((stage) => stage.key)), registry };
  for (const stage of stages) {
    const problem = problemOf(stage, registries);
    if (problem !== null) return problem;
  }
  return null;
}

export function bypassRefusal(stages: readonly Stage[]): Refused | null {
  const violation = templateProperty(stages)[0];
  if (violation === undefined) return null;
  return refused('template_bypasses_gate', {
    path: violation.path,
    effectStage: violation.effectStage,
    message: describeViolation(violation),
  });
}

export function stageFromTemplate(template: TemplateStage, harnessId: string, id: string): Stage {
  return {
    id,
    harnessId,
    key: template.key,
    title: template.title,
    position: template.position,
    bracket: template.bracket,
    agentPickup: template.agentPickup,
    exitGate: template.exitGate,
    connector: template.connector,
    wipLimit: template.wipLimit,
    instructionsPageId: null,
    validators: [...template.validators],
    feeds: [...template.feeds],
    paused: false,
  };
}
