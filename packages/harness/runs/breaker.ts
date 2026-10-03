import { eventEvidenceSchemas, type BreakerLevel, type HarnessEvent } from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { currentLevel, freshAt, latestReading, levelOfEvent } from './breaker-level.ts';
import { resumeRunsWhere } from './resume.ts';
import { hibernateRunsWhere, underPause } from './suspend.ts';

const BREAKER_HOLD_PERCENT = 75;
const BREAKER_PAUSE_PERCENT = 90;
const BREAKER_REFRESH_MS = 5 * 60 * 1000;
export const DEFAULT_SPEND_CAP = { capMinor: 125_000, currency: 'USD' } as const;

const PERCENT_LIMIT = 100_000;
const CURRENCY = /^[A-Z]{3}$/;

export type BreakerReading = {
  readonly level: BreakerLevel;
  readonly spentMinor: number;
  readonly capMinor: number;
  readonly currency: string;
  readonly percent: number;
};
export type BreakerState = {
  readonly level: BreakerLevel;
  readonly reading: BreakerReading | null;
  readonly at: string | null;
  readonly fresh: boolean;
};
type BreakerCheck = BreakerReading & {
  readonly previous: BreakerLevel;
  readonly changed: boolean;
  readonly hibernated: readonly string[];
  readonly resumed: readonly string[];
};
type BreakerCheckInput = {
  readonly capMinor: number;
  readonly currency: string;
  readonly since: Date;
};
export type BreakerCommands = {
  check(caller: Caller, input: BreakerCheckInput): Promise<KernelOutcome<BreakerCheck>>;
  state(at: Date): Promise<BreakerState>;
};

type BreakerPorts = Pick<Ports, 'clock' | 'ids' | 'store' | 'runs' | 'modelEngine'>;

export function levelOf(
  spentMinor: number,
  capMinor: number,
): { readonly level: BreakerLevel; readonly percent: number } {
  const percent = Math.floor((spentMinor * 100) / capMinor);
  if (percent >= BREAKER_PAUSE_PERCENT) return { level: 'pausing', percent };
  if (percent >= BREAKER_HOLD_PERCENT) return { level: 'holding', percent };
  return { level: 'open', percent };
}

function inputRefusal(caller: Caller, input: BreakerCheckInput): Refused | null {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isSafeInteger(input.capMinor) || input.capMinor < 1) {
    return refused('malformed_command', { why: 'cap' });
  }
  return CURRENCY.test(input.currency) ? null : refused('malformed_command', { why: 'currency' });
}

function fresh(latest: HarnessEvent | null, level: BreakerLevel, at: Date): boolean {
  if (latest === null || levelOfEvent(latest) !== level) return false;
  return at.getTime() - new Date(latest.at).getTime() < BREAKER_REFRESH_MS;
}

function recordOn(
  ports: BreakerPorts,
  context: RecordContext,
  harnessId: string,
  reading: BreakerReading,
): Promise<boolean> {
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.breaker());
    if (fresh(await latestReading(tx, harnessId), reading.level, context.at)) return false;
    const { level, ...evidence } = reading;
    const percent = Math.min(evidence.percent, PERCENT_LIMIT);
    await recordHarnessEvents(tx, context, harnessId, [
      draft(`breaker_${level}`, { ...evidence, percent }),
    ]);
    return true;
  });
}

async function recordEverywhere(
  ports: BreakerPorts,
  context: RecordContext,
  reading: BreakerReading,
): Promise<void> {
  const harnesses = await ports.store.transaction((tx) => tx.harnesses.read.list());
  const ids = harnesses.map((harness) => harness.id).sort((a, b) => a.localeCompare(b));
  for (const harnessId of ids) await recordOn(ports, context, harnessId, reading);
}

async function runningHosted(tx: StoreTransaction): Promise<RunRow[]> {
  const live = await tx.harnessRuns.read.live(null);
  return live.filter((run) => run.outcome === 'running' && run.runShape === 'workflow-run');
}

async function unpaused(tx: StoreTransaction, run: RunRow): Promise<boolean> {
  const item = await tx.harnessItems.read.byId(run.itemId);
  return item !== null && !(await underPause(tx, item));
}

async function breakerHibernated(tx: StoreTransaction): Promise<RunRow[]> {
  const live = await tx.harnessRuns.read.live(null);
  const chosen: RunRow[] = [];
  for (const run of live) {
    if (run.hibernatedFor === 'breaker' && (await unpaused(tx, run))) chosen.push(run);
  }
  return chosen;
}

type Settled = { readonly hibernated: readonly string[]; readonly resumed: readonly string[] };

async function settleRuns(ports: BreakerPorts, level: BreakerLevel): Promise<Settled> {
  if (level === 'pausing') {
    return { hibernated: await hibernateRunsWhere(ports, runningHosted, 'breaker'), resumed: [] };
  }
  if (level === 'holding') return { hibernated: [], resumed: [] };
  return { hibernated: [], resumed: await resumeRunsWhere(ports, breakerHibernated, 'breaker') };
}

async function readingOf(
  ports: BreakerPorts,
  input: BreakerCheckInput,
): Promise<BreakerReading | Refused> {
  const spend = await ports.modelEngine.spend(input.since);
  if (spend.currency !== input.currency) return refused('malformed_command', { why: 'currency' });
  const { level, percent } = levelOf(spend.spentMinor, input.capMinor);
  const { capMinor, currency } = input;
  return { level, spentMinor: spend.spentMinor, capMinor, currency, percent };
}

async function check(
  ports: BreakerPorts,
  caller: Caller,
  input: BreakerCheckInput,
): Promise<KernelOutcome<BreakerCheck>> {
  const denied = inputRefusal(caller, input);
  if (denied !== null) return denied;
  const reading = await readingOf(ports, input);
  if ('status' in reading) return reading;
  const previous = await ports.store.transaction(currentLevel);
  await recordEverywhere(ports, recordContext(ports, caller, ports.clock.now()), reading);
  const settled = await settleRuns(ports, reading.level);
  return accepted({ ...reading, previous, changed: previous !== reading.level, ...settled });
}

function readingFrom(event: HarnessEvent): BreakerReading | null {
  const parsed = eventEvidenceSchemas.breaker_open.safeParse(event.evidence);
  return parsed.success ? { level: levelOfEvent(event), ...parsed.data } : null;
}

async function state(ports: BreakerPorts, at: Date): Promise<BreakerState> {
  const latest = await ports.store.transaction((tx) => latestReading(tx, null));
  if (latest === null) return { level: 'open', reading: null, at: null, fresh: false };
  const level = levelOfEvent(latest);
  return { level, reading: readingFrom(latest), at: latest.at, fresh: freshAt(latest, at) };
}

export function createBreakerCommands(ports: BreakerPorts): BreakerCommands {
  return {
    check: (caller, input) => check(ports, caller, input),
    state: (at) => state(ports, at),
  };
}
