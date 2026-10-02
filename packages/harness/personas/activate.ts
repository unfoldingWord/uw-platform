import {
  jdAreaSchema,
  personaFrontmatterSchema,
  personaSlugOf,
  type Harness,
  type JdArea,
  type Principal,
  type VerbDefinition,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { lockKeys } from '../lock-keys.ts';
import {
  createItem,
  draft,
  recordContext,
  recordHarnessEvents,
  type NewItem,
} from '../items/record.ts';
import { refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { PageFacts, Ports, StoreTransaction } from '../ports.ts';
import { toolCheck, type ToolCheckFailure } from './tool-check.ts';

type PersonaPorts = Pick<Ports, 'grants' | 'ids'>;

type Frontmatter = ReturnType<typeof personaFrontmatterSchema.parse>;

type Persona = {
  readonly page: PageFacts;
  readonly frontmatter: Frontmatter;
  readonly harness: Harness;
};

type Opening = { readonly itemId: string; readonly create: NewItem | null };

type Activation = {
  readonly caller: Caller;
  readonly pageId: string;
  readonly at: Date;
  readonly registry: readonly VerbDefinition[];
};

const SOFTWARE_HARNESS_KEY = 'software';

type Readable = {
  readonly page: PageFacts;
  readonly area: JdArea;
  readonly activator: Principal;
};

async function readablePage(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
): Promise<Readable | Refused> {
  const { caller, at, pageId } = activation;
  const personId = caller.actor.personId;
  if (personId === null) return refused('not_permitted', { actor: caller.actor.identity });
  const [page] = await tx.pages.read.facts([pageId]);
  const grants = await ports.grants.lockAndReread(tx, personId, at);
  const activator = { ...caller.actor, grants: [...grants] };
  const area = jdAreaSchema.safeParse(page?.jdArea);
  const visible =
    page !== undefined &&
    page.type === 'persona' &&
    area.success &&
    allowed(activator, 'read', { jdArea: area.data }, at);
  if (!visible || !area.success) return refused('page_not_found', { pageId });
  return { page, area: area.data, activator };
}

async function personaOf(tx: StoreTransaction, page: PageFacts): Promise<Persona | Refused> {
  const parsed = personaFrontmatterSchema.safeParse(page.frontmatter);
  if (!parsed.success) return refused('invalid_frontmatter', { pageId: page.id });
  const harness = await tx.harnesses.read.byId(parsed.data.harness);
  if (harness === null) return refused('harness_not_found', { harnessId: parsed.data.harness });
  return { page, frontmatter: parsed.data, harness };
}

function authorised(readable: Readable, harness: Harness, at: Date): Refused | null {
  const { activator, area } = readable;
  if (!allowed(activator, 'admin', harness, at)) {
    return refused('not_permitted', { jdArea: harness.jdArea });
  }
  if (!allowed(activator, 'write', { jdArea: area }, at)) {
    return refused('not_permitted', { jdArea: area });
  }
  return null;
}

function lowestStageKey(stages: readonly { key: string; position: number }[]): string | null {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  return sorted[0]?.key ?? null;
}

async function openingFor(
  ports: PersonaPorts,
  tx: StoreTransaction,
  pageId: string,
  title: string,
): Promise<Opening | null> {
  const software = await tx.harnesses.read.byKey(SOFTWARE_HARNESS_KEY);
  if (software === null) return null;
  const items = await tx.harnessItems.read.forHarness(software.id);
  const open = items.find(
    (item) => item.pageId === pageId && item.title === title && item.gateStatus !== 'done',
  );
  if (open !== undefined) return { itemId: open.itemId, create: null };
  const stageKey = lowestStageKey(await tx.harnessStages.read.forHarness(software.id));
  if (stageKey === null) return null;
  const itemId = ports.ids.next();
  const create = {
    itemId,
    harnessId: software.id,
    stageKey,
    title,
    pageId,
    priority: 0,
    due: null,
  };
  return { itemId, create };
}

async function recordFailure(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
  persona: Persona,
  failure: ToolCheckFailure,
): Promise<Refused> {
  const pageId = persona.page.id;
  const opening =
    failure.reason === 'unknown_verb' ? await openingFor(ports, tx, pageId, failure.message) : null;
  await tx.lock(lockKeys.harnessEvents(persona.harness.id));
  if (opening?.create) await tx.lock(lockKeys.harnessEvents(opening.create.harnessId));
  const context = recordContext(ports, activation.caller, activation.at);
  const itemId = opening?.itemId ?? null;
  const { verb, reason, message } = failure;
  await recordHarnessEvents(tx, context, persona.harness.id, [
    draft('persona_activation_failed', {
      pageId,
      persona: persona.frontmatter.identity,
      verb,
      reason,
      message,
      itemId,
    }),
  ]);
  if (opening?.create) await createItem(tx, context, opening.create);
  return refused(reason, { verb, message, itemId });
}

function verbsOf(frontmatter: Frontmatter): readonly string[] {
  return [...new Set([...frontmatter.requires_tools, ...frontmatter.toolset])];
}

export async function activateIn(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
): Promise<KernelOutcome<never>> {
  await tx.lock(lockKeys.personaActivation(activation.pageId));
  const readable = await readablePage(ports, tx, activation);
  if ('status' in readable) return readable;
  const persona = await personaOf(tx, readable.page);
  if ('status' in persona) return persona;
  const denied = authorised(readable, persona.harness, activation.at);
  if (denied !== null) return denied;
  if (persona.page.status !== 'suggested') {
    return refused('not_permitted', { why: 'not_suggested' });
  }
  const { identity } = persona.frontmatter;
  const failure = toolCheck(
    {
      personaSlug: personaSlugOf(identity) ?? identity,
      verbs: verbsOf(persona.frontmatter),
      activator: readable.activator,
      area: persona.harness.jdArea,
      at: activation.at,
    },
    activation.registry,
  );
  if (failure !== null) return recordFailure(ports, tx, activation, persona, failure);
  return refused('not_wired', { step: 'PE-3' });
}
