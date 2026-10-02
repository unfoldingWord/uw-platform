import type { Harness, Stage } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { connectorRegistered } from '../connectors/registry.ts';
import { refused, type Refused } from '../outcome.ts';
import { validatorRegistry } from '../validators/registry.ts';
import type { TemplateStage } from '../templates/types.ts';

export function agentRefusal(caller: Caller): Refused | null {
  return caller.actor.kind === 'agent'
    ? refused('not_permitted', { actor: caller.actor.identity })
    : null;
}

export function permissionRefusal(
  caller: Caller,
  harness: Pick<Harness, 'jdArea'>,
  at: Date,
): Refused | null {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  return allowed(caller.actor, 'admin', harness, at)
    ? null
    : refused('not_permitted', { jdArea: harness.jdArea });
}

function problemOf(stage: Stage, keys: ReadonlySet<string>): Refused | null {
  const validator = stage.validators.find((key) => !validatorRegistry.has(key));
  if (validator !== undefined) {
    return refused('unknown_validator', { stage: stage.key, validator });
  }
  if (!connectorRegistered(stage.connector)) {
    return refused('connector_not_registered', { stage: stage.key, connector: stage.connector });
  }
  const target = stage.feeds.find((feed) => !keys.has(feed));
  return target === undefined ? null : refused('unknown_feed_target', { stage: stage.key, target });
}

export function stageProblems(stages: readonly Stage[]): Refused | null {
  const keys = new Set(stages.map((stage) => stage.key));
  for (const stage of stages) {
    const problem = problemOf(stage, keys);
    if (problem !== null) return problem;
  }
  return null;
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
