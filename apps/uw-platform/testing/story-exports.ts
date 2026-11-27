import { randomUUID } from 'node:crypto';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import type { BrowserBinding, Bindings, FilesBucket } from '../env.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { queueExport } from '../pdf/exports.ts';
import type { PdfRenderer } from '../pdf/renderer.ts';
import { createAccessFixture, fixtureAccessEnv } from './access-keys.ts';
import { fakeBrowser } from './browser.ts';
import { person } from './commands.ts';
import { memoryBucket } from './files.ts';
import { personOn } from './kernel.ts';
import { callTool, httpClient } from './mcp.ts';
import { postgresDeps } from './postgres.ts';
import { levelled, seedStory } from './stories.ts';

const STORY_AREA = '40-49';
const fixture = createAccessFixture();

export type StoryExportWorld = {
  readonly db: Database;
  readonly email: string;
  readonly admin: Principal;
  readonly story: string;
  readonly host: string;
};

export async function storyExportWorld(db: Database): Promise<StoryExportWorld> {
  const made = await person(db, 'story-binder', 'admin', STORY_AREA);
  const admin = await personOn(db, made.id, made.email, new Date());
  const { id: story } = await seedStory(db, STORY_AREA);
  await levelled(db, admin, story, 'newsletter');
  const host = randomUUID();
  await seedPage(db, {
    id: host,
    type: 'knowledge',
    status: 'active',
    jdArea: STORY_AREA,
    slug: `letter-${host.slice(0, 8)}`,
    title: 'Supporter letter',
    bodyMd: `Letter intro.\n\n![The well](/pages/${story})`,
    frontmatter: { jd_category: '41' },
  });
  return { db, email: made.email, admin, story, host };
}

export async function queuedStoryBinder(made: StoryExportWorld, channel = 'newsletter') {
  const request = { kind: 'binder', title: 'Letters', pageIds: [made.host], channel };
  const input = { kind: 'binder' as const, title: 'Letters', reference: 'Letters' };
  const at = new Date();
  const queued = { ...input, areas: [STORY_AREA], request, actor: made.admin, at };
  return (await queueExport(made.db, queued)).exportId;
}

export function exportDeps(
  made: StoryExportWorld,
  renderer: PdfRenderer,
  bucket: FilesBucket = memoryBucket(),
) {
  return {
    db: made.db,
    files: bucketFiles(bucket),
    renderer,
    origin: 'https://app.example.test',
    commit: 'test-commit',
    now: () => new Date(),
  };
}

export function exportEnv(
  bucket: FilesBucket = memoryBucket(),
  browser: BrowserBinding = fakeBrowser(),
): Bindings {
  return {
    ...fixtureAccessEnv,
    FILES: bucket,
    BROWSER: browser,
    PDF_EXPORT: { create: async (options) => ({ id: options.id }) },
  };
}

export async function renderPdfAs(
  made: StoryExportWorld,
  args: Record<string, unknown>,
  env: Bindings,
): Promise<unknown> {
  const keys = await fixture;
  const token = await keys.signForMcp({ email: made.email });
  const app = createApp(postgresDeps(made.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const client = await httpClient(app, headers, env);
  try {
    return (await callTool(client, 'render_pdf', args)).body;
  } finally {
    await client.close();
  }
}
