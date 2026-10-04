import {
  jdAreaSchema,
  personaFrontmatterSchema,
  personaSlugOf,
  type Harness,
  type JdArea,
  type Principal,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import { engineDescriptor } from '../engines.ts';
import { lockKeys } from '../lock-keys.ts';
import {
  createItem,
  draft,
  readAllEvents,
  recordContext,
  recordHarnessEvents,
  type NewItem,
} from '../items/record.ts';
import { refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { PageFacts, StoreTransaction } from '../ports.ts';
import { agentRefusal } from '../stages/rules.ts';
import { dryRunThenFlip } from './flip.ts';
import { toolCheck, type ToolCheckFailure } from './tool-check.ts';
import type {
  ActivatedPersona,
  Activation,
  Persona,
  PersonaFrontmatter,
  PersonaPorts,
} from './types.ts';

type Opening = { readonly itemId: string; readonly create: NewItem | null };

const SOFTWARE_HARNESS_KEY = 'software';
const SOFTWARE_HARNESS_MISSING = 'software_harness_missing';

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
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
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

async function personaOf(
  tx: StoreTransaction,
  page: PageFacts,
  harnessId: string,
): Promise<Persona | Refused> {
  const parsed = personaFrontmatterSchema.safeParse(page.frontmatter);
  if (!parsed.success) return refused('invalid_frontmatter', { pageId: page.id });
  if (parsed.data.harness !== harnessId) return refused('page_not_found', { pageId: page.id });
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

async function earlierItems(
  tx: StoreTransaction,
  persona: Persona,
  verb: string,
): Promise<ReadonlySet<unknown>> {
  const events = await readAllEvents(tx, persona.harness.id, null);
  const earlier = events.filter(
    (event) =>
      event.name === 'persona_activation_failed' &&
      event.evidence['pageId'] === persona.page.id &&
      event.evidence['verb'] === verb,
  );
  return new Set(earlier.map((event) => event.evidence['itemId']));
}

async function openingFor(
  ports: PersonaPorts,
  tx: StoreTransaction,
  persona: Persona,
  failure: ToolCheckFailure,
): Promise<Opening | null> {
  const software = await tx.harnesses.read.byKey(SOFTWARE_HARNESS_KEY);
  if (software === null) return null;
  const earlier = await earlierItems(tx, persona, failure.verb);
  const items = await tx.harnessItems.read.forHarness(software.id);
  const open = items.find((item) => earlier.has(item.itemId) && item.gateStatus !== 'done');
  if (open !== undefined) return { itemId: open.itemId, create: null };
  const stageKey = lowestStageKey(await tx.harnessStages.read.forHarness(software.id));
  if (stageKey === null) return null;
  const itemId = ports.ids.next();
  const create = {
    itemId,
    harnessId: software.id,
    stageKey,
    title: failure.message,
    pageId: persona.page.id,
    priority: 0,
    due: null,
    issue: null,
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
  const missing = failure.reason === 'unknown_verb';
  const opening = missing ? await openingFor(ports, tx, persona, failure) : null;
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
      engine: null,
      reason,
      message,
      itemId,
    }),
  ]);
  if (opening?.create) await createItem(tx, context, opening.create);
  const unopened = missing && opening === null ? { why: SOFTWARE_HARNESS_MISSING } : {};
  return refused(reason, { verb, message, itemId, ...unopened });
}

async function refuseReservedEngine(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
  persona: Persona,
): Promise<Refused | null> {
  const { engine, identity } = persona.frontmatter;
  if (engineDescriptor(engine).availability !== 'reserved') return null;
  const slug = personaSlugOf(identity) ?? identity;
  const message = `persona ${slug} uses engine ${engine}, which is not available`;
  await tx.lock(lockKeys.harnessEvents(persona.harness.id));
  const context = recordContext(ports, activation.caller, activation.at);
  await recordHarnessEvents(tx, context, persona.harness.id, [
    draft('persona_activation_failed', {
      pageId: persona.page.id,
      persona: identity,
      verb: null,
      engine,
      reason: 'engine_not_available',
      message,
      itemId: null,
    }),
  ]);
  return refused('engine_not_available', { engine });
}

function verbsOf(frontmatter: PersonaFrontmatter): readonly string[] {
  return [...new Set([...frontmatter.requires_tools, ...frontmatter.toolset])];
}

export async function activateIn(
  ports: PersonaPorts,
  tx: StoreTransaction,
  activation: Activation,
): Promise<KernelOutcome<ActivatedPersona>> {
  await tx.lock(lockKeys.personaActivation(activation.pageId));
  const readable = await readablePage(ports, tx, activation);
  if ('status' in readable) return readable;
  const persona = await personaOf(tx, readable.page, activation.harnessId);
  if ('status' in persona) return persona;
  const denied = authorised(readable, persona.harness, activation.at);
  if (denied !== null) return denied;
  if (persona.page.version !== activation.expectedVersion) {
    return refused('stale_version', { pageId: persona.page.id, version: persona.page.version });
  }
  if (persona.page.status !== 'suggested') {
    return refused('not_permitted', { why: 'not_suggested' });
  }
  const reserved = await refuseReservedEngine(ports, tx, activation, persona);
  if (reserved !== null) return reserved;
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
  return dryRunThenFlip(ports, tx, activation, persona);
}
