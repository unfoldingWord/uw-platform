import {
  isForbiddenVerbName,
  verbRegistry,
  type JdArea,
  type Principal,
  type VerbDefinition,
  type VerbName,
} from '@uw/contracts';
import { reaches } from './tool-check.ts';

export function toolsetOptions(
  principal: Principal,
  area: JdArea,
  at: Date,
  registry: readonly VerbDefinition[] = verbRegistry,
): readonly VerbName[] {
  const reach = { activator: principal, area, at };
  return registry
    .filter((verb) => verb.servedInV1 && !isForbiddenVerbName(verb.name) && reaches(reach, verb))
    .map((verb) => verb.name);
}
