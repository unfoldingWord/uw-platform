import type { ItemState, Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { PersonDeps } from '../../commands/person-deps.ts';
import { platformGitHubFacts } from '../../ports/github-facts.ts';
import { kernelOn } from '../../testing/kernel.ts';
import { createGitHubReads } from '../client.ts';
import { fixtureApp, fixtureTransport } from './app-key.ts';
import { base } from './facts-fixtures.ts';
import { fixtureGitHub, type FixtureGitHub } from './fixture-github.ts';
import {
  clock,
  parkAtShip,
  people,
  pullBasedOn,
  pulls,
  reviewedAndGreen,
  storedOnTheOldBase,
} from './ship-rig.ts';

export const kimEmail = 'person6@unfoldingword.org';
export const kimGrantId = '00000000-0000-4000-8000-000000020600';
const mergeSha = `ace${'0'.repeat(37)}`;
const repo = '/repos/unfoldingWord/uw-platform';
export const refs = `${repo}/git/refs`;
export const mergePath = `${pulls}/merge`;

export type ParkedAtShip = {
  readonly item: ItemState;
  readonly ian: Principal;
  readonly kim: Principal;
};

export async function parkedAtShip(db: Database): Promise<ParkedAtShip> {
  const { ian, kim } = await people(db);
  const item = await parkAtShip(kernelOn(db, clock), ian);
  await storedOnTheOldBase(db, item.itemId);
  return { item, ian, kim };
}

function tagPath(itemId: string): string {
  return `${repo}/git/ref/tags/harness/${itemId}`;
}

function mergedPull(itemId: string) {
  const pull = pullBasedOn(itemId, base, '2026-10-02T08:50:00Z');
  return {
    ...pull,
    state: 'closed',
    merged: true,
    merged_at: '2026-10-02T09:00:30Z',
    merge_commit_sha: mergeSha,
  };
}

export function readyToShip(itemId: string): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', pulls, { status: 200, body: pullBasedOn(itemId, base, '2026-10-02T08:50:00Z') });
  reviewedAndGreen(github);
  github.on('PUT', mergePath, { status: 200, body: { sha: mergeSha, merged: true } });
  github.on('POST', refs, { status: 201, body: { ref: `refs/tags/harness/${itemId}` } });
  return github;
}

export function alreadyShipped(itemId: string): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', pulls, { status: 200, body: mergedPull(itemId) });
  github.on('GET', tagPath(itemId), {
    status: 200,
    body: { ref: `refs/tags/harness/${itemId}`, object: { sha: mergeSha, type: 'commit' } },
  });
  return github;
}

export async function gateDeps(github: FixtureGitHub): Promise<PersonDeps> {
  const opened = { app: await fixtureApp(), transport: fixtureTransport(github) };
  return { gateGitHub: () => opened };
}

export function shipWrites(github: FixtureGitHub): string[] {
  return github
    .requests()
    .filter((sent) => sent.method !== 'GET' && !sent.path.endsWith('/access_tokens'))
    .map((sent) => `${sent.method} ${sent.path}`);
}

export async function readyToShipFacts(db: Database, itemId: string) {
  const github = readyToShip(itemId);
  const app = await fixtureApp();
  const logger = createLogger(
    { traceId: crypto.randomUUID(), commit: 'test', route: 'lost', principal: null },
    () => undefined,
  );
  const open = () => createGitHubReads(app, { fetch: github.fetch, now: clock.now });
  return platformGitHubFacts(db, { open, logger }, clock);
}
