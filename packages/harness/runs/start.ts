import type { Harness, ItemState, Principal } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { beatWithin } from '../delegations/commands.ts';
import { engineDescriptor, hostable } from '../engines.ts';
import { claimWithin } from '../items/claim.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { PortNotWiredError, storeRefusalOf } from '../port-errors.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { spendRefusal } from './breaker-level.ts';
import { isFailureDetail } from './evidence-rules.ts';
import { activePersonaOn } from '../personas/projection.ts';
import { personaOfPage, personaPageOf, type PersonaPage } from './persona.ts';
import { ended, heldByRun, newHostedRun } from './rows.ts';
import type { RunPersona, StartedRun, StartRunInput } from './types.ts';

type StartPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

type Start = {
  readonly caller: Caller;
  readonly input: StartRunInput;
  readonly runId: string;
  readonly traceId: string;
  readonly at: Date;
  readonly solo: boolean;
};

type StartOptions = { readonly solo: boolean };

type Target = { readonly item: ItemState; readonly harness: Harness };

type Opened = { readonly started: StartedRun; readonly context: RecordContext };

const ONE_LIVE_RUN = 'harness_runs_one_live_per_item';

async function targetOf(tx: StoreTransaction, input: StartRunInput): Promise<Target | Refused> {
  const item = await tx.harnessItems.read.byId(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  return { item, harness };
}

async function boundPage(
  tx: StoreTransaction,
  start: Start,
  harness: Harness,
): Promise<PersonaPage | Refused> {
  const { caller, input } = start;
  const facts = await activePersonaOn(tx, caller.actor.identity, harness.id);
  const page = facts?.id === input.personaPageId ? personaPageOf(facts) : null;
  const delegation = await tx.delegations.read.byId(input.delegationId);
  const identity = page?.frontmatter.identity;
  const bound =
    page !== null &&
    identity === caller.actor.identity &&
    page.frontmatter.harness === harness.id &&
    (delegation === null || delegation.persona === identity);
  return bound ? page : refused('page_not_found', { pageId: input.personaPageId });
}

function hostingRefusal({ frontmatter }: PersonaPage, harness: Harness): Refused | null {
  if (frontmatter.run_shape !== 'workflow-run') {
    return refused('not_permitted', { why: 'run_shape' });
  }
  if (!hostable(frontmatter.engine, 'workflow-run')) {
    return refused('engine_not_available', { engine: frontmatter.engine });
  }
  if (engineDescriptor(frontmatter.engine).needsHostedBuilder && !harness.hostedBuilderEnabled) {
    return refused('hosted_builder_off', { harnessId: harness.id });
  }
  return null;
}

async function personaFor(
  tx: StoreTransaction,
  start: Start,
  harness: Harness,
): Promise<RunPersona | Refused> {
  const page = await boundPage(tx, start, harness);
  if ('status' in page) return page;
  return hostingRefusal(page, harness) ?? personaOfPage(page.facts);
}

async function beatPrincipalOf(
  ports: StartPorts,
  tx: StoreTransaction,
  start: Start,
): Promise<Principal | Refused> {
  const beat = await beatWithin(ports, tx, start.caller, start.input.delegationId, start.at);
  if (beat.status !== 'accepted') return beat;
  const live = await tx.harnessRuns.read.liveForItem(start.input.itemId);
  if (live !== null) return refused('lease_held', { itemId: start.input.itemId });
  return beat.value.principal;
}

function startedOf(run: RunRow, leaseExpiresAt: string | null): StartedRun {
  return {
    runId: run.id,
    harnessId: run.harnessId,
    itemId: run.itemId,
    persona: run.persona,
    engine: run.engine,
    model: run.model,
    leaseExpiresAt,
  };
}

async function openRun(
  ports: StartPorts,
  tx: StoreTransaction,
  start: Start,
  { item, persona }: { readonly item: ItemState; readonly persona: RunPersona },
): Promise<KernelOutcome<Opened>> {
  const { caller, input, runId, traceId, at } = start;
  const principal = await beatPrincipalOf(ports, tx, start);
  if ('status' in principal) return principal;
  const acting: Caller = { ...caller, actor: principal, traceId };
  const claimed = await claimWithin(ports, tx, acting, input, at);
  if (claimed.status !== 'accepted') return claimed;
  const run = newHostedRun({ runId, item, persona, delegationId: input.delegationId, traceId, at });
  await tx.harnessRuns.write.insert(run);
  const context = recordContext(ports, acting, at);
  const recorded = await recordItemEvents(tx, context, item.itemId, [
    ...claimed.value.drafts,
    draft('run_started', {
      runId,
      persona: run.persona,
      runShape: 'workflow-run',
      engine: run.engine,
      model: run.model,
      delegationId: input.delegationId,
    }),
  ]);
  return accepted({ started: startedOf(run, recorded.item.leaseExpiresAt), context });
}

async function soloRefusal(
  tx: StoreTransaction,
  start: Start,
  harnessId: string,
): Promise<Refused | null> {
  if (!start.solo) return null;
  const persona = start.caller.actor.identity;
  const live = await tx.harnessRuns.read.live(harnessId);
  return live.some((run) => run.persona === persona) ? refused('lease_held', { persona }) : null;
}

async function startIn(
  ports: StartPorts,
  tx: StoreTransaction,
  start: Start,
): Promise<KernelOutcome<Opened>> {
  if (start.solo) await tx.lock(lockKeys.runPersona(start.caller.actor.identity));
  const target = await targetOf(tx, start.input);
  if ('status' in target) return target;
  const busy = await soloRefusal(tx, start, target.harness.id);
  if (busy !== null) return busy;
  const persona = await personaFor(tx, start, target.harness);
  if ('status' in persona) return persona;
  const held = await spendRefusal(tx, start.at);
  if (held !== null) return held;
  return openRun(ports, tx, start, { item: target.item, persona });
}

async function opened(ports: StartPorts, start: Start): Promise<KernelOutcome<Opened>> {
  try {
    return await ports.store.transaction((tx) => startIn(ports, tx, start));
  } catch (error) {
    if (storeRefusalOf(error)?.constraint !== ONE_LIVE_RUN) throw error;
    return refused('lease_held', { itemId: start.input.itemId });
  }
}

function detailOf(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  return isFailureDetail(name) ? name : 'Error';
}

async function failStart(ports: StartPorts, open: Opened, error: unknown): Promise<void> {
  const { runId, itemId } = open.started;
  await ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    const run = await tx.harnessRuns.read.lock(runId);
    if (item === null || run === null || run.outcome !== 'running') return;
    const at = ports.clock.now();
    await tx.harnessRuns.write.update(
      ended(run, { outcome: 'failed', failure: 'start_failed' }, at),
    );
    const failed = draft('run_failed', {
      runId,
      step: null,
      why: 'start_failed',
      detail: detailOf(error),
    });
    const released = heldByRun(item, run) ? [draft('item_released', { holder: run.persona })] : [];
    await recordItemEvents(tx, { ...open.context, at }, itemId, [failed, ...released]);
  });
}

export async function startRun(
  ports: StartPorts,
  caller: Caller,
  input: StartRunInput,
  options: StartOptions = { solo: false },
): Promise<KernelOutcome<StartedRun>> {
  const start = { caller, input, runId: ports.ids.next(), traceId: ports.ids.next() };
  const outcome = await opened(ports, { ...start, at: ports.clock.now(), solo: options.solo });
  if (outcome.status !== 'accepted') return outcome;
  const { started, context } = outcome.value;
  try {
    await ports.runs.start({
      runId: started.runId,
      harnessId: started.harnessId,
      itemId: started.itemId,
      persona: started.persona,
      runShape: 'workflow-run',
      engine: started.engine,
      traceId: context.traceId,
    });
  } catch (error) {
    await failStart(ports, outcome.value, error);
    if (error instanceof PortNotWiredError) return refused('not_wired', { port: error.port });
    throw error;
  }
  return accepted(started);
}
