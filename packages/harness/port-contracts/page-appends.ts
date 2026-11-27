import type { Principal } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { PageAppend, PageAppends } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type AppendedPage = { readonly bodyMd: string; readonly version: number };
export type PageAppendsSubject = {
  readonly pageAppends: PageAppends;
  readonly area: string;
  addPage(bodyMd: string): Promise<string>;
  page(pageId: string): Promise<AppendedPage | null>;
  person(role: 'editor' | 'viewer'): Promise<Principal>;
};

type Open = () => Promise<PageAppendsSubject>;

const missingPage = 'c7000000-0000-4000-8000-0000000000ff';
let requests = 0;

function requestIdOf(n: number): string {
  return `c7000000-0000-4000-8000-${(0xe00 + n).toString(16).padStart(12, '0')}`;
}

function appendOf(pageId: string, n = 0, request = requestIdOf((requests += 1))): PageAppend {
  return {
    pageId,
    block: `## Meeting ${String(n + 1)}\n\nWe chose the second option.`,
    requestId: request,
    traceId: 'c7000000-0000-4000-8000-0000000000c1',
  };
}

function describeAppends(open: Open): void {
  it('adds the block to the end of the page as the person, as one new version', async () => {
    const subject = await open();
    const pageId = await subject.addPage('# Project notes\n\nKickoff went well.');
    const editor = await subject.person('editor');
    const appended = await subject.pageAppends.append(editor, appendOf(pageId));
    expect(appended).toEqual({ outcome: 'appended', version: 2 });
    expect(await subject.page(pageId)).toEqual({
      bodyMd:
        '# Project notes\n\nKickoff went well.\n\n## Meeting 1\n\nWe chose the second option.',
      version: 2,
    });
  });

  it('adds a repeated request once and answers the same version', async () => {
    const subject = await open();
    const pageId = await subject.addPage('Notes');
    const editor = await subject.person('editor');
    const once = appendOf(pageId);
    const first = await subject.pageAppends.append(editor, once);
    const again = await subject.pageAppends.append(editor, once);
    expect(again).toEqual(first);
    expect((await subject.page(pageId))?.version).toBe(2);
    const next = await subject.pageAppends.append(editor, appendOf(pageId, 1));
    expect(next).toEqual({ outcome: 'appended', version: 3 });
  });
}

function describeRefusals(open: Open): void {
  it('refuses a person who can only read the page, and leaves it as it was', async () => {
    const subject = await open();
    const pageId = await subject.addPage('Notes');
    const viewer = await subject.person('viewer');
    const appended = await subject.pageAppends.append(viewer, appendOf(pageId));
    expect(appended).toEqual({ outcome: 'not_permitted' });
    expect(await subject.page(pageId)).toEqual({ bodyMd: 'Notes', version: 1 });
  });

  it('answers page_not_found for a page that does not exist', async () => {
    const subject = await open();
    const editor = await subject.person('editor');
    await expect(subject.pageAppends.append(editor, appendOf(missingPage))).resolves.toEqual({
      outcome: 'page_not_found',
    });
  });
}

export function describePageAppendsContract(adapter: string, open: Open): void {
  describe(`DX-3 page appends port contract on ${adapter}`, () => {
    describeAppends(open);
    describeRefusals(open);
  });
}

export function describePageAppendsNotWired(adapter: string, pageAppends: PageAppends): void {
  describeNotWired('pageAppends', adapter, pageAppends, {
    append: true,
  } satisfies Record<keyof PageAppends, true>);
}
