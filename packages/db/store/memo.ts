import { AsyncLocalStorage } from 'node:async_hooks';
import type { Harness, ItemState, Stage } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { heldByStage, openForHarnesses, parkedForHarnesses } from './items.ts';
import { stagesOfHarnesses } from './stages.ts';
import type { DrizzleTransaction } from './types.ts';

type Reads = Record<string, unknown>;
type Gateway = { readonly read: Reads };
type Seen = Map<string, Promise<unknown>>;
type ByHarness<T> = ReadonlyMap<string, T>;

type Batch = {
  readonly shared: (rest: readonly unknown[]) => readonly unknown[];
  readonly fetch: (
    executor: AnyExecutor,
    harnessIds: readonly string[],
    shared: readonly unknown[],
  ) => Promise<ByHarness<unknown>>;
  readonly pick: (found: unknown, rest: readonly unknown[]) => unknown;
};

const whole = (found: unknown) => found;

const batches: ReadonlyMap<string, Batch> = new Map(
  Object.entries({
    'harnessStages.forHarness': {
      shared: () => [],
      fetch: (executor, harnessIds): Promise<ByHarness<readonly Stage[]>> =>
        stagesOfHarnesses(executor, harnessIds),
      pick: whole,
    },
    'harnessItems.openFor': {
      shared: (rest) => rest,
      fetch: (executor, harnessIds, [limit]): Promise<ByHarness<readonly ItemState[]>> =>
        openForHarnesses(executor, harnessIds, Number(limit)),
      pick: whole,
    },
    'harnessItems.parked': {
      shared: (rest) => rest,
      fetch: (executor, harnessIds, [limit]): Promise<ByHarness<readonly ItemState[]>> =>
        parkedForHarnesses(executor, harnessIds, Number(limit)),
      pick: whole,
    },
    'harnessItems.heldInStage': {
      shared: ([, at]) => [at],
      fetch: (executor, harnessIds, [at]): Promise<ByHarness<ReadonlyMap<string, number>>> =>
        heldByStage(executor, harnessIds, at as Date),
      pick: (found, [stageKey]) =>
        (found as ReadonlyMap<string, number>).get(String(stageKey)) ?? 0,
    },
  } satisfies Record<string, Batch>),
);

const LIST_KEY = 'harnesses.list:[]';

type Scope = { readonly seen: Seen; readonly admitted: Set<string> };

const requestScope = new AsyncLocalStorage<Scope>();

export function sharingReads<T>(work: () => Promise<T>): Promise<T> {
  return requestScope.run({ seen: new Map(), admitted: new Set() }, work);
}

function plain(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every(plain);
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every(plain);
}

function keyOf(name: string, args: readonly unknown[]): string | null {
  return args.every(plain) ? `${name}:${JSON.stringify(args)}` : null;
}

function remembered<T>(seen: Seen, key: string, read: () => Promise<T>): Promise<T> {
  const found = seen.get(key);
  if (found !== undefined) return found as Promise<T>;
  const started = read();
  seen.set(key, started);
  started.catch(() => seen.delete(key));
  return started;
}

type Context = {
  readonly executor: AnyExecutor;
  readonly seen: Seen;
  readonly admitted: ReadonlySet<string>;
  readonly listed: () => Promise<readonly Harness[]>;
};

type Read = (...args: unknown[]) => unknown;

async function batched(context: Context, name: string, batch: Batch, args: readonly unknown[]) {
  const [harnessId, ...rest] = args;
  const shared = batch.shared(rest);
  if (!context.admitted.has(String(harnessId))) return undefined;
  const ids = [...context.admitted].sort();
  const key = keyOf(`${name}#${ids.join(',')}`, shared);
  if (key === null) return undefined;
  const all = await remembered(context.seen, key, () => batch.fetch(context.executor, ids, shared));
  return all.has(String(harnessId))
    ? { found: batch.pick(all.get(String(harnessId)), rest) }
    : undefined;
}

async function fromList(context: Context, harnessId: unknown): Promise<Harness | null> {
  const listed = await context.listed();
  return listed.find((harness) => harness.id === harnessId) ?? null;
}

function sharedRead(context: Context, name: string, read: Read): Read {
  const batch = batches.get(name);
  return (...args: unknown[]) => {
    const key = keyOf(name, args);
    if (key === null) return read(...args);
    return remembered(context.seen, key, async () => {
      if (name === 'harnesses.byId') {
        const listed = await fromList(context, args[0]);
        if (listed !== null) return listed;
      }
      if (batch !== undefined && typeof args[0] === 'string') {
        const hit = await batched(context, name, batch, args);
        if (hit !== undefined) return hit.found;
      }
      return read(...args);
    });
  };
}

function sharedReads(context: Context, gateway: string, reads: Reads): Reads {
  return Object.fromEntries(
    Object.entries(reads).map(([name, read]) => [
      name,
      typeof read === 'function' && !name.toLowerCase().includes('lock')
        ? sharedRead(context, `${gateway}.${name}`, read as Read)
        : read,
    ]),
  );
}

function isGateway(value: unknown): value is Gateway {
  return typeof value === 'object' && value !== null && 'read' in value;
}

export function memoizedReads(tx: DrizzleTransaction, executor: AnyExecutor): DrizzleTransaction {
  const page = requestScope.getStore();
  const { seen, admitted } = page ?? { seen: new Map(), admitted: new Set<string>() };
  const listed = () => remembered(seen, LIST_KEY, () => tx.harnesses.read.list());
  const context: Context = { executor, seen, admitted, listed };
  const entries = Object.entries(tx).map(([name, part]) =>
    isGateway(part)
      ? [name, { ...part, read: sharedReads(context, name, part.read) }]
      : [name, part],
  );
  const admit = (harnessIds: readonly string[]) => {
    for (const harnessId of harnessIds) admitted.add(harnessId);
  };
  const shared = Object.fromEntries(entries) as DrizzleTransaction;
  return page === undefined ? shared : { ...shared, admit };
}
