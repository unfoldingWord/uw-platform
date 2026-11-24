import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const person = '00000000-0000-4000-8000-0000001980a1';
const createdAt = '2026-11-24T09:00:00.000Z';
const expiresAt = '2026-12-01T09:00:00.000Z';
const hash = 'a'.repeat(64);

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type ExportRow = {
  readonly id: string;
  readonly kind?: string;
  readonly status?: string;
  readonly requestedBy?: string;
  readonly r2Key?: string | null;
  readonly sourceSha256?: string | null;
  readonly fileSha256?: string | null;
  readonly bytes?: number | null;
  readonly failure?: string | null;
  readonly finishedAt?: string | null;
  readonly expiresAt?: string;
};

function hashesOf(row: ExportRow) {
  return { source: row.sourceSha256 ?? null, file: row.fileSha256 ?? null };
}

function addExport(db: AnyDatabase, row: ExportRow) {
  const hashed = hashesOf(row);
  return db.execute(sql`INSERT INTO pdf_exports
      (id, kind, status, title, reference, requested_by, person_id, areas, request,
       r2_key, source_sha256, file_sha256, bytes, failure, created_at, finished_at, expires_at)
    VALUES (${row.id}, ${row.kind ?? 'binder'}, ${row.status ?? 'queued'}, 'Handbook',
      '01-09/handbook@v3', ${row.requestedBy ?? `human:${person}`}, ${person},
      ARRAY['00-09', '10-19']::text[], '{"kind":"binder"}'::jsonb,
      ${row.r2Key ?? null}, ${hashed.source}, ${hashed.file},
      ${row.bytes ?? null}, ${row.failure ?? null},
      ${createdAt}::timestamptz, ${row.finishedAt ?? null}::timestamptz,
      ${row.expiresAt ?? expiresAt}::timestamptz)`);
}

const ready = {
  status: 'ready',
  r2Key: 'exports/x.pdf',
  sourceSha256: hash,
  fileSha256: hash,
  bytes: 1024,
  finishedAt: createdAt,
};

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'pdf-exporter@example.org' });
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

const refusals: readonly (readonly [string, Partial<ExportRow>, string])[] = [
  ['an unknown kind', { kind: 'letter' }, 'pdf_exports_kind_known'],
  ['an unknown status', { status: 'printing' }, 'pdf_exports_status_known'],
  [
    'a requester that is not an identity',
    { requestedBy: 'somebody' },
    'pdf_exports_requested_by_identity',
  ],
  [
    'a source sha256 that is not hex',
    { ...ready, sourceSha256: 'not-a-hash' },
    'pdf_exports_source_sha256_form',
  ],
  [
    'a file sha256 that is not hex',
    { ...ready, fileSha256: 'not-a-hash' },
    'pdf_exports_file_sha256_form',
  ],
  [
    'a ready export with no file hash',
    { ...ready, fileSha256: null },
    'pdf_exports_ready_has_file',
  ],
  ['a negative size', { ...ready, bytes: -1 }, 'pdf_exports_bytes_counted'],
  ['a ready export with no file', { status: 'ready' }, 'pdf_exports_ready_has_file'],
  ['a failed export with no reason', { status: 'failed' }, 'pdf_exports_failed_has_reason'],
  ['a free-text failure', { status: 'failed', failure: 'Error: boom' }, 'pdf_exports_failure_form'],
  [
    'an expiry before creation',
    { expiresAt: '2026-11-23T09:00:00.000Z' },
    'pdf_exports_expires_after_creation',
  ],
];

function rowRules(db: () => AnyDatabase): void {
  it('#198 records a queued binder, a ready page and a failed view', async () => {
    await addExport(db(), { id: '00000000-0000-4000-8000-0000001980b1' });
    await addExport(db(), { id: '00000000-0000-4000-8000-0000001980b2', kind: 'page', ...ready });
    await addExport(db(), {
      id: '00000000-0000-4000-8000-0000001980b3',
      kind: 'view',
      status: 'failed',
      failure: 'pdf_render_failed',
      finishedAt: createdAt,
    });
  });

  it.each(refusals)('#198 refuses %s', async (_name, change, constraint) => {
    const row = { id: '00000000-0000-4000-8000-0000001980b9', ...change };
    expect(await refusal(addExport(db(), row))).toEqual({ code: '23514', constraint });
  });
}

describe('#198 the pdf_exports table logs every async or agent export', () => {
  it('#198 declares pdf_exports internal and never offline', () => {
    expect(declarationOf(schema.pdfExports)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => rowRules(openDatabase(target)),
  );
});
