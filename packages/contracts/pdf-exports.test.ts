import { describe, expect, it } from 'vitest';
import { errorReasonSchema } from './outcomes.ts';
import {
  binderLimit,
  binderRequestSchema,
  pdfExportKinds,
  pdfExportReplySchema,
  pdfExportStatuses,
  pdfTargetSchema,
} from './pdf-exports.ts';

const pageId = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const pages = (count: number): string[] => Array.from({ length: count }, (_, i) => pageId(i + 1));

describe('#198 the pdf export closed sets', () => {
  it('#198 names the four export kinds and the four export statuses', () => {
    expect([...pdfExportKinds]).toEqual(['page', 'view', 'screen', 'binder']);
    expect([...pdfExportStatuses]).toEqual(['queued', 'ready', 'failed', 'expired']);
  });

  it('#198 adds the five export refusals and reuses not_wired for an unbound renderer', () => {
    const reasons = [
      'pdf_render_failed',
      'export_not_found',
      'export_not_ready',
      'binder_empty',
      'binder_too_large',
      'not_wired',
    ];
    expect(reasons.filter((reason) => !errorReasonSchema.safeParse(reason).success)).toEqual([]);
    expect(errorReasonSchema.safeParse('pdf_not_wired').success).toBe(false);
  });

  it('#198 refuses a person past their daily renders with export_limit_reached', () => {
    expect(errorReasonSchema.safeParse('export_limit_reached').success).toBe(true);
  });
});

describe('#198 a binder request', () => {
  it('#198 takes a titled ordered list of one to fifty pages', () => {
    const title = 'Onboarding';
    expect(binderLimit).toBe(50);
    expect(
      binderRequestSchema.safeParse({ kind: 'binder', title, pageIds: pages(50) }).success,
    ).toBe(true);
    expect(
      binderRequestSchema.safeParse({ kind: 'binder', title, pageIds: pages(51) }).success,
    ).toBe(false);
    expect(binderRequestSchema.safeParse({ kind: 'binder', title, pageIds: [] }).success).toBe(
      false,
    );
    expect(binderRequestSchema.safeParse({ kind: 'binder', pageIds: pages(2) }).success).toBe(
      false,
    );
  });

  it('#198 takes a root page with an optional title, and never both a root and a list', () => {
    expect(binderRequestSchema.safeParse({ kind: 'binder', rootPageId: pageId(1) }).success).toBe(
      true,
    );
    expect(
      binderRequestSchema.safeParse({ kind: 'binder', rootPageId: pageId(1), pageIds: pages(1) })
        .success,
    ).toBe(false);
  });

  it('#198 trims the title and refuses a blank one', () => {
    const parsed = binderRequestSchema.parse({
      kind: 'binder',
      title: '  Handbook ',
      pageIds: pages(1),
    });
    expect(parsed.title).toBe('Handbook');
    expect(
      binderRequestSchema.safeParse({ kind: 'binder', title: '  ', pageIds: pages(1) }).success,
    ).toBe(false);
  });
});

describe('#198 a pdf target', () => {
  it('#198 names a page, a saved view, a binder by list without a title, or a binder by root', () => {
    const targets = [
      { kind: 'page', pageId: pageId(1) },
      { kind: 'view', collection: 'program', viewId: pageId(2) },
      { kind: 'binder', pageIds: pages(3) },
      { kind: 'binder', rootPageId: pageId(4) },
    ];
    expect(targets.filter((target) => !pdfTargetSchema.safeParse(target).success)).toEqual([]);
  });

  it('#198 refuses a screen target, an unknown field and a binder over the limit', () => {
    expect(pdfTargetSchema.safeParse({ kind: 'screen', path: '/wiki' }).success).toBe(false);
    expect(
      pdfTargetSchema.safeParse({ kind: 'page', pageId: pageId(1), email: 'a@b.org' }).success,
    ).toBe(false);
    expect(pdfTargetSchema.safeParse({ kind: 'binder', pageIds: pages(51) }).success).toBe(false);
  });
});

describe('#198 an export reply', () => {
  const ready = {
    exportId: pageId(9),
    status: 'ready',
    file: `/api/exports/${pageId(9)}/file`,
    sourceSha256: 'a'.repeat(64),
    fileSha256: 'b'.repeat(64),
    bytes: 1024,
  };
  const queued = { ...ready, status: 'queued', sourceSha256: null, fileSha256: null, bytes: null };

  it('#198 answers a ready export with its source hash, file hash and size, a queued one with none', () => {
    expect(pdfExportReplySchema.safeParse(ready).success).toBe(true);
    expect(pdfExportReplySchema.safeParse(queued).success).toBe(true);
  });

  it('#198 names the source hash apart from the file hash and never answers a bare sha256', () => {
    const { sourceSha256, ...unnamed } = ready;
    expect(pdfExportReplySchema.safeParse({ ...unnamed, sha256: sourceSha256 }).success).toBe(
      false,
    );
    expect(pdfExportReplySchema.safeParse({ ...ready, fileSha256: undefined }).success).toBe(false);
  });

  it('#198 refuses a short hash, negative bytes and the bytes themselves', () => {
    expect(pdfExportReplySchema.safeParse({ ...ready, sourceSha256: 'abc' }).success).toBe(false);
    expect(pdfExportReplySchema.safeParse({ ...ready, fileSha256: 'abc' }).success).toBe(false);
    expect(pdfExportReplySchema.safeParse({ ...ready, bytes: -1 }).success).toBe(false);
    expect(pdfExportReplySchema.safeParse({ ...ready, contentBase64: 'JVBERi0=' }).success).toBe(
      false,
    );
  });
});
