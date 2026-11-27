import { randomUUID } from 'node:crypto';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson, seedRevokedDefaultReading } from '@uw/db/test-seed';
import {
  seedAllocation,
  seedCommitment,
  seedDirectoryEntry,
  seedDisplayName,
  seedPortfolioOf,
} from '@uw/db/test-team';

const at = new Date('2026-11-26T09:00:00.000Z');
const GRANTED = new Date(Date.now() - 60_000);

export type TeamPerson = { readonly id: string; readonly email: string; readonly name: string };

export type TeamWorld = {
  readonly db: Database;
  readonly reader: TeamPerson;
  readonly steward: TeamPerson;
  readonly outsider: TeamPerson;
  readonly ada: TeamPerson;
  readonly sam: TeamPerson;
  readonly samTwo: TeamPerson;
  readonly lee: TeamPerson;
  readonly kit: TeamPerson;
  readonly portfolioOne: string;
  readonly portfolioTwo: string;
  readonly portfolioHidden: string;
  readonly programAlpha: string;
  readonly programHidden: string;
  readonly programRetired: string;
};

async function named(
  db: Database,
  name: string,
  status: 'active' | 'pending' = 'active',
): Promise<TeamPerson> {
  const id = randomUUID();
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.org`;
  await seedPerson(db, { id, email, status });
  await seedDisplayName(db, id, name);
  return { id, email, name };
}

async function granted(
  db: Database,
  person: TeamPerson,
  role: 'viewer' | 'editor' | 'admin',
  area: string,
) {
  await seedGrant(db, {
    id: randomUUID(),
    personId: person.id,
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: GRANTED,
    expiresAt: null,
  });
}

async function page(
  db: Database,
  type: 'portfolio' | 'program',
  title: string,
  where: { readonly area?: string; readonly status?: 'active' | 'retired' } = {},
): Promise<string> {
  const id = randomUUID();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await seedPage(db, {
    id,
    type,
    title,
    slug,
    jdArea: where.area ?? '00-09',
    status: where.status ?? 'active',
    bodyMd: '',
  });
  return id;
}

async function entry(
  db: Database,
  person: TeamPerson,
  ring: string | null,
  portfolios: readonly string[],
): Promise<void> {
  await seedDirectoryEntry(db, { personId: person.id, ring, portfolios, at });
}

async function commitTo(
  db: Database,
  from: TeamPerson,
  to: { readonly person?: TeamPerson; readonly text?: string },
): Promise<void> {
  await seedCommitment(db, {
    fromPersonId: from.id,
    toPersonId: to.person?.id ?? null,
    toText: to.text ?? null,
    at,
  });
}

async function allocate(
  db: Database,
  person: TeamPerson,
  target: { readonly program?: string; readonly portfolio?: string },
  percent: number | null,
): Promise<void> {
  await seedAllocation(db, {
    personId: person.id,
    programPageId: target.program ?? null,
    portfolioPageId: target.portfolio ?? null,
    percent,
    at,
  });
}

async function seedPeople(db: Database) {
  const reader = await named(db, 'Reader Example');
  const steward = await named(db, 'Steward Example');
  await granted(db, steward, 'admin', '10-19');
  const outsider = await named(db, 'Outsider Example');
  await granted(db, outsider, 'editor', '80-89');
  await seedRevokedDefaultReading(db, outsider.id, new Date());
  return {
    reader,
    steward,
    outsider,
    ada: await named(db, 'Ada Example'),
    sam: await named(db, 'Sam Sample'),
    samTwo: await named(db, 'Sam Specimen'),
    lee: await named(db, 'Lee-Anne Placeholder'),
    kit: await named(db, 'Kit Hidden', 'pending'),
  };
}

async function seedPages(db: Database) {
  const portfolioOne = await page(db, 'portfolio', 'Portfolio One');
  const portfolioTwo = await page(db, 'portfolio', 'Portfolio Two');
  const portfolioHidden = await page(db, 'portfolio', 'Portfolio Hidden', { area: '80-89' });
  const programAlpha = await page(db, 'program', 'Program Alpha');
  const programHidden = await page(db, 'program', 'Program Hidden', { area: '80-89' });
  const programRetired = await page(db, 'program', 'Program Retired', { status: 'retired' });
  await seedPortfolioOf(db, programAlpha, portfolioOne);
  return {
    portfolioOne,
    portfolioTwo,
    portfolioHidden,
    programAlpha,
    programHidden,
    programRetired,
  };
}

export async function teamWorld(db: Database): Promise<TeamWorld> {
  const crew = await seedPeople(db);
  const pages = await seedPages(db);
  await entry(db, crew.ada, 'core', [pages.portfolioOne]);
  await entry(db, crew.sam, 'extended', [pages.portfolioOne, pages.portfolioTwo]);
  await entry(db, crew.samTwo, 'core', [pages.portfolioHidden]);
  await entry(db, crew.lee, 'partner', []);
  await commitTo(db, crew.ada, { person: crew.sam });
  await commitTo(db, crew.ada, { text: 'lee.anne placeholder' });
  await commitTo(db, crew.sam, { text: 'ada' });
  await commitTo(db, crew.lee, { text: 'Sam' });
  await commitTo(db, crew.samTwo, { text: 'Quinn Nobody' });
  await commitTo(db, crew.kit, { person: crew.ada });
  await allocate(db, crew.ada, { program: pages.programAlpha }, 60);
  await allocate(db, crew.ada, { portfolio: pages.portfolioTwo }, null);
  await allocate(db, crew.sam, { program: pages.programHidden }, 20);
  await allocate(db, crew.samTwo, { program: pages.programRetired }, 10);
  return { db, ...crew, ...pages };
}
