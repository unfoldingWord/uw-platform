import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { IssueRef, ItemState } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { harnessItems, harnessStages } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toItemState } from './rows.ts';
import type { HarnessItemsGateway, ItemClaim, StageCursor, StagePage } from './types.ts';

const stageOf = (harnessId: string, stageKey: string) =>
  sql`(SELECT id FROM harness_stages WHERE harness_id = ${harnessId} AND key = ${stageKey})`;

function issueColumnsOf(issue: IssueRef | null) {
  if (issue === null) return { issueRepo: null, issueNumber: null, issueGithubId: null };
  return { issueRepo: issue.repo, issueNumber: issue.number, issueGithubId: issue.githubId };
}

function columnsOf(item: ItemState) {
  return {
    stageId: stageOf(item.harnessId, item.stageKey),
    title: item.title,
    pageId: item.pageId,
    priority: item.priority,
    due: item.due,
    claimedBy: item.holder,
    claimantKind: item.claimantKind,
    delegationId: item.delegationId,
    leaseExpires: item.leaseExpiresAt === null ? null : new Date(item.leaseExpiresAt),
    gateStatus: item.gateStatus,
    gateTarget: item.gateTarget,
    riskTier: item.riskTier,
    riskDomains: [...item.riskDomains],
    expectedHead: item.expectedHead,
    branchState: item.branchState,
    prRepo: item.pullRequest?.repo ?? null,
    prNumber: item.pullRequest?.number ?? null,
    ...issueColumnsOf(item.issue),
    zulipTopic: item.zulipTopic,
  };
}

function selectItems(executor: AnyExecutor) {
  return executor
    .select({ item: harnessItems, stageKey: harnessStages.key })
    .from(harnessItems)
    .innerJoin(harnessStages, eq(harnessStages.id, harnessItems.stageId));
}

function claimable(at: Date): SQL | undefined {
  return or(
    isNull(harnessItems.claimedBy),
    and(isNotNull(harnessItems.leaseExpires), lte(harnessItems.leaseExpires, at)),
  );
}

async function claim(executor: AnyExecutor, request: ItemClaim): Promise<boolean> {
  const rows = await executor
    .update(harnessItems)
    .set({
      claimedBy: request.holder,
      claimantKind: request.claimantKind,
      delegationId: request.delegationId,
      leaseExpires: request.leaseExpiresAt,
    })
    .where(and(eq(harnessItems.id, request.itemId), claimable(request.at)))
    .returning({ id: harnessItems.id });
  return rows.length === 1;
}

async function project(executor: AnyExecutor, item: ItemState): Promise<void> {
  const rows = await executor
    .update(harnessItems)
    .set(columnsOf(item))
    .where(eq(harnessItems.id, item.itemId))
    .returning({ id: harnessItems.id });
  if (rows.length === 0) throw new Error(`no item ${item.itemId} to project`);
}

async function heldInStage(
  executor: AnyExecutor,
  harnessId: string,
  stageKey: string,
  at: Date,
): Promise<number> {
  const rows = await executor
    .select({ held: count() })
    .from(harnessItems)
    .innerJoin(harnessStages, eq(harnessStages.id, harnessItems.stageId))
    .where(
      and(
        eq(harnessItems.harnessId, harnessId),
        eq(harnessStages.key, stageKey),
        isNotNull(harnessItems.claimedBy),
        or(isNull(harnessItems.leaseExpires), gt(harnessItems.leaseExpires, at)),
      ),
    );
  return rows[0]?.held ?? 0;
}

function afterCursor(after: StageCursor | null): SQL | undefined {
  if (after === null) return undefined;
  return or(
    lt(harnessItems.priority, after.priority),
    and(eq(harnessItems.priority, after.priority), gt(harnessItems.id, after.itemId)),
  );
}

async function openInStage(
  executor: AnyExecutor,
  harnessId: string,
  stageKey: string,
  page: StagePage,
): Promise<readonly ItemState[]> {
  const rows = await selectItems(executor)
    .where(
      and(
        eq(harnessItems.harnessId, harnessId),
        eq(harnessStages.key, stageKey),
        ne(harnessItems.gateStatus, 'done'),
        afterCursor(page.after),
      ),
    )
    .orderBy(desc(harnessItems.priority), asc(harnessItems.id))
    .limit(page.limit);
  return rows.map((row) => toItemState(row.item, row.stageKey));
}

async function lowestOpenPriority(
  executor: AnyExecutor,
  harnessId: string,
  stageKey: string,
): Promise<number | null> {
  const rows = await executor
    .select({ lowest: sql<number | null>`min(${harnessItems.priority})` })
    .from(harnessItems)
    .innerJoin(harnessStages, eq(harnessStages.id, harnessItems.stageId))
    .where(
      and(
        eq(harnessItems.harnessId, harnessId),
        eq(harnessStages.key, stageKey),
        ne(harnessItems.gateStatus, 'done'),
      ),
    );
  const lowest = rows[0]?.lowest;
  return lowest === null || lowest === undefined ? null : Number(lowest);
}

function bindReads(executor: AnyExecutor): HarnessItemsGateway['read'] {
  return {
    byId: async (itemId) => {
      const rows = await selectItems(executor).where(eq(harnessItems.id, itemId));
      return rows[0] ? toItemState(rows[0].item, rows[0].stageKey) : null;
    },
    byIssue: async (githubId) => {
      const rows = await selectItems(executor).where(eq(harnessItems.issueGithubId, githubId));
      return rows[0] ? toItemState(rows[0].item, rows[0].stageKey) : null;
    },
    lock: async (itemId) => {
      const locked = await executor
        .select({ id: harnessItems.id })
        .from(harnessItems)
        .where(eq(harnessItems.id, itemId))
        .for('update');
      if (locked.length === 0) return null;
      const rows = await selectItems(executor).where(eq(harnessItems.id, itemId));
      return rows[0] ? toItemState(rows[0].item, rows[0].stageKey) : null;
    },
    forHarness: async (harnessId) => {
      const rows = await selectItems(executor)
        .where(eq(harnessItems.harnessId, harnessId))
        .orderBy(asc(harnessItems.priority), asc(harnessItems.createdAt), asc(harnessItems.id));
      return rows.map((row) => toItemState(row.item, row.stageKey));
    },
    heldInStage: (harnessId, stageKey, at) => heldInStage(executor, harnessId, stageKey, at),
    openInStage: (harnessId, stageKey, page) => openInStage(executor, harnessId, stageKey, page),
    lowestOpenPriority: (harnessId, stageKey) => lowestOpenPriority(executor, harnessId, stageKey),
    lapsedLeases: async (at, limit) => {
      const rows = await executor
        .select({ id: harnessItems.id })
        .from(harnessItems)
        .where(and(isNotNull(harnessItems.leaseExpires), lte(harnessItems.leaseExpires, at)))
        .orderBy(asc(harnessItems.leaseExpires), asc(harnessItems.id))
        .limit(limit);
      return rows.map((row) => row.id);
    },
  };
}

export function bindItems(executor: AnyExecutor): HarnessItemsGateway {
  return {
    read: bindReads(executor),
    write: {
      insert: (item, at) =>
        refusing(async () => {
          await executor.insert(harnessItems).values({
            id: item.itemId,
            harnessId: item.harnessId,
            ...columnsOf(item),
            createdAt: at,
          });
        }),
      claim: (request) => refusing(() => claim(executor, request)),
      project: (item) => refusing(() => project(executor, item)),
    },
  };
}
