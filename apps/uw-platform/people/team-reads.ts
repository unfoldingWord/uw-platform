import { asc, eq, inArray } from 'drizzle-orm';
import { personStatusSchema, type AllocationTargetKind } from '@uw/contracts';
import { can, DIRECTORY_AREA } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import {
  directoryEntries,
  pageLinks,
  pages,
  people,
  personCommitments,
  staffAllocations,
} from '@uw/db/schema';
import type { TeamMember, TeamPage, TeamRead } from './team-model.ts';

const PROGRAM_PORTFOLIO = 'program.portfolio';
const targetKinds: readonly AllocationTargetKind[] = ['program', 'portfolio'];

type Reader = { readonly actor: Principal; readonly at: Date };

async function membersFor(db: Executor, reader: Reader): Promise<readonly TeamMember[]> {
  const rows = await db
    .select({
      id: people.id,
      name: people.displayName,
      status: people.status,
      ring: directoryEntries.ring,
      portfolios: directoryEntries.portfolios,
    })
    .from(people)
    .leftJoin(directoryEntries, eq(directoryEntries.personId, people.id))
    .orderBy(asc(people.displayName), asc(people.id));
  return rows
    .filter((row) => {
      const status = personStatusSchema.parse(row.status);
      return can(reader.actor, 'read', { kind: 'person', personId: row.id, status }, reader.at);
    })
    .map((row) => ({
      id: row.id,
      name: row.name,
      ring: row.ring,
      portfolioIds: row.portfolios ?? [],
    }));
}

async function portfolioOfPrograms(db: Executor): Promise<ReadonlyMap<string, string>> {
  const rows = await db
    .select({ from: pageLinks.fromPage, to: pageLinks.toPage })
    .from(pageLinks)
    .where(eq(pageLinks.rel, PROGRAM_PORTFOLIO))
    .orderBy(asc(pageLinks.position));
  const parents = new Map<string, string>();
  for (const row of rows)
    if (row.to !== null && !parents.has(row.from)) parents.set(row.from, row.to);
  return parents;
}

function kindOf(type: string): AllocationTargetKind {
  return type === 'portfolio' ? 'portfolio' : 'program';
}

async function pagesFor(db: Executor, reader: Reader): Promise<ReadonlyMap<string, TeamPage>> {
  const rows = await db
    .select({
      id: pages.id,
      type: pages.type,
      title: pages.title,
      status: pages.status,
      area: pages.jdArea,
    })
    .from(pages)
    .where(inArray(pages.type, [...targetKinds]));
  const parents = await portfolioOfPrograms(db);
  const shown = rows.map((row): TeamPage => {
    if (!can(reader.actor, 'read', { kind: 'area', area: row.area }, reader.at)) {
      return { id: row.id, state: 'hidden' };
    }
    const kind = kindOf(row.type);
    if (row.status === 'retired') return { id: row.id, state: 'retired', kind, title: row.title };
    const portfolioId = kind === 'program' ? (parents.get(row.id) ?? null) : null;
    return { id: row.id, state: 'shown', kind, title: row.title, portfolioId };
  });
  return new Map(shown.map((page) => [page.id, page]));
}

async function commitmentsFor(db: Executor) {
  const rows = await db
    .select({
      id: personCommitments.id,
      fromId: personCommitments.fromPersonId,
      toPersonId: personCommitments.toPersonId,
      toText: personCommitments.toText,
    })
    .from(personCommitments)
    .orderBy(asc(personCommitments.updatedAt), asc(personCommitments.id));
  return rows;
}

async function allocationsFor(db: Executor) {
  const rows = await db
    .select()
    .from(staffAllocations)
    .orderBy(asc(staffAllocations.updatedAt), asc(staffAllocations.id));
  return rows.flatMap((row) => {
    const pageId = row.programPageId ?? row.portfolioPageId;
    return pageId === null
      ? []
      : [{ id: row.id, personId: row.personId, pageId, percent: row.percent }];
  });
}

export async function readTeam(db: Executor, actor: Principal, at: Date): Promise<TeamRead | null> {
  if (!can(actor, 'read', { kind: 'area', area: DIRECTORY_AREA }, at)) return null;
  const reader = { actor, at };
  return {
    members: await membersFor(db, reader),
    pages: await pagesFor(db, reader),
    commitments: await commitmentsFor(db),
    allocations: await allocationsFor(db),
  };
}
