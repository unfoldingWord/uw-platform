import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pdfExportReplySchema, type Panel, type PdfExportReply } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant, seedGrant } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import type { Bindings, PdfExportStart } from '../env.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { personWith } from '../testing/collections.ts';
import { memoryBucket } from '../testing/files.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import {
  day,
  observe,
  readWorld,
  rewriteBody,
  savedDashboard,
  type Observation,
  type ReadWorld,
} from '../testing/measure-reads.ts';
import { MEASURE_AREA } from '../testing/measure-world.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { runPdfExport } from './export-run.ts';
import { recordingPdf } from './renderer.ts';

const fixture = createAccessFixture();
const HIDDEN_AREA = '60-69';

type Scene = {
  readonly world: ReadWorld;
  readonly env: Bindings;
  readonly started: { readonly id: string; readonly params: PdfExportStart }[];
  readonly email: string;
  readonly hiddenGrant: string;
};

async function requester(db: Database) {
  const made = await personWith(db, 'panel-reader', [{ role: 'editor', area: MEASURE_AREA }]);
  const hiddenGrant = randomUUID();
  await seedGrant(db, {
    id: hiddenGrant,
    personId: made.personId ?? '',
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: HIDDEN_AREA,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  return { email: made.email ?? '', hiddenGrant };
}

async function embeddingProject(world: ReadWorld): Promise<void> {
  const { door43, uw, hidden } = world.sites;
  const scored = new Map<string, Observation>([
    [door43, { score: 60 }],
    [uw, { score: 70 }],
    [hidden, { score: 10 }],
  ]);
  await observe(world, { kind: 'scheduled', at: day(1) }, scored);
  const table: Panel = { kind: 'table', measure: world.measureId, values: [{ value: 'score' }] };
  const dashboardId = await savedDashboard(
    world,
    { kind: 'organization', resource_kind: 'website' },
    [table],
  );
  await rewriteBody(world, world.project, `Our sites.\n\n![All](/pages/${dashboardId})\n`);
}

async function scene(db: Database): Promise<Scene> {
  const world = await readWorld(db);
  await embeddingProject(world);
  const started: Scene['started'] = [];
  const env: Bindings = {
    ...fixtureAccessEnv,
    FILES: memoryBucket(),
    BROWSER: fakeBrowser(),
    PDF_EXPORT: {
      create: async (options) => {
        started.push(options);
        return { id: options.id };
      },
    },
  };
  return { world, env, started, ...(await requester(db)) };
}

async function send(made: Scene, path: string, init: RequestInit = {}): Promise<Response> {
  const keys = await fixture;
  const token = await keys.sign({ email: made.email });
  const headers = { 'cf-access-jwt-assertion': token, ...(init.headers as Record<string, string>) };
  const app = createApp(postgresDeps(made.world.db, keys));
  return app.request(path, { ...init, headers }, made.env);
}

async function renderedPage(made: Scene): Promise<PdfExportReply> {
  const keys = await fixture;
  const token = await keys.signForMcp({ email: made.email });
  const app = createApp(postgresDeps(made.world.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const client = await httpClient(app, headers, made.env);
  try {
    const target = { kind: 'page', pageId: made.world.project };
    return pdfExportReplySchema.parse((await callTool(client, 'render_pdf', { target })).body);
  } finally {
    await client.close();
  }
}

async function renderedBinder(made: Scene, html: string[]): Promise<PdfExportReply> {
  const body = JSON.stringify({ kind: 'binder', title: 'Sites', pageIds: [made.world.project] });
  const headers = { 'content-type': 'application/json' };
  const sent = await send(made, '/api/exports', { method: 'POST', body, headers });
  const reply = pdfExportReplySchema.parse(await sent.json());
  const [started] = made.started;
  if (started === undefined || made.env.FILES === undefined) throw new Error('not started');
  const renderer = recordingPdf();
  const files = bucketFiles(made.env.FILES);
  const deps = {
    db: made.world.db,
    files,
    renderer,
    origin: '',
    commit: 't',
    now: () => new Date(),
  };
  expect(await runPdfExport(deps, started.params)).toBe('ready');
  html.push(renderer.jobs()[0]?.html ?? '');
  return reply;
}

async function refusedOnceTheResourceAreaIsRevoked(
  made: Scene,
  replies: readonly PdfExportReply[],
): Promise<void> {
  for (const reply of replies) expect((await send(made, reply.file)).status).toBe(200);
  await revokeSeededGrant(made.world.db, made.hiddenGrant, new Date(Date.now() - 1_000));
  const project = await send(made, `/pages/${made.world.project}`, {
    headers: { accept: 'text/html' },
  });
  expect(project.status).toBe(200);
  for (const reply of replies) {
    const file = await send(made, reply.file);
    const body = (await file.json()) as Record<string, unknown>;
    expect([file.status, body['reason']]).toEqual([404, 'export_not_found']);
  }
}

async function recordsEveryPanelArea(db: Database): Promise<void> {
  const made = await scene(db);
  const html: string[] = [];
  const page = await renderedPage(made);
  expect(page.status).toBe('ready');
  const binder = await renderedBinder(made, html);
  expect(html[0]).toContain('Hidden site');
  await refusedOnceTheResourceAreaIsRevoked(made, [page, binder]);
}

describe.skipIf(!testServer)('ADR 0036 an export records every area its panels drew from', () => {
  it('refuses a page or binder export once its reader loses a resource area the panels drew', () =>
    withAppDatabase(recordsEveryPanelArea));
});
