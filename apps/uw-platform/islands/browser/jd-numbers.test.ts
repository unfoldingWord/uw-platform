import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireJdNumbers } from './jd-numbers.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const index = {
  entries: [
    {
      id: 'a',
      title: '00.27 Holiday calendar',
      type: 'knowledge',
      jdArea: '00-09',
      jdId: null,
      aliases: [],
    },
    {
      id: 'b',
      title: 'Strategic Intents',
      type: 'knowledge',
      jdArea: '00-09',
      jdId: '01.12',
      aliases: [],
    },
    {
      id: 'c',
      title: '00.05 Colleague Directory',
      type: 'knowledge',
      jdArea: '00-09',
      jdId: '00.05',
      aliases: [],
    },
  ],
};

function page(title = '', category = '') {
  const html = `<form data-jd-numbered>
    <input name="title" value="${title}">
    <div data-jd-suggest>
      <p data-jd-status></p>
      <button type="button" data-jd-use hidden>Use</button>
      <ul data-jd-matches hidden></ul>
      <template data-jd-row><li><a><span data-number></span> <span data-title></span></a></li></template>
    </div>
    <input name="category" value="${category}">
  </form>`;
  const dom = new JSDOM(html);
  return dom.window;
}

async function wired(title = '', category = '') {
  const window = page(title, category);
  const sent: string[] = [];
  wireJdNumbers(window.document, {
    fetch: (input) => {
      sent.push(String(input));
      return Promise.resolve(Response.json(index));
    },
  });
  await tick();
  const field = (name: string) =>
    window.document.querySelector<HTMLInputElement>(`input[name="${name}"]`) as HTMLInputElement;
  const type = (name: string, value: string) => {
    field(name).value = value;
    field(name).dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  return { document: window.document, field, type, sent };
}

describe('a new page keeps its title number and its category in step', () => {
  it('sets the category from a number typed at the start of the title', async () => {
    const made = await wired('', '01');
    made.type('title', '00.31 My page');
    expect(made.field('category').value).toBe('00');
    expect(made.sent).toEqual(['/api/pages/index']);
  });

  it('puts the next free number of a chosen category on the title', async () => {
    const made = await wired('My page', '');
    made.type('category', '00');
    expect(made.field('title').value).toBe('00.28 My page');
    made.type('category', '01');
    expect(made.field('title').value).toBe('01.13 My page');
  });

  it('says when a number is taken, by which page, and offers the next free one', async () => {
    const made = await wired();
    made.type('title', '00.27 My page');
    const status = made.document.querySelector('[data-jd-status]')?.textContent;
    expect(status).toBe('00.27 is already used by 00.27 Holiday calendar.');
    const use = made.document.querySelector<HTMLButtonElement>('[data-jd-use]');
    expect(use?.hidden).toBe(false);
    expect(use?.textContent).toBe('Use 00.28');
    use?.click();
    expect(made.field('title').value).toBe('00.28 My page');
    expect(made.document.querySelector('[data-jd-status]')?.textContent).toBe('00.28 is free.');
    expect(use?.hidden).toBe(true);
  });

  it('lists pages whose number or title matches what is typed, each a link to it', async () => {
    const made = await wired();
    made.type('title', '00.');
    const links = [...made.document.querySelectorAll('[data-jd-matches] a')];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      '00.05 Colleague Directory',
      '00.27 Holiday calendar',
    ]);
    expect(links[0]?.getAttribute('href')).toBe('/pages/c');
    made.type('title', 'strat');
    const named = [...made.document.querySelectorAll('[data-jd-matches] a')];
    expect(named.map((link) => link.getAttribute('href'))).toEqual(['/pages/b']);
    expect(named[0]?.textContent?.trim()).toBe('01.12 Strategic Intents');
    made.type('title', '');
    expect(made.document.querySelector<HTMLElement>('[data-jd-matches]')?.hidden).toBe(true);
  });
});

function editing(title: string) {
  const html = `<form data-jd-numbered data-jd-category="00" data-page-id="a">
    <input name="title" value="${title}">
    <div data-jd-suggest>
      <p data-jd-status></p>
      <button type="button" data-jd-use hidden>Use</button>
      <ul data-jd-matches hidden></ul>
      <template data-jd-row><li><a><span data-number></span> <span data-title></span></a></li></template>
    </div>
  </form>`;
  return new JSDOM(html).window;
}

describe('an existing page keeps its title number in its own category', () => {
  it('never counts the page itself as a clash, and offers the next free number when taken', async () => {
    const window = editing('00.27 Holiday calendar');
    wireJdNumbers(window.document, { fetch: () => Promise.resolve(Response.json(index)) });
    await tick();
    const title = window.document.querySelector<HTMLInputElement>('input[name="title"]');
    const status = () => window.document.querySelector('[data-jd-status]')?.textContent;
    title?.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(status()).toBe('00.27 is free.');
    if (title !== null) title.value = '00.05 Holiday calendar';
    title?.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(status()).toBe('00.05 is already used by 00.05 Colleague Directory.');
    expect(window.document.querySelector('[data-jd-use]')?.textContent).toBe('Use 00.06');
  });

  it('says a number from another category needs a move, and offers one in its own', async () => {
    const window = editing('01.40 Holiday calendar');
    wireJdNumbers(window.document, { fetch: () => Promise.resolve(Response.json(index)) });
    await tick();
    const status = window.document.querySelector('[data-jd-status]')?.textContent;
    expect(status).toBe(
      '01.40 belongs in category 01. This page is in 00; move it to change that.',
    );
    window.document.querySelector<HTMLButtonElement>('[data-jd-use]')?.click();
    const title = window.document.querySelector<HTMLInputElement>('input[name="title"]');
    expect(title?.value).toBe('00.06 Holiday calendar');
  });
});
