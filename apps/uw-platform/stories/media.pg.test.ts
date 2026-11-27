import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { memoryFiles } from '../pages/file-store.ts';
import { storeFile } from '../pages/files.ts';
import { getRaw, person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { consentFor, levelled, photoStory, seedStory } from '../testing/stories.ts';
import { recordStoryConsent, setStoryMediaLevel } from './levels.ts';
import { fileMayAppear } from './media.ts';

const AREA = '40-49';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type World = {
  readonly db: Database;
  readonly email: string;
  readonly admin: Principal;
  readonly story: string;
  readonly photo: string;
};

async function world(db: Database): Promise<World> {
  const made = await person(db, 'story-photographer', 'admin', AREA);
  const admin = await personOn(db, made.id, made.email, new Date());
  const photo = randomUUID();
  const { id: story } = await seedStory(db, AREA, photoStory(photo));
  const upload = {
    fileId: photo,
    pageId: story,
    name: 'reading.png',
    contentType: 'image/png',
    bytes: PNG,
  };
  const stored = await storeFile(db, memoryFiles(), { actor: admin, at: new Date() }, upload);
  if (!stored.ok) throw new Error('photo not stored');
  await levelled(db, admin, story, 'public');
  return { db, email: made.email, admin, story, photo };
}

function mediaTo(world: World, level: 'internal' | 'public') {
  return {
    command: 'set_story_media_level',
    requestId: randomUUID(),
    pageId: world.story,
    fileId: world.photo,
    level,
  } as const;
}

async function fileKeepsItsOwnLevel(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  expect(await fileMayAppear(db, made.photo, 'platform', at)).toBe(true);
  expect(await fileMayAppear(db, made.photo, 'public', at)).toBe(false);
  const open = await getRaw(db, made.email, `/api/pages/${made.story}/export?channel=public`);
  const text = await open.text();
  expect(text).toContain('Di Example at the reading.');
  expect(text).not.toContain(`/api/files/${made.photo}`);
  expect(await setStoryMediaLevel(db, made.admin, mediaTo(made, 'public'), at)).toEqual({
    ok: true,
  });
  expect(await fileMayAppear(db, made.photo, 'public', at)).toBe(true);
  const shown = await getRaw(db, made.email, `/api/pages/${made.story}/export?channel=public`);
  expect(await shown.text()).toContain(`/api/files/${made.photo}`);
}

async function photoNeedsItsRelease(db: Database): Promise<void> {
  const made = await world(db);
  const at = new Date();
  const noPhoto = consentFor(made.story, { photoRelease: false, photoReference: null });
  expect(await recordStoryConsent(db, made.admin, noPhoto, at)).toEqual({ ok: true });
  expect(await setStoryMediaLevel(db, made.admin, mediaTo(made, 'public'), at)).toEqual({
    ok: false,
    reason: 'photo_release_required',
  });
  expect(await fileMayAppear(db, made.photo, 'public', at)).toBe(false);
}

describe.skipIf(!testServer)('#201 each file of a story carries its own level', () => {
  it('#201 a public story keeps an internal photograph out of a public export until its own level is raised', () =>
    withAppDatabase(fileKeepsItsOwnLevel));
  it('#201 a photograph is raised only with a photo release', () =>
    withAppDatabase(photoNeedsItsRelease));
});
