import { describe, expect, it } from 'vitest';
import { withheldFileNotice, withoutFiles } from './withheld-files.ts';

const kept = '00000000-0000-4000-8000-000000002201';
const hidden = '00000000-0000-4000-8000-000000002202';

describe('#201 a markdown export leaves out the files its channel may not show', () => {
  it('#201 replaces an image or a link to a withheld file and keeps every other', () => {
    const text = `Before.\n\n![Well](/api/files/${hidden})\n\n![Map](/api/files/${kept})\n\n[Release](/api/files/${hidden})`;
    expect(withoutFiles(text, new Set([hidden]))).toBe(
      `Before.\n\n*${withheldFileNotice}*\n\n![Map](/api/files/${kept})\n\n*${withheldFileNotice}*`,
    );
    expect(withoutFiles(text, new Set())).toBe(text);
  });
});
