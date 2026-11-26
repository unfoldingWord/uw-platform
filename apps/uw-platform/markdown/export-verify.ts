import { parse } from 'yaml';
import { z } from 'zod';
import { pageExportModeSchema } from '@uw/contracts';
import { pageVersionHash, type VersionSnapshot } from '../pdf/provenance.ts';
import { parseMarked } from './critic.ts';
import { exportSource } from './export.ts';

const stampSchema = z.object({
  source: z.string(),
  exported: z.string(),
  sha256: z.string(),
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
};

export type ExportVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly why: 'unreadable' | 'source_mismatch' | 'hash_mismatch' | 'text_mismatch';
    };

function textUnder(read: ReadExport): string {
  return read.stamp.mode === 'marked' ? parseMarked(read.body).original : read.body;
}

function expectedText(read: ReadExport, stored: StoredForExport): string {
  return read.stamp.mode === 'accepted' ? stored.acceptedBody : stored.snapshot.bodyMd;
}

export async function verifyExport(text: string, stored: StoredForExport): Promise<ExportVerdict> {
  const read = readExport(text);
  if (read === null) return { ok: false, why: 'unreadable' };
  if (read.stamp.source !== exportSource(stored.snapshot)) {
    return { ok: false, why: 'source_mismatch' };
  }
  if (read.stamp.sha256 !== (await pageVersionHash(stored.snapshot))) {
    return { ok: false, why: 'hash_mismatch' };
  }
  const sameTitle = read.title === stored.snapshot.title;
  const sameText = textUnder(read).trimEnd() === expectedText(read, stored).trimEnd();
  return sameTitle && sameText ? { ok: true } : { ok: false, why: 'text_mismatch' };
}
