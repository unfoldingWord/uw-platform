import {
  identitySchema,
  principalSchema,
  type EventName,
  type HarnessEvent,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { HarnessEventsGateway, HarnessItemsGateway, HarnessesGateway } from '../ports.ts';
import { replay } from './fold.ts';
import {
  createItem,
  draft,
  readAllEvents,
  recordContext,
  recordHarnessEvents,
  recordItemEvents,
  RecordError,
  type EventDraft,
  type NewItem,
  type RecordContext,
} from './record.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const personId = '00000000-0000-4000-8000-000000000001';
const at = new Date('2026-10-01T09:00:00.000Z');
const lease = '2026-10-01T10:00:00.000Z';
const traceId = '00000000-0000-4000-8000-0000000000e1';

const initial: NewItem = {
  itemId,
  harnessId,
  stageKey: 'build',
  title: 'Item',
  pageId: null,
  priority: 0,
  due: null,
  issue: null,
};

type Recording = {
  readonly log: string[];
  readonly rows: Map<string, ItemState>;
  readonly appended: HarnessEvent[];
  readonly tx: {
    readonly harnesses: HarnessesGateway;
    readonly harnessItems: HarnessItemsGateway;
    readonly harnessEvents: HarnessEventsGateway;
  };
};

async function unused(): Promise<never> {
  throw new Error('this gateway member is not used by the record module');
}

function itemsGateway(log: string[], rows: Map<string, ItemState>): HarnessItemsGateway {
  return {
    read: {
      byId: unused,
      byIssue: unused,
      byPullRequest: unused,
      lock: async (id) => {
        log.push('lock');
        return rows.get(id) ?? null;
      },
      forHarness: unused,
      heldInStage: unused,
      openInStage: unused,
      lowestOpenPriority: unused,
      lapsedLeases: unused,
      parked: unused,
      openFor: unused,
      byIds: unused,
    },
    write: {
      insert: async (item) => {
        log.push('insert');
        rows.set(item.itemId, item);
      },
      claim: unused,
      project: async (item) => {
        log.push('project');
        rows.set(item.itemId, item);
      },
    },
  };
}

function eventsGateway(log: string[], appended: HarnessEvent[]): HarnessEventsGateway {
  return {
    read: {
      createdFor: unused,
      latestNamed: unused,
      enteredStage: unused,
      recent: unused,
      lastPosition: unused,
      lastPositions: unused,
      countForPersona: unused,
      page: async (query) => {
        const matching = appended.filter(
          (event) => event.position > query.after && event.harnessId === query.harnessId,
        );
        const events = matching.slice(0, query.limit);
        const next = matching.length > events.length ? (events.at(-1)?.position ?? null) : null;
        return { events, next };
      },
    },
    write: {
      append: async (events: readonly NewHarnessEvent[]) => {
        log.push('append');
        const stored = events.map((event, index) => ({
          ...event,
          position: appended.length + index + 1,
        }));
        appended.push(...stored);
        return stored;
      },
    },
  };
}

const harnessesGateway: HarnessesGateway = {
  read: { byId: unused, byKey: unused, byRepository: unused, list: unused },
  write: {
    insert: unused,
    setPaused: unused,
    setHostedBuilder: unused,
    setShadow: unused,
    setFreeze: unused,
    setTemplate: unused,
    setFixClaim: unused,
  },
};

function recording(): Recording {
  const log: string[] = [];
  const rows = new Map<string, ItemState>();
  const appended: HarnessEvent[] = [];
  const tx = {
    harnesses: harnessesGateway,
    harnessItems: itemsGateway(log, rows),
    harnessEvents: eventsGateway(log, appended),
  };
  return { log, rows, appended, tx };
}

function contextFor(actor: string): RecordContext {
  let count = 0;
  return {
    actor: identitySchema.parse(actor),
    at,
    traceId,
    requestId: null,
    ids: {
      next: () => {
        count += 1;
        return `00000000-0000-4000-a000-${count.toString(16).padStart(12, '0')}`;
      },
    },
  };
}

function claimDraft(holder: string, kind: 'person' | 'agent') {
  return draft('item_claimed', {
    holder: identitySchema.parse(holder),
    claimantKind: kind,
    delegationId: null,
    leaseExpiresAt: lease,
  });
}

function projected(world: Recording): ItemState {
  const row = world.rows.get(itemId);
  if (row === undefined) throw new Error('no projection');
  return row;
}

describe('KN-4 the one recording module writes the projection from the fold of the events it appends', () => {
  it('projects, before it appends, exactly what replaying the log gives', async () => {
    const world = recording();
    const context = contextFor(`human:${personId}`);
    await createItem(world.tx, context, initial);
    await recordItemEvents(world.tx, context, itemId, [claimDraft('agent:builder', 'agent')]);
    expect(world.log).toEqual(['insert', 'append', 'lock', 'project', 'append']);
    expect(replay(await readAllEvents(world.tx, harnessId, itemId))).toEqual(projected(world));
  });

  it('folds onto the latest row', async () => {
    const world = recording();
    const context = contextFor(`human:${personId}`);
    await createItem(world.tx, context, initial);
    await recordItemEvents(world.tx, context, itemId, [claimDraft('agent:one', 'agent')]);
    await recordItemEvents(world.tx, context, itemId, [
      draft('lease_renewed', { leaseExpiresAt: '2026-10-01T11:00:00.000Z' }),
    ]);
    expect(projected(world)).toMatchObject({
      holder: 'agent:one',
      leaseExpiresAt: '2026-10-01T11:00:00.000Z',
    });
    expect(world.log.filter((entry) => entry === 'lock')).toHaveLength(2);
  });

  it('locks the row before it folds and refuses an item that does not exist', async () => {
    const world = recording();
    await expect(
      recordItemEvents(world.tx, contextFor(`human:${personId}`), itemId, [
        claimDraft('agent:one', 'agent'),
      ]),
    ).rejects.toThrow(RecordError);
    expect(world.log).toEqual(['lock']);
  });
});

describe('KN-3 the kernel refuses to record an unknown name or ill-fitting evidence', () => {
  it('refuses an unknown event name before any write', async () => {
    const world = recording();
    const context = contextFor(`human:${personId}`);
    await createItem(world.tx, context, initial);
    world.log.length = 0;
    const unknownName: string = 'item_teleported';
    const unknown: EventDraft = { name: unknownName as EventName, evidence: {} };
    await expect(recordItemEvents(world.tx, context, itemId, [unknown])).rejects.toMatchObject({
      name: 'ZodError',
    });
    expect(world.log).toEqual(['lock']);
  });

  it('refuses evidence that does not fit the name before any write', async () => {
    const world = recording();
    const context = contextFor(`human:${personId}`);
    await createItem(world.tx, context, initial);
    world.log.length = 0;
    const misfit: EventDraft = { name: 'item_claimed', evidence: { leaseExpiresAt: lease } };
    await expect(recordItemEvents(world.tx, context, itemId, [misfit])).rejects.toMatchObject({
      name: 'ZodError',
    });
    expect(world.log).toEqual(['lock']);
  });
});

describe('recording nothing', () => {
  it('neither projects nor appends for empty drafts', async () => {
    const world = recording();
    const context = contextFor(`human:${personId}`);
    await createItem(world.tx, context, initial);
    world.log.length = 0;
    const result = await recordItemEvents(world.tx, context, itemId, []);
    expect(result.events).toEqual([]);
    expect(world.log).toEqual(['lock']);
    expect(await recordHarnessEvents(world.tx, context, harnessId, [])).toEqual([]);
    expect(world.log).toEqual(['lock']);
  });
});

describe('recording a harness event and building a context', () => {
  it('stamps a harness event with no item and the context instant', async () => {
    const world = recording();
    const [event] = await recordHarnessEvents(
      world.tx,
      contextFor(`human:${personId}`),
      harnessId,
      [draft('delegation_required', { stage: 'ship' })],
    );
    expect(event).toMatchObject({ itemId: null, harnessId, at: at.toISOString(), position: 1 });
  });

  it('takes the actor identity and trace from the caller and ids from the ports', () => {
    const actor = principalSchema.parse({
      identity: `human:${personId}`,
      kind: 'person',
      personId,
      email: 'ian.lindsley@unfoldingword.org',
      grants: [],
      interactive: true,
    });
    const context = recordContext({ ids: { next: () => 'fixed' } }, { actor, traceId }, at);
    expect(context).toMatchObject({ actor: `human:${personId}`, traceId, at });
    expect(context.ids.next()).toBe('fixed');
  });

  it('reads every event across pages', async () => {
    const world = recording();
    const context = contextFor(`human:${personId}`);
    const drafts = Array.from({ length: 250 }, () =>
      draft('delegation_required', { stage: 'ship' }),
    );
    await recordHarnessEvents(world.tx, context, harnessId, drafts);
    expect(await readAllEvents(world.tx, harnessId, null)).toHaveLength(250);
  });
});
