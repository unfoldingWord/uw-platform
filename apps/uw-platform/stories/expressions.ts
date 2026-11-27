import {
  expressionFieldsOf,
  expressionUrl,
  type ErrorReason,
  type ExpressionFields,
  type ExpressionFlag,
  type ExpressionStatus,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { consentRowOf } from './consent.ts';
import {
  decideExpression,
  expressionAt,
  expressionRowOf,
  insertExpression,
  keepExpressionFields,
  urlTakenElsewhere,
  type ExpressionRow,
} from './expression-rows.ts';
import { levelOf, lockedStoryPage } from './story-pages.ts';
import { shapedExpression } from './story-records.ts';

export type ExpressionOutcome =
  | {
      readonly ok: true;
      readonly expressionId: string;
      readonly created: boolean;
      readonly status: ExpressionStatus;
      readonly flags: readonly ExpressionFlag[];
    }
  | { readonly ok: false; readonly reason: ErrorReason };

export type DecisionOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

type Adding = ExpressionFields & { readonly pageId: string };
type Editing = ExpressionFields & { readonly expressionId: string };
type Deciding = { readonly expressionId: string };

class Refused extends Error {
  constructor(readonly reason: ErrorReason) {
    super(reason);
  }
}

async function refusedOr<T extends { readonly ok: true }>(
  work: () => Promise<T>,
): Promise<T | { readonly ok: false; readonly reason: ErrorReason }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }
}

async function lockedStory(tx: Transaction, actor: Principal, pageId: string, at: Date) {
  const story = await lockedStoryPage(tx, pageId);
  const area = { kind: 'area', area: story?.jdArea ?? '' } as const;
  if (story === null || !can(actor, 'read', area, at)) throw new Refused('page_not_found');
  if (!can(actor, 'write', area, at)) throw new Refused('not_permitted');
  return story;
}

function httpsOnly(given: ExpressionFields): ExpressionFields {
  const url = expressionUrl(given.url);
  if (url === null) throw new Refused('url_not_https');
  return { ...expressionFieldsOf(given), url };
}

async function answered(tx: Transaction, row: ExpressionRow, created: boolean) {
  const told = {
    level: await levelOf(tx, row.pageId),
    consent: await consentRowOf(tx, row.pageId),
  };
  const shaped = shapedExpression(row, told);
  return {
    ok: true as const,
    expressionId: row.id,
    created,
    status: shaped.status,
    flags: shaped.flags,
  };
}

export function addStoryExpression(
  db: Database,
  actor: Principal,
  adding: Adding,
  at: Date,
): Promise<ExpressionOutcome> {
  return refusedOr(() =>
    db.transaction(async (tx) => {
      const story = await lockedStory(tx, actor, adding.pageId, at);
      if (story.status === 'retired') throw new Refused('story_retired');
      const fields = httpsOnly(adding);
      const known = await expressionAt(tx, story.id, fields.url);
      if (known !== null && actor.kind === 'person') throw new Refused('expression_exists');
      if (known !== null) return answered(tx, known, false);
      const status = actor.kind === 'person' ? 'confirmed' : 'suggested';
      const by = actor.identity;
      const row = await insertExpression(tx, { pageId: story.id, fields, status, by, at });
      if (row === null) throw new Refused('expression_exists');
      return answered(tx, row, true);
    }),
  );
}

async function lockedExpression(tx: Transaction, actor: Principal, id: string, at: Date) {
  const row = await expressionRowOf(tx, id);
  if (row === null) throw new Refused('expression_not_found');
  try {
    await lockedStory(tx, actor, row.pageId, at);
  } catch (error) {
    if (error instanceof Refused && error.reason === 'page_not_found') {
      throw new Refused('expression_not_found');
    }
    throw error;
  }
  return row;
}

function mayEdit(actor: Principal, row: ExpressionRow): void {
  if (actor.kind === 'person') return;
  if (row.addedBy !== actor.identity) throw new Refused('not_permitted');
  if (row.status !== 'suggested') throw new Refused('expression_decided');
}

export function updateStoryExpression(
  db: Database,
  actor: Principal,
  editing: Editing,
  at: Date,
): Promise<ExpressionOutcome> {
  return refusedOr(() =>
    db.transaction(async (tx) => {
      const row = await lockedExpression(tx, actor, editing.expressionId, at);
      mayEdit(actor, row);
      const fields = httpsOnly(editing);
      if (await urlTakenElsewhere(tx, row, fields.url)) throw new Refused('expression_exists');
      const kept = await keepExpressionFields(tx, row.id, fields);
      if (kept === null) throw new Refused('expression_not_found');
      return answered(tx, kept, false);
    }),
  );
}

const moves: ReadonlyMap<ExpressionStatus, readonly ExpressionStatus[]> = new Map([
  ['confirmed', ['suggested']],
  ['retired', ['suggested', 'confirmed']],
]);

function decide(to: ExpressionStatus) {
  return (db: Database, actor: Principal, deciding: Deciding, at: Date) =>
    refusedOr<{ readonly ok: true }>(() =>
      db.transaction(async (tx) => {
        const row = await lockedExpression(tx, actor, deciding.expressionId, at);
        if (actor.kind !== 'person') throw new Refused('not_permitted');
        const from = moves.get(to) ?? [];
        if (!from.some((status) => status === row.status)) {
          throw new Refused('transition_not_allowed');
        }
        await decideExpression(tx, row.id, to, { by: actor.identity, at });
        return { ok: true as const };
      }),
    );
}

export const confirmStoryExpression: (
  db: Database,
  actor: Principal,
  deciding: Deciding,
  at: Date,
) => Promise<DecisionOutcome> = decide('confirmed');

export const retireStoryExpression: (
  db: Database,
  actor: Principal,
  deciding: Deciding,
  at: Date,
) => Promise<DecisionOutcome> = decide('retired');
