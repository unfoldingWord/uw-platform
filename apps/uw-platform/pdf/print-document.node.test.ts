import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { fontFiles } from '@uw/ui/generated/fonts';
import { markBase64 } from '@uw/ui/generated/mark';
import { printColours } from '@uw/ui/generated/app-css';
import { binderBody, printJob, type PrintInput } from './print-document.ts';
import type { Provenance } from './provenance.ts';

const FILE = '/api/files/1b2c3d4e-5f60-4718-89ab-cdef01234567';
const GONE = '/api/files/9b2c3d4e-5f60-4718-89ab-cdef01234567';
const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

const provenance: Provenance = {
  source: 'https://app.example.org/collections/tasks/views/v1?month=2026-11',
  reference: 'tasks/Open tasks',
  filters: ['status is open', 'month = 2026-11'],
  exportedBy: 'reader@example.org',
  exportedOn: '2026-11-24',
  sha256: SHA,
};

const body = [
  '<h1>Security <em>guidelines</em></h1>',
  '<script>alert(1)</script>',
  '<form action="/api/pages"><input name="q"><button>Send</button></form>',
  '<div data-pdf-hidden>Edit controls</div>',
  `<p><img src="${FILE}" alt="Door diagram"><img src="${GONE}" alt="Lost picture"></p>`,
  '<p>See <a href="https://example.org/guide">the guide</a> and <a href="/pages/abc">the page</a>.</p>',
  '<p>Again <a href="https://example.org/guide">the guide</a>, and <a href="#top">the top</a>.</p>',
].join('');

function input(overrides: Partial<PrintInput> = {}): PrintInput {
  return {
    title: 'Security <guidelines>',
    bodyHtml: body,
    provenance,
    origin: 'https://app.example.org',
    image: async (src) => (src === FILE ? PIXEL : null),
    ...overrides,
  };
}

async function printed(overrides: Partial<PrintInput> = {}) {
  const job = await printJob(input(overrides));
  return { job, document: new JSDOM(job.html).window.document };
}

const texts = (nodes: Iterable<Element>): string[] =>
  [...nodes].map((node) => node.textContent?.trim() ?? '');

