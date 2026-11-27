import { parse } from 'yaml';
import { z } from 'zod';
import { pageExportModeSchema, type SuggestedChangeInput } from '@uw/contracts';
import { pageVersionHash, type VersionSnapshot } from '../pdf/provenance.ts';
import { changesHash, parseMarked } from './critic.ts';
import { exportSource } from './export.ts';

const stampSchema = z.object({
  source: z.string(),
  exported: z.string(),
  sha256: z.string(),
  changes_sha256: z.string().optional(),
  mode: pageExportModeSchema,
  withheld: z.literal(true).optional(),
  left_out: z.number().int().optional(),
});

type ReadStamp = z.infer<typeof stampSchema>;

export type ReadExport = {
  readonly stamp: ReadStamp;
  readonly title: string | null;
  readonly body: string;
};

const OPEN = '---\n';
const CLOSE = '\n---\n';

function frontOf(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

export function readExport(text: string): ReadExport | null {
  if (!text.startsWith(OPEN)) return null;
  const close = text.indexOf(CLOSE, OPEN.length - 1);
  if (close < 0) return null;
  const front = frontOf(text.slice(OPEN.length, close));
  const stamp = stampSchema.safeParse(front);
  if (!stamp.success) return null;
  const title = z.object({ title: z.string() }).safeParse(front);
  const rest = text.slice(close + CLOSE.length);
  const body = rest.startsWith('\n') ? rest.slice(1) : rest;
  return { stamp: stamp.data, title: title.success ? title.data.title : null, body };
}

export type StoredForExport = {
  readonly snapshot: VersionSnapshot;
  readonly acceptedBody: string;
  readonly marks: readonly SuggestedChangeInput[];
};

type ExportMismatch =
  'unreadable' | 'source_mismatch' | 'hash_mismatch' | 'text_mismatch' | 'changes_mismatch';

export type ExportVerdict =
  { readonly ok: true } | { readonly ok: false; readonly why: ExportMismatch };

function textUnder(read: ReadExport): string {
  return read.stamp.mode === 'marked' ? parseMarked(read.body).original : read.body;
}

function expectedText(read: ReadExport, stored: StoredForExport): string {
  return read.stamp.mode === 'accepted' ? stored.acceptedBody : stored.snapshot.bodyMd;
}

async function changesHold(read: ReadExport, stored: StoredForExport): Promise<boolean> {
  if (read.stamp.mode !== 'marked') return true;
  const expected = await changesHash(stored.marks);
  if (read.stamp.changes_sha256 !== expected) return false;
  return (await changesHash(parseMarked(read.body).changes)) === expected;
}

async function stampHolds(read: ReadExport, snapshot: VersionSnapshot): Promise<ExportVerdict> {
  if (read.stamp.source !== exportSource(snapshot)) return { ok: false, why: 'source_mismatch' };
  if (read.stamp.sha256 !== (await pageVersionHash(snapshot))) {
    return { ok: false, why: 'hash_mismatch' };
  }
  return { ok: true };
}

export async function verifyExport(text: string, stored: StoredForExport): Promise<ExportVerdict> {
  const read = readExport(text);
  if (read === null) return { ok: false, why: 'unreadable' };
  const stamped = await stampHolds(read, stored.snapshot);
  if (!stamped.ok) return stamped;
  const sameTitle = read.title === stored.snapshot.title;
  const sameText = textUnder(read).trimEnd() === expectedText(read, stored).trimEnd();
  if (!sameTitle || !sameText) return { ok: false, why: 'text_mismatch' };
  return (await changesHold(read, stored)) ? { ok: true } : { ok: false, why: 'changes_mismatch' };
}

export type ImportTarget = {
  readonly source: string;
  readonly sha256: string;
  readonly bodyMd: string;
};

type ImportMismatch =
  | 'export_unreadable'
  | 'export_other_page'
  | 'export_earlier_version'
  | 'export_not_marked'
  | 'export_mismatch';

export type MarkedImport =
  | { readonly ok: true; readonly changes: readonly SuggestedChangeInput[] }
  | { readonly ok: false; readonly why: ImportMismatch };

function slugOf(source: string): string {
  return source.slice(0, source.lastIndexOf('@'));
}

function stampRefusal(read: ReadExport, target: ImportTarget): ImportMismatch | null {
  if (read.stamp.mode !== 'marked') return 'export_not_marked';
  if (read.stamp.source !== target.source) {
    const samePage = slugOf(read.stamp.source) === slugOf(target.source);
    return samePage ? 'export_earlier_version' : 'export_other_page';
  }
  return read.stamp.sha256 === target.sha256 ? null : 'export_mismatch';
}

export function importedMarks(text: string, target: ImportTarget): MarkedImport {
  if (!text.startsWith(OPEN)) return { ok: true, changes: parseMarked(text).changes };
  const read = readExport(text);
  if (read === null) return { ok: false, why: 'export_unreadable' };
  const refused = stampRefusal(read, target);
  if (refused !== null) return { ok: false, why: refused };
  const parsed = parseMarked(read.body);
  if (parsed.original.trimEnd() !== target.bodyMd.trimEnd()) {
    return { ok: false, why: 'export_mismatch' };
  }
  return { ok: true, changes: parsed.changes };
}
