import type {
  ErrorReason,
  RecordStoryConsentCommand,
  SetStoryLevelCommand,
  SetStoryMediaLevelCommand,
  SensitivityLevel,
  StoryUse,
  WithdrawStoryConsentCommand,
} from '@uw/contracts';
import { raisesLevel } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { administers, freshPerson } from '../measures/authority.ts';
import { consentRefusal, keepConsent, markWithdrawn } from './consent.ts';
import { dropMediaLevels, fileOfStory, keepMediaLevel, mediaLevelOf } from './media.ts';
import { keepLevel, levelOf, lockedStoryPage, type StoryPage } from './story-pages.ts';
import { storyUsesOf } from './uses.ts';

export type StoryOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };
export type WithdrawalOutcome =
  | { readonly ok: true; readonly uses: readonly StoryUse[] }
  | { readonly ok: false; readonly reason: ErrorReason };

const accepted = { ok: true } as const;

class StoryRefused extends Error {
  constructor(readonly reason: ErrorReason) {
    super(reason);
  }
}

function writes(actor: Principal, story: StoryPage, at: Date): boolean {
  return can(actor, 'write', { kind: 'area', area: story.jdArea }, at);
}

async function readableStory(tx: Transaction, actor: Principal, pageId: string, at: Date) {
  const story = await lockedStoryPage(tx, pageId);
  if (story === null || !can(actor, 'read', { kind: 'area', area: story.jdArea }, at)) {
    throw new StoryRefused('page_not_found');
  }
  return story;
}

async function mayRaise(
  tx: Transaction,
  actor: Principal,
  story: StoryPage,
  at: Date,
  photo: boolean,
): Promise<void> {
  const fresh = await freshPerson(tx, actor, at);
  if (fresh === null || !administers(fresh, story.jdArea, at)) {
    throw new StoryRefused('not_permitted');
  }
  const refused = await consentRefusal(tx, story.id, at, photo);
  if (refused !== null) throw new StoryRefused(refused);
}

async function refusedOr<T extends { readonly ok: true }>(
  work: () => Promise<T>,
): Promise<T | { readonly ok: false; readonly reason: ErrorReason }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StoryRefused) return { ok: false, reason: error.reason };
    throw error;
  }
}

async function moveTo(
  tx: Transaction,
  actor: Principal,
  story: StoryPage,
  moving: { readonly from: SensitivityLevel; readonly to: SensitivityLevel; readonly at: Date },
  photo: boolean,
): Promise<void> {
  if (raisesLevel(moving.from, moving.to)) {
    await mayRaise(tx, actor, story, moving.at, photo);
  } else if (!writes(actor, story, moving.at)) {
    throw new StoryRefused('not_permitted');
  }
}

export function setStoryLevel(
  db: Database,
  actor: Principal,
  command: SetStoryLevelCommand,
  at: Date,
): Promise<StoryOutcome> {
  return refusedOr(() =>
    db.transaction(async (tx) => {
      const story = await readableStory(tx, actor, command.pageId, at);
      const from = await levelOf(tx, story.id);
      await moveTo(tx, actor, story, { from, to: command.level, at }, false);
      await keepLevel(tx, story.id, command.level, actor.identity, at);
      return accepted;
    }),
  );
}

export function setStoryMediaLevel(
  db: Database,
  actor: Principal,
  command: SetStoryMediaLevelCommand,
  at: Date,
): Promise<StoryOutcome> {
  return refusedOr(() =>
    db.transaction(async (tx) => {
      const story = await readableStory(tx, actor, command.pageId, at);
      if (!(await fileOfStory(tx, story.id, command.fileId))) {
        throw new StoryRefused('file_not_found');
      }
      const from = await mediaLevelOf(tx, command.fileId);
      await moveTo(tx, actor, story, { from, to: command.level, at }, true);
      await keepMediaLevel(tx, { story: story.id, file: command.fileId }, command.level, {
        by: actor.identity,
        at,
      });
      return accepted;
    }),
  );
}

export function recordStoryConsent(
  db: Database,
  actor: Principal,
  command: RecordStoryConsentCommand,
  at: Date,
): Promise<StoryOutcome> {
  return refusedOr(() =>
    db.transaction(async (tx) => {
      const story = await readableStory(tx, actor, command.pageId, at);
      if (actor.kind !== 'person' || !writes(actor, story, at)) {
        throw new StoryRefused('not_permitted');
      }
      await keepConsent(tx, command, actor.identity, at);
      return accepted;
    }),
  );
}

export function withdrawStoryConsent(
  db: Database,
  actor: Principal,
  command: WithdrawStoryConsentCommand,
  at: Date,
): Promise<WithdrawalOutcome> {
  return refusedOr(() =>
    db.transaction(async (tx) => {
      const story = await readableStory(tx, actor, command.pageId, at);
      if (!writes(actor, story, at)) throw new StoryRefused('not_permitted');
      await markWithdrawn(tx, story.id, actor.identity, at);
      await keepLevel(tx, story.id, 'internal', actor.identity, at);
      await dropMediaLevels(tx, story.id, { by: actor.identity, at });
      return { ok: true as const, uses: await storyUsesOf(tx, story.id) };
    }),
  );
}
