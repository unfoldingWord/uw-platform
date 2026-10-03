import type { Grants, HarnessEventsGateway, Hub, Store, StoreTransaction } from './ports.ts';

const originals = new WeakMap<StoreTransaction, StoreTransaction>();

function originalOf(tx: StoreTransaction): StoreTransaction {
  return originals.get(tx) ?? tx;
}

function trackingEvents(events: HarnessEventsGateway, appended: Set<string>): HarnessEventsGateway {
  return {
    read: events.read,
    write: {
      append: async (drafts) => {
        const stored = await events.write.append(drafts);
        for (const event of stored) appended.add(event.harnessId);
        return stored;
      },
    },
  };
}

function tracking(tx: StoreTransaction, appended: Set<string>): StoreTransaction {
  const tracked: StoreTransaction = {
    lock: (key) => tx.lock(key),
    harnesses: tx.harnesses,
    harnessStages: tx.harnessStages,
    harnessItems: tx.harnessItems,
    harnessEvents: trackingEvents(tx.harnessEvents, appended),
    gateDecisions: tx.gateDecisions,
    delegations: tx.delegations,
    pages: tx.pages,
  };
  originals.set(tracked, tx);
  return tracked;
}

export function wakingStore(store: Store, hub: Hub): Store {
  return {
    appliedMigrations: () => store.appliedMigrations(),
    transaction: async (work) => {
      const appended = new Set<string>();
      const result = await store.transaction((tx) => work(tracking(tx, appended)));
      await Promise.allSettled([...appended].map(async (harnessId) => hub.wake(harnessId)));
      return result;
    },
  };
}

export function wakingGrants(grants: Grants): Grants {
  return {
    resolve: (personId, at) => grants.resolve(personId, at),
    resolveIn: (tx, personId, at) => grants.resolveIn(originalOf(tx), personId, at),
    lockAndReread: (tx, personId, at) => grants.lockAndReread(originalOf(tx), personId, at),
  };
}
