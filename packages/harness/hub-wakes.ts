import type { HarnessEvent } from '@uw/contracts';
import type { AfterCommit } from './notify/after-commit.ts';
import type { Grants, HarnessEventsGateway, Hub, Store, StoreTransaction } from './ports.ts';

const originals = new WeakMap<StoreTransaction, StoreTransaction>();

function originalOf(tx: StoreTransaction): StoreTransaction {
  return originals.get(tx) ?? tx;
}

function trackingEvents(
  events: HarnessEventsGateway,
  appended: HarnessEvent[],
): HarnessEventsGateway {
  return {
    read: events.read,
    write: {
      append: async (drafts) => {
        const stored = await events.write.append(drafts);
        appended.push(...stored);
        return stored;
      },
    },
  };
}

function tracking(tx: StoreTransaction, appended: HarnessEvent[]): StoreTransaction {
  const tracked: StoreTransaction = {
    lock: (key) => tx.lock(key),
    lockShared: (key) => tx.lockShared(key),
    harnesses: tx.harnesses,
    harnessStages: tx.harnessStages,
    harnessItems: tx.harnessItems,
    harnessEvents: trackingEvents(tx.harnessEvents, appended),
    harnessRuns: tx.harnessRuns,
    gateDecisions: tx.gateDecisions,
    delegations: tx.delegations,
    pages: tx.pages,
  };
  originals.set(tracked, tx);
  return tracked;
}

async function afterAppend(
  hub: Hub,
  appended: readonly HarnessEvent[],
  afterCommit: AfterCommit | undefined,
): Promise<void> {
  const harnessIds = new Set(appended.map((event) => event.harnessId));
  await Promise.allSettled([...harnessIds].map(async (harnessId) => hub.wake(harnessId)));
  if (afterCommit === undefined || appended.length === 0) return;
  try {
    await afterCommit(appended);
  } catch {
    return;
  }
}

export function wakingStore(store: Store, hub: Hub, afterCommit?: AfterCommit): Store {
  return {
    appliedMigrations: () => store.appliedMigrations(),
    transaction: async (work) => {
      const appended: HarnessEvent[] = [];
      const result = await store.transaction((tx) => work(tracking(tx, appended)));
      await afterAppend(hub, appended, afterCommit);
      return result;
    },
  };
}

export function wakingGrants(grants: Grants): Grants {
  return {
    resolve: (personId, at) => grants.resolve(personId, at),
    resolveIn: (tx, personId, at) => grants.resolveIn(originalOf(tx), personId, at),
    lockAndReread: (tx, personId, at) => grants.lockAndReread(originalOf(tx), personId, at),
    holders: (area, at) => grants.holders(area, at),
  };
}
