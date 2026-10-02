import {
  isForbiddenVerbName,
  verbRegistry,
  type JdArea,
  type Principal,
  type VerbDefinition,
} from '@uw/contracts';
import { actionForVerbRole, can } from '@uw/core/acl';

export type ToolCheckFailure = {
  readonly verb: string;
  readonly reason: 'forbidden_verb' | 'unknown_verb' | 'not_permitted';
  readonly message: string;
};

type ToolCheckInput = {
  readonly personaSlug: string;
  readonly verbs: readonly string[];
  readonly activator: Principal;
  readonly area: JdArea;
  readonly at: Date;
};

function reaches(input: ToolCheckInput, definition: VerbDefinition): boolean {
  const { grant } = definition;
  if (grant === null) return true;
  const area = grant.scope === 'fixed_area' ? grant.area : input.area;
  return can(input.activator, actionForVerbRole(grant.role), { kind: 'area', area }, input.at);
}

export function toolCheck(
  input: ToolCheckInput,
  registry: readonly VerbDefinition[] = verbRegistry,
): ToolCheckFailure | null {
  const slug = input.personaSlug;
  const forbidden = input.verbs.find(isForbiddenVerbName);
  if (forbidden !== undefined) {
    const message = `persona ${slug} names ${forbidden}, which no agent may hold`;
    return { verb: forbidden, reason: 'forbidden_verb', message };
  }
  const served = new Map<string, VerbDefinition>(
    registry.filter((entry) => entry.servedInV1).map((entry) => [entry.name, entry]),
  );
  const unknown = input.verbs.find((verb) => !served.has(verb));
  if (unknown !== undefined) {
    const message = `persona ${slug} requires verb ${unknown}, which does not exist`;
    return { verb: unknown, reason: 'unknown_verb', message };
  }
  const unreached = input.verbs.find((verb) => {
    const definition = served.get(verb);
    return definition !== undefined && !reaches(input, definition);
  });
  if (unreached === undefined) return null;
  const message = `persona ${slug} requires verb ${unreached}, which the activating person's grants do not reach`;
  return { verb: unreached, reason: 'not_permitted', message };
}
