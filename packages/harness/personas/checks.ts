import {
  personaSlugOf,
  verbRegistry,
  type JdArea,
  type Principal,
  type VerbDefinition,
} from '@uw/contracts';
import { engineDescriptor } from '../engines.ts';
import { dryRun } from './dry-run.ts';
import {
  forbiddenFinding,
  servedVerbs,
  unknownFinding,
  unreachedFinding,
  type ToolCheckFailure,
} from './tool-check.ts';
import type { PersonaFrontmatter } from './types.ts';

export type ActivationCheckKey =
  'actions_exist' | 'nothing_forbidden' | 'owner_permitted' | 'engine_available' | 'practice_run';

export type ActivationCheck = {
  readonly key: ActivationCheckKey;
  readonly passed: boolean | null;
  readonly verb: string | null;
  readonly message: string | null;
};

type Named = { readonly personaSlug: string; readonly verbs: readonly string[] };
type Served = ReturnType<typeof servedVerbs>;

export type CheckInput = {
  readonly frontmatter: PersonaFrontmatter;
  readonly body: string;
  readonly activator: Principal | null;
  readonly area: JdArea;
  readonly at: Date;
  readonly registry?: readonly VerbDefinition[];
};

function fromFinding(key: ActivationCheckKey, finding: ToolCheckFailure | null): ActivationCheck {
  if (finding === null) return { key, passed: true, verb: null, message: null };
  return { key, passed: false, verb: finding.verb, message: finding.message };
}

function engineCheck(frontmatter: PersonaFrontmatter): ActivationCheck {
  const key = 'engine_available';
  if (engineDescriptor(frontmatter.engine).availability !== 'reserved') {
    return { key, passed: true, verb: null, message: null };
  }
  return { key, passed: false, verb: null, message: `engine ${frontmatter.engine} is reserved` };
}

async function practiceCheck(input: CheckInput): Promise<ActivationCheck> {
  const { identity } = input.frontmatter;
  const found = await dryRun({ identity, frontmatter: input.frontmatter, body: input.body });
  const key = 'practice_run';
  if (found === null) return { key, passed: true, verb: null, message: null };
  return { key, passed: false, verb: null, message: found.message };
}

function ownerCheck(input: CheckInput, named: Named, served: Served): ActivationCheck {
  const key = 'owner_permitted';
  if (input.activator === null) return { key, passed: null, verb: null, message: null };
  const reach = { ...named, activator: input.activator, area: input.area, at: input.at };
  return fromFinding(key, unreachedFinding(reach, served));
}

export async function activationChecks(input: CheckInput): Promise<readonly ActivationCheck[]> {
  const { frontmatter } = input;
  const named = {
    personaSlug: personaSlugOf(frontmatter.identity) ?? frontmatter.identity,
    verbs: [...new Set([...frontmatter.requires_tools, ...frontmatter.toolset])],
  };
  const served = servedVerbs(input.registry ?? verbRegistry);
  return [
    fromFinding('actions_exist', unknownFinding(named, served)),
    fromFinding('nothing_forbidden', forbiddenFinding(named)),
    ownerCheck(input, named, served),
    engineCheck(frontmatter),
    await practiceCheck(input),
  ];
}
