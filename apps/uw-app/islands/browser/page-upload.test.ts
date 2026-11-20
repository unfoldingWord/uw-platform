import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { markdownFor, wirePageUpload } from './page-upload.ts';

const PAGE = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
const FILE = '00000000-0000-4000-8000-00000000f11e';

const markup = `
  <form>
    <textarea name="bodyMd">Before. After.</textarea>
    <div data-upload data-page="${PAGE}">
      <input type="file" data-upload-input />
      <p data-upload-status></p>
    </div>
  </form>`;

type Rig = {
  readonly dom: JSDOM;
  readonly sent: { url: string; type: string | null; size: number }[];
};

function rig(answer: () => Response): Rig {
  const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://uw.example/' });
  const sent: Rig['sent'] = [];
  wirePageUpload(dom.window.document, {
    uuid: () => FILE,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      const body = init?.body as { size?: number } | undefined;
      sent.push({ url: String(input), type: headers.get('content-type'), size: body?.size ?? 0 });
      return answer();
    },
  });
  return { dom, sent };
}

function choose(made: Rig, name: string, type: string): void {
  const { window } = made.dom;
  const input = window.document.querySelector<HTMLInputElement>('[data-upload-input]');
  if (input === null) throw new Error('no input');
  const file = new window.File(['abc'], name, { type });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const stored = (name: string, contentType: string) =>
  Response.json({
    status: 'accepted',
    file: { id: FILE, name, contentType, url: `/api/files/${FILE}` },
  });

describe('#175 a chosen file is uploaded and placed in the text', () => {
  it('writes a picture as an image and anything else as a link', () => {
    expect(markdownFor({ name: 'index.png', contentType: 'image/png', url: '/api/files/1' })).toBe(
      '![index.png](/api/files/1)',
    );
    expect(
      markdownFor({ name: 'plan [v2].pdf', contentType: 'application/pdf', url: '/api/files/2' }),
    ).toBe('[plan \\[v2\\].pdf](/api/files/2)');
  });

  it('sends the file to the page it belongs to and adds it where the cursor was', async () => {
    const made = rig(() => stored('shot.png', 'image/png'));
    const area = made.dom.window.document.querySelector<HTMLTextAreaElement>('textarea');
    area?.setSelectionRange(8, 8);
    choose(made, 'shot.png', 'image/png');
    await settled();
    expect(made.sent).toEqual([
      { url: `/api/files/${FILE}?page=${PAGE}&name=shot.png`, type: 'image/png', size: 3 },
    ]);
    expect(area?.value).toBe(`Before. ![shot.png](/api/files/${FILE}) After.`);
    const status = made.dom.window.document.querySelector('[data-upload-status]');
    expect(status?.textContent).toBe('Added shot.png. Save the page to keep it.');
  });

  it('says why in place when an upload is refused, and leaves the text alone', async () => {
    const made = rig(() =>
      Response.json({ status: 'error', reason: 'file_type_not_allowed' }, { status: 415 }),
    );
    choose(made, 'page.html', 'text/html');
    await settled();
    const { document } = made.dom.window;
    expect(document.querySelector('textarea')?.value).toBe('Before. After.');
    expect(document.querySelector('[data-upload-status]')?.textContent).toBe(
      'Not added: this kind of file cannot be stored here.',
    );
  });
});