describe('#198 the print document is one self-contained HTML file', () => {
  it('#198 inlines the app stylesheet with every font as a data URI and links nothing', async () => {
    const { document } = await printed();
    const css = [...document.querySelectorAll('style')].map((style) => style.textContent).join('');
    expect(css).toContain('[data-pdf-provenance]');
    expect(css).not.toContain('url(/assets/');
    for (const font of fontFiles) {
      expect(css).toContain(`url(data:font/woff2;base64,${font.base64})`);
    }
    expect(document.querySelectorAll('link, script')).toHaveLength(0);
    expect(document.title).toBe('Security <guidelines>');
  });

  it('#198 removes scripts, forms and anything marked data-pdf-hidden', async () => {
    const { document } = await printed();
    expect(document.querySelectorAll('script, form, input, [data-pdf-hidden]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('alert(1)');
    expect(document.body.textContent).not.toContain('Edit controls');
    expect(document.querySelector('h1')?.textContent).toBe('Security guidelines');
  });

  it('#198 inlines a readable file image and prints the alt text of one it may not read', async () => {
    const asked: string[] = [];
    const image = async (src: string): Promise<string | null> => {
      asked.push(src);
      return src === FILE ? PIXEL : null;
    };
    const { document } = await printed({ image });
    expect(asked).toEqual([FILE, GONE]);
    expect([...document.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      PIXEL,
    ]);
    expect(document.body.textContent).toContain('Lost picture');
    expect(document.body.innerHTML).not.toContain(GONE);
  });
});

describe('#198 the print document footnotes its links and closes with its provenance', () => {
  it('#198 numbers every outside or app link once and lists their absolute addresses', async () => {
    const { document } = await printed();
    expect(texts(document.querySelectorAll('sup[data-footnote]'))).toEqual(['1', '2', '1']);
    const links = document.querySelector('[data-pdf-links]');
    expect(links?.querySelector('h2')?.textContent).toBe('Links');
    expect(texts(links?.querySelectorAll('li') ?? [])).toEqual([
      'https://example.org/guide',
      'https://app.example.org/pages/abc',
    ]);
    const hrefs = [...document.querySelectorAll('main a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://app.example.org/pages/abc');
    expect(hrefs).toContain('#top');
  });

  it('#198 prints no links block when the body links nowhere', async () => {
    const { document } = await printed({ bodyHtml: '<p>Plain</p>' });
    expect(document.querySelector('[data-pdf-links]')).toBeNull();
    expect(document.querySelector('[data-pdf-provenance]')).not.toBeNull();
  });

  it('#198 closes with a provenance block naming every field, the full hash and the filters', async () => {
    const { document } = await printed();
    const block = document.querySelector('[data-pdf-provenance]');
    const said = block?.textContent ?? '';
    expect(block?.querySelector('h2')?.textContent).toBe('Provenance');
    for (const value of [
      provenance.source,
      provenance.reference,
      provenance.exportedBy,
      provenance.exportedOn,
      ...provenance.filters,
    ]) {
      expect(said).toContain(value);
    }
    expect(block?.querySelector('[data-hash]')?.textContent).toBe(SHA);
    const order = [...document.querySelectorAll('[data-pdf-links], [data-pdf-provenance]')];
    expect(order.map((node) => node.hasAttribute('data-pdf-provenance'))).toEqual([false, true]);
  });

  it('#198 says there were no filters when none were used', async () => {
    const { document } = await printed({ provenance: { ...provenance, filters: [] } });
    expect(document.querySelector('[data-pdf-provenance]')?.textContent).toContain('None');
  });
});

describe('#198 the running header and footer of a print job', () => {
  it('#198 heads every page with the brand mark and the escaped title', async () => {
    const { job } = await printed();
    expect(job.header).toContain(`data:image/png;base64,${markBase64}`);
    expect(job.header).toContain('Security &lt;guidelines&gt;');
    expect(job.header).not.toContain('<guidelines>');
    expect(job.title).toBe('Security <guidelines>');
  });

  it('#198 foots every page with the short provenance line and the page count', async () => {
    const { job } = await printed();
    expect(job.footer).toContain(`tasks/Open tasks · 2026-11-24 · sha256:${SHA.slice(0, 12)}`);
    expect(job.footer).not.toContain(SHA);
    expect(job.footer).toContain('<span class="pageNumber"></span>');
    expect(job.footer).toContain('<span class="totalPages"></span>');
    expect(job.footer).toContain(printColours.muted);
  });

  it('#198 writes no colour or size literal of its own', async () => {
    for (const file of ['./print-document.ts', './print-templates.ts', './print-html.ts']) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/);
      expect(source).not.toMatch(/\b(?:rgba?|hsla?|oklch)\(/);
      expect(source).not.toMatch(/\d(?:px|rem|em|mm|pt)\b/);
    }
  });
});

describe('#198 a binder body', () => {
  const sections = [
    { title: 'First <page>', reference: '01-09/first@v2', html: '<p>One</p>' },
    { title: 'Second page', reference: '01-09/second@v1', html: '<p>Two</p>' },
  ];
  const cover = {
    title: 'Board packet',
    exportedBy: 'reader@example.org',
    exportedOn: '2026-11-24',
  };

  it('#198 opens with a cover, then contents linking to each section in order', () => {
    const { document } = new JSDOM(binderBody(sections, cover)).window;
    expect(document.querySelector('[data-pdf-cover] h1')?.textContent).toBe('Board packet');
    expect(document.querySelector('[data-pdf-cover]')?.textContent).toContain('reader@example.org');
    expect(document.querySelector('[data-pdf-cover]')?.textContent).toContain('2026-11-24');
    const contents = [...document.querySelectorAll('[data-pdf-contents] ol a')];
    expect(texts(contents)).toEqual(['First <page>', 'Second page']);
    const parts = [...document.querySelectorAll('[data-pdf-section]')];
    expect(contents.map((a) => a.getAttribute('href'))).toEqual(parts.map((part) => `#${part.id}`));
    expect(texts(parts.map((part) => part.querySelector('h1') ?? part))).toEqual([
      'First <page>',
      'Second page',
    ]);
    expect(parts.map((part) => part.textContent)).toEqual([
      expect.stringContaining('01-09/first@v2'),
      expect.stringContaining('01-09/second@v1'),
    ]);
  });

  it('#198 footnotes no contents anchor when the binder is printed', async () => {
    const job = await printJob(input({ bodyHtml: binderBody(sections, cover) }));
    const { document } = new JSDOM(job.html).window;
    expect(document.querySelectorAll('sup[data-footnote]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-pdf-section]')).toHaveLength(2);
  });
});
