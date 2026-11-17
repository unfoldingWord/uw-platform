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

const SHOWN_VERB_MAX = 64;

function shown(verb: string): string {
  return verb.slice(0, SHOWN_VERB_MAX);
}

type Reach = Pick<ToolCheckInput, 'activator' | 'area' | 'at'>;

export function reaches(input: Reach, definition: VerbDefinition): boolean {
  const { grant } = definition;
  if (grant === null) return true;
  const area = grant.scope === 'fixed_area' ? grant.area : input.area;
  return can(input.activator, actionForVerbRole(grant.role), { kind: 'area', area }, input.at);
}

type Named = Pick<ToolCheckInput, 'personaSlug' | 'verbs'>;
type Served = ReadonlyMap<string, VerbDefinition>;

export function servedVerbs(registry: readonly VerbDefinition[] = verbRegistry): Served {
  return new Map(registry.filter((entry) => entry.servedInV1).map((entry) => [entry.name, entry]));
}

export function forbiddenFinding(input: Named): ToolCheckFailure | null {
  const found = input.verbs.find(isForbiddenVerbName);
  if (found === undefined) return null;
  const verb = shown(found);
  const message = `persona ${input.personaSlug} names ${verb}, which no agent may hold`;
  return { verb, reason: 'forbidden_verb', message };
}

export function unknownFinding(input: Named, served: Served): ToolCheckFailure | null {
  const missing = input.verbs.find((verb) => !isForbiddenVerbName(verb) && !served.has(verb));
  if (missing === undefined) return null;
  const verb = shown(missing);
  const message = `persona ${input.personaSlug} requires verb ${verb}, which does not exist`;
  return { verb, reason: 'unknown_verb', message };
}

export function unreachedFinding(input: ToolCheckInput, served: Served): ToolCheckFailure | null {
  const unreached = input.verbs.find((verb) => {
    const definition = served.get(verb);
    return definition !== undefined && !reaches(input, definition);
  });
  if (unreached === undefined) return null;
  const verb = shown(unreached);
  const message = `persona ${input.personaSlug} requires verb ${verb}, which the activating person's grants do not reach`;
  return { verb, reason: 'not_permitted', message };
}

export function toolCheck(
  input: ToolCheckInput,
  registry: readonly VerbDefinition[] = verbRegistry,
): ToolCheckFailure | null {
  const served = servedVerbs(registry);
  return (
    forbiddenFinding(input) ?? unknownFinding(input, served) ?? unreachedFinding(input, served)
  );
}
