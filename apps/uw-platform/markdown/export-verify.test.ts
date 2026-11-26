import { describe, expect, it } from 'vitest';
import type { Page, SuggestedChangeInput } from '@uw/contracts';
import { anchorOf } from '../pages/anchors.ts';
import { pageVersionHash } from '../pdf/provenance.ts';
import { parseMarked } from './critic.ts';
import { exportMarkdown, type ExportRequest } from './export.ts';
import { readExport, verifyExport } from './export-verify.ts';

const PAGE = '00000000-0000-4000-8000-0000000019a1';
const OTHER = '00000000-0000-4000-8000-0000000019a2';
const body = `Two adults are present.\n\n![Rules](/pages/${OTHER})\n\nRecords are kept.`;

const page: Page = {
  id: PAGE,
  type: 'policy',
  jdArea: '00-09',
  slug: 'safeguarding',
  title: 'Safeguarding',
  parentId: null,
  frontmatter: { enforcement: 'required', effective_from: '2026-01-01' },
  bodyMd: body,
  version: 4,
  status: 'active',
};

const snapshot = { ...page, pageId: PAGE };

const sources = () => ({ kind: 'page' as const, title: 'Rules', bodyMd: 'Sign in first.' });

const marks: readonly SuggestedChangeInput[] = [
  { kind: 'replacement', anchor: anchorOf(body, 0, 3), text: 'Three', note: null },
  { kind: 'comment', anchor: anchorOf(body, 4, 10), text: '', note: 'Who counts?' },
];

async function exported(mode: ExportRequest['mode']): Promise<string> {
  const sha256 = await pageVersionHash(snapshot);
  const stamp = { exported: '2026-11-26', sha256, withheld: false };
  return exportMarkdown(page, sources, { mode, stamp, marks: mode === 'marked' ? marks : [] });
}

const acceptedBody = exportMarkdown(page, sources, {
  mode: 'accepted',
  stamp: { exported: '2026-11-26', sha256: '', withheld: false },
  marks: [],
});

async function verdict(text: string) {
  return verifyExport(text, { snapshot, acceptedBody: readExport(acceptedBody)?.body ?? '' });
}

describe('#197 every markdown export is stamped with its source, date, hash and mode', () => {
  it('stamps slug@version, the export date, the sha256 of the stored version and the mode', async () => {
    const read = readExport(await exported('marked'));
    expect(read?.stamp).toEqual({
      source: 'safeguarding@4',
      exported: '2026-11-26',
      sha256: await pageVersionHash(snapshot),
      mode: 'marked',
    });
  });

  it('writes the accepted text with embeds filled in, and the original and marked texts as stored', async () => {
    expect(readExport(await exported('accepted'))?.body).toContain('Sign in first.');
    expect(readExport(await exported('original'))?.body).toBe(body);
    const marked = readExport(await exported('marked'))?.body ?? '';
    expect(marked.startsWith('{~~Two~>Three~~} {==adults==}{>>Who counts?<<} are')).toBe(true);
    expect(parseMarked(marked)).toEqual({ original: body, changes: marks });
  });
});

describe('#197 an export is verified against the stored version', () => {
  it.each(['accepted', 'original', 'marked'] as const)(
    'accepts an untouched %s export',
    async (mode) => {
      expect(await verdict(await exported(mode))).toEqual({ ok: true });
    },
  );

  it('refuses an export whose text was changed', async () => {
    const text = (await exported('accepted')).replace('Two adults', 'One adult');
    expect(await verdict(text)).toEqual({ ok: false, why: 'text_mismatch' });
    const marked = (await exported('marked')).replace('Records are kept.', 'Records are shredded.');
    expect(await verdict(marked)).toEqual({ ok: false, why: 'text_mismatch' });
  });

  it('refuses an export whose hash or source was changed', async () => {
    const text = await exported('original');
    const sha256 = await pageVersionHash(snapshot);
    expect(await verdict(text.replace(sha256, 'b'.repeat(64)))).toEqual({
      ok: false,
      why: 'hash_mismatch',
    });
    expect(await verdict(text.replace('safeguarding@4', 'safeguarding@3'))).toEqual({
      ok: false,
      why: 'source_mismatch',
    });
  });

  it('refuses an export whose stored version has since changed', async () => {
    const text = await exported('original');
    const later = { ...snapshot, bodyMd: `${body}\n\nA later line.` };
    expect(await verifyExport(text, { snapshot: later, acceptedBody: body })).toEqual({
      ok: false,
      why: 'hash_mismatch',
    });
    expect(await verifyExport('No front matter at all.', { snapshot, acceptedBody: body })).toEqual(
      { ok: false, why: 'unreadable' },
    );
  });
});
