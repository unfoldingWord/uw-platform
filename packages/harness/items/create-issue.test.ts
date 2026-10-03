import {
  harnessSchema,
  identitySchema,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { HarnessEventsGateway, HarnessItemsGateway, HarnessesGateway } from '../ports.ts';
import { createItem, RecordError, type NewItem, type RecordContext } from './record.ts';

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const at = new Date('2026-10-01T09:00:00.000Z');
const issue = { repo: 'unfoldingWord/uw-platform', number: 42, githubId: 9100000001 };

type World = {
  readonly inserted: ItemState[];
  readonly appended: HarnessEvent[];
  readonly tx: {
    readonly harnesses: HarnessesGateway;
    readonly harnessItems: HarnessItemsGateway;
    readonly harnessEvents: HarnessEventsGateway;
  };
};

async function unused(): Promise<never> {
  throw new Error('this gateway member is not used by createItem');
}

function harnessOf(repository: string | null): Harness {
  return harnessSchema.parse({
    id: harnessId,
    key: 'software',
    template: 'software',
    jdArea: '80-89',
    repository,
    hostedBuilderEnabled: false,
    paused: false,
  });
}

function harnessesGateway(harness: Harness): HarnessesGateway {
  return {
    read: {
      byId: async (id) => (id === harness.id ? harness : null),
      byKey: unused,
      byRepository: unused,
      list: unused,
    },
    write: { insert: unused, setPaused: unused, setHostedBuilder: unused },
  };
}

function itemsGateway(inserted: ItemState[]): HarnessItemsGateway {
  return {
    read: {
      byId: unused,
      byIssue: unused,
      lock: unused,
      forHarness: unused,
      heldInStage: unused,
      openInStage: unused,
      lowestOpenPriority: unused,
      lapsedLeases: unused,
    },
    write: {
      insert: async (item) => {
        inserted.push(item);
      },
      claim: unused,
      project: unused,
    },
  };
}

function eventsGateway(appended: HarnessEvent[]): HarnessEventsGateway {
  return {
    read: { page: unused, createdFor: unused, latestNamed: unused },
    write: {
      append: async (events: readonly NewHarnessEvent[]) => {
        const stored = events.map((event, index) => ({ ...event, position: index + 1 }));
        appended.push(...stored);
        return stored;
      },
    },
  };
}

function worldOf(repository: string | null): World {
  const inserted: ItemState[] = [];
  const appended: HarnessEvent[] = [];
  const tx = {
    harnesses: harnessesGateway(harnessOf(repository)),
    harnessItems: itemsGateway(inserted),
    harnessEvents: eventsGateway(appended),
  };
  return { inserted, appended, tx };
}

function context(): RecordContext {
  return {
    actor: identitySchema.parse('agent:ingest'),
    at,
    traceId: '00000000-0000-4000-8000-0000000000e1',
    requestId: null,
    ids: { next: () => '00000000-0000-4000-a000-000000000001' },
  };
}

function wrapping(wrapped: typeof issue | null): NewItem {
  return {
    itemId,
    harnessId,
    stageKey: 'package',
    title: 'Wire the board',
    pageId: null,
    priority: 0,
    due: null,
    issue: wrapped,
  };
}

describe('an item wraps only an issue in its harness repository (the GH-3 SECURITY carry)', () => {
  it('creates an item for an issue in the harness repository in any case, carrying the issue in item_created', async () => {
    const world = worldOf('UnfoldingWord/UW-Platform');
    const recorded = await createItem(world.tx, context(), wrapping(issue));
    expect(recorded.item.issue).toEqual(issue);
    expect(world.appended.map((event) => event.evidence['issue'])).toEqual([issue]);
  });

  it.each([
    ['another repository', 'unfoldingWord/elsewhere'],
    ['no repository', null],
  ])('refuses, before any write, an issue when the harness names %s', async (_case, repository) => {
    const world = worldOf(repository);
    await expect(createItem(world.tx, context(), wrapping(issue))).rejects.toThrow(RecordError);
    expect({ inserted: world.inserted, appended: world.appended }).toEqual({
      inserted: [],
      appended: [],
    });
  });

  it('creates an item with no issue whatever the harness repository', async () => {
    const world = worldOf(null);
    const recorded = await createItem(world.tx, context(), wrapping(null));
    expect(recorded.item.issue).toBeNull();
  });
});
