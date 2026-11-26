import {
  chartExcludedReasonSchema,
  type ChartExcludedEntry,
  type ChartExcludedReason,
} from '@uw/contracts';
import { accepted, refused, type KernelOutcome } from '@uw/harness';
import type { ZodType } from 'zod';
import type { ChartSources } from './sources.ts';

export type ChartCell = string | number | null;
export type ChartRow = Readonly<Record<string, ChartCell>>;
export function cellOf(row: ChartRow, key: string): ChartCell {
  return new Map(Object.entries(row)).get(key) ?? null;
}

export type ChartColumn = { readonly key: string; readonly label: string };

export type Excluded = {
  readonly count: number;
  readonly reasons: readonly { readonly reason: ChartExcludedReason; readonly count: number }[];
  readonly entries: readonly ChartExcludedEntry[];
};

export type QueryRead = { readonly rows: readonly ChartRow[]; readonly excluded: Excluded };

export type PreparedQuery = {
  readonly harnessId: string | null;
  run(sources: ChartSources): Promise<KernelOutcome<QueryRead>>;
};

export type ChartQuery = {
  readonly source: string;
  readonly columns: readonly ChartColumn[];
  readonly live: boolean;
  prepare(params: unknown): KernelOutcome<PreparedQuery>;
};

export const nothingLeftOut: Excluded = { count: 0, reasons: [], entries: [] };

function fieldsOf(issues: readonly { readonly path: readonly PropertyKey[] }[]): string[] {
  return [...new Set(issues.map((issue) => ['params', ...issue.path.map(String)].join('.')))];
}

export function preparedWith<P>(
  schema: ZodType<P>,
  params: unknown,
  prepare: (params: P) => PreparedQuery,
): KernelOutcome<PreparedQuery> {
  const parsed = schema.safeParse(params);
  if (!parsed.success)
    return refused('malformed_command', { fields: fieldsOf(parsed.error.issues) });
  return accepted(prepare(parsed.data));
}

const reasonOrder: ReadonlyMap<string, number> = new Map(
  chartExcludedReasonSchema.options.map((reason, index) => [reason, index]),
);

function orderOf(reason: string): number {
  return reasonOrder.get(reason) ?? reasonOrder.size;
}

function byEntry(a: ChartExcludedEntry, b: ChartExcludedEntry): number {
  return (
    orderOf(a.reason) - orderOf(b.reason) ||
    a.subject.localeCompare(b.subject) ||
    (a.named ?? '').localeCompare(b.named ?? '')
  );
}

export function leftOutOf(
  counted: readonly ChartExcludedReason[],
  entries: readonly ChartExcludedEntry[],
): Excluded {
  const all = [...counted, ...entries.map((entry) => entry.reason)];
  const tally = new Map<ChartExcludedReason, number>();
  for (const reason of all) tally.set(reason, (tally.get(reason) ?? 0) + 1);
  const reasons = [...tally.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => orderOf(a.reason) - orderOf(b.reason));
  return { count: all.length, reasons, entries: [...entries].sort(byEntry) };
}
