export type ConsentInterval = {
  readonly startsOn: string;
  readonly endsBefore: string | null;
  readonly withdrawnOn: string | null;
};

export type IntervalStanding = 'in_effect' | 'not_started' | 'ended' | 'withdrawn';

export type ConsentEntry =
  | {
      readonly kind: 'granted';
      readonly startsOn: string;
      readonly endsBefore: string | null;
    }
  | { readonly kind: 'withdrawn'; readonly startsOn: string };

export type ConsentHistory = readonly ConsentEntry[];

export function standingOn(interval: ConsentInterval, day: string): IntervalStanding {
  if (interval.withdrawnOn !== null && interval.withdrawnOn <= day) return 'withdrawn';
  if (day < interval.startsOn) return 'not_started';
  if (interval.endsBefore !== null && interval.endsBefore <= day) return 'ended';
  return 'in_effect';
}

function withdrawnAfter(history: ConsentHistory, at: number, day: string): string | null {
  const later = history
    .slice(at + 1)
    .flatMap((entry) => (entry.kind === 'withdrawn' && entry.startsOn <= day ? [entry] : []));
  return later[0]?.startsOn ?? null;
}

export function coveredOn(history: ConsentHistory, day: string): boolean {
  return history.some(
    (entry, at) =>
      entry.kind === 'granted' &&
      standingOn({ ...entry, withdrawnOn: withdrawnAfter(history, at, day) }, day) === 'in_effect',
  );
}
