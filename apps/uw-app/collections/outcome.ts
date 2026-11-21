import type { CollectionCommandName, ErrorReason } from '@uw/contracts';

export type Accepted = {
  readonly status: 'accepted';
  readonly requestId: string;
  readonly collection: string;
  readonly version: number;
  readonly rowId: string | null;
  readonly viewId: string | null;
};

export type Refused = {
  readonly status: 'error';
  readonly requestId: string;
  readonly reason: ErrorReason;
  readonly rows?: readonly string[];
  readonly problems?: readonly string[];
};

export type CollectionOutcome = Accepted | Refused;

export type Done =
  | {
      readonly ok: true;
      readonly collection: string;
      readonly version: number;
      readonly rowId?: string;
      readonly viewId?: string;
    }
  | {
      readonly ok: false;
      readonly reason: ErrorReason;
      readonly rows?: readonly string[];
      readonly problems?: readonly string[];
    };

export type Command = { readonly command: CollectionCommandName; readonly requestId: string };

export function refusal(
  reason: ErrorReason,
  extra: Partial<Pick<Refused, 'rows' | 'problems'>> = {},
): Done {
  return { ok: false, reason, ...extra };
}

export function outcomeOf(requestId: string, done: Done): CollectionOutcome {
  if (!done.ok) {
    const extra = {
      ...(done.rows === undefined ? {} : { rows: done.rows }),
      ...(done.problems === undefined ? {} : { problems: done.problems }),
    };
    return { status: 'error', requestId, reason: done.reason, ...extra };
  }
  return {
    status: 'accepted',
    requestId,
    collection: done.collection,
    version: done.version,
    rowId: done.rowId ?? null,
    viewId: done.viewId ?? null,
  };
}
