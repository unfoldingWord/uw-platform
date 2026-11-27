import { assistantProposalKindSchema, assistantProposalStatusSchema } from '@uw/contracts';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { assistantProposals } from '../schema.ts';
import { refusing } from './refusal.ts';
import type {
  AssistantProposalPayload,
  AssistantProposalRow,
  AssistantProposalsGateway,
  NewAssistantProposal,
  ProposalDecision,
  ProposalExpiry,
  RedactQuery,
} from './types.ts';

const RECENT_MOST = 50;
const EXPIRING_MOST = 200;
const REDACT_MOST = 1000;
const FOR_REQUEST_MOST = 20;

function payloadOf(value: unknown): AssistantProposalPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('assistant_proposals.payload is not an object');
  }
  return { ...value };
}

function toProposal(row: typeof assistantProposals.$inferSelect): AssistantProposalRow {
  return {
    id: row.id,
    harnessId: row.harnessId,
    personId: row.personId,
    requestId: row.requestId,
    kind: assistantProposalKindSchema.parse(row.kind),
    payload: payloadOf(row.payload),
    digest: row.digest,
    status: assistantProposalStatusSchema.parse(row.status),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    redactedAt: row.redactedAt,
  };
}

function bounded(limit: number, most: number, what: string): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > most) {
    throw new RangeError(`${what} holds 1 to ${String(most)} proposals, not ${String(limit)}`);
  }
  return limit;
}

async function byId(executor: AnyExecutor, proposalId: string) {
  const rows = await executor
    .select()
    .from(assistantProposals)
    .where(eq(assistantProposals.id, proposalId));
  return rows[0] ? toProposal(rows[0]) : null;
}

async function forRequest(executor: AnyExecutor, requestId: string) {
  const rows = await executor
    .select()
    .from(assistantProposals)
    .where(eq(assistantProposals.requestId, requestId))
    .orderBy(asc(assistantProposals.createdAt), asc(assistantProposals.id))
    .limit(FOR_REQUEST_MOST);
  return rows.map(toProposal);
}

async function recent(executor: AnyExecutor, harnessId: string, limit: number) {
  const rows = await executor
    .select()
    .from(assistantProposals)
    .where(eq(assistantProposals.harnessId, harnessId))
    .orderBy(
      desc(sql`${assistantProposals.status} = 'pending'`),
      desc(assistantProposals.createdAt),
      desc(assistantProposals.id),
    )
    .limit(bounded(limit, RECENT_MOST, 'a recent read'));
  return rows.map(toProposal);
}

async function countSince(executor: AnyExecutor, harnessId: string, since: Date) {
  const rows = await executor
    .select({ total: count() })
    .from(assistantProposals)
    .where(
      and(eq(assistantProposals.harnessId, harnessId), gte(assistantProposals.createdAt, since)),
    );
  return rows[0]?.total ?? 0;
}

async function expiring(executor: AnyExecutor, at: Date, limit: number) {
  const rows = await executor
    .select()
    .from(assistantProposals)
    .where(and(eq(assistantProposals.status, 'pending'), lte(assistantProposals.expiresAt, at)))
    .orderBy(asc(assistantProposals.expiresAt), asc(assistantProposals.id))
    .limit(bounded(limit, EXPIRING_MOST, 'an expiring read'));
  return rows.map(toProposal);
}

async function insert(executor: AnyExecutor, row: NewAssistantProposal) {
  const inserted = await executor
    .insert(assistantProposals)
    .values({ ...row, payload: { ...row.payload }, status: 'pending' })
    .returning();
  const [first] = inserted;
  if (first === undefined) throw new Error('the proposal insert returned no row');
  return toProposal(first);
}

async function decide(executor: AnyExecutor, decision: ProposalDecision) {
  const updated = await executor
    .update(assistantProposals)
    .set({ status: decision.status, decidedBy: decision.decidedBy, decidedAt: decision.at })
    .where(
      and(
        eq(assistantProposals.id, decision.id),
        eq(assistantProposals.status, 'pending'),
        eq(assistantProposals.digest, decision.digest),
      ),
    )
    .returning({ id: assistantProposals.id });
  return updated.length === 1;
}

async function expire(executor: AnyExecutor, expiry: ProposalExpiry) {
  const updated = await executor
    .update(assistantProposals)
    .set({ status: 'expired' })
    .where(
      and(
        eq(assistantProposals.id, expiry.id),
        eq(assistantProposals.status, 'pending'),
        lte(assistantProposals.expiresAt, expiry.at),
      ),
    )
    .returning({ id: assistantProposals.id });
  return updated.length === 1;
}

async function redact(executor: AnyExecutor, query: RedactQuery) {
  const proposals = assistantProposals;
  const onHarness = query.harnessId === null ? undefined : eq(proposals.harnessId, query.harnessId);
  const due = executor
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        isNull(proposals.redactedAt),
        ne(proposals.status, 'pending'),
        lt(proposals.createdAt, query.before),
        onHarness,
      ),
    )
    .limit(bounded(query.limit, REDACT_MOST, 'a redaction'));
  const rows = await executor
    .update(proposals)
    .set({ payload: {}, redactedAt: query.at })
    .where(inArray(proposals.id, due))
    .returning({ id: proposals.id });
  return rows.length;
}

export function bindAssistantProposals(executor: AnyExecutor): AssistantProposalsGateway {
  return {
    read: {
      byId: (proposalId) => byId(executor, proposalId),
      forRequest: (requestId) => forRequest(executor, requestId),
      recent: (harnessId, limit) => recent(executor, harnessId, limit),
      countSince: (harnessId, since) => countSince(executor, harnessId, since),
      expiring: (at, limit) => expiring(executor, at, limit),
    },
    write: {
      insert: (row) => refusing(() => insert(executor, row)),
      decide: (decision) => refusing(() => decide(executor, decision)),
      expire: (expiry) => refusing(() => expire(executor, expiry)),
      redact: (query) => refusing(() => redact(executor, query)),
    },
  };
}
