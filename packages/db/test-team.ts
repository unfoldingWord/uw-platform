import { eq } from 'drizzle-orm';
import type { AnyExecutor } from './any-database.ts';
import {
  directoryEntries,
  pageLinks,
  people,
  personCommitments,
  staffAllocations,
} from './schema.ts';

const SEEDER = 'human:seed';

export async function seedDisplayName(db: AnyExecutor, personId: string, name: string) {
  await db.update(people).set({ displayName: name }).where(eq(people.id, personId));
}

export type SeedEntry = {
  readonly personId: string;
  readonly ring: string | null;
  readonly portfolios: readonly string[];
  readonly at: Date;
};

export async function seedDirectoryEntry(db: AnyExecutor, entry: SeedEntry): Promise<void> {
  await db.insert(directoryEntries).values({
    personId: entry.personId,
    ring: entry.ring,
    portfolios: [...entry.portfolios],
    updatedBy: SEEDER,
    updatedAt: entry.at,
  });
}

export async function seedPortfolioOf(db: AnyExecutor, program: string, portfolio: string) {
  await db
    .insert(pageLinks)
    .values({ fromPage: program, toPage: portfolio, rel: 'program.portfolio', position: '0000' });
}

export type SeedCommitment = {
  readonly fromPersonId: string;
  readonly toPersonId: string | null;
  readonly toText: string | null;
  readonly at: Date;
};

export async function seedCommitment(db: AnyExecutor, seed: SeedCommitment): Promise<void> {
  const { at, ...commitment } = seed;
  await db
    .insert(personCommitments)
    .values({ ...commitment, updatedBy: `human:${seed.fromPersonId}`, updatedAt: at });
}

export type SeedAllocation = {
  readonly personId: string;
  readonly programPageId: string | null;
  readonly portfolioPageId: string | null;
  readonly percent: number | null;
  readonly at: Date;
};

export async function seedAllocation(db: AnyExecutor, seed: SeedAllocation): Promise<void> {
  const { at, ...allocation } = seed;
  await db.insert(staffAllocations).values({ ...allocation, updatedBy: SEEDER, updatedAt: at });
}
