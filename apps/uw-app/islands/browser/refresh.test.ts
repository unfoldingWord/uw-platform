import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { morphMain } from './morph.ts';
import { createRefresher } from './refresh.ts';

type Asked = {
  readonly url: string;
  readonly fragment: string | null;
  readonly accept: string | null;
};

function page(main: string): JSDOM {
  return new JSDOM(`<!DOCTYPE html><body><main id="main">${main}</main></body>`, {
    url: 'https://uw.example/harnesses/h/board',
  });
}

function deferred() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function html(text: string): Response {
  return new Response(text, { status: 200, headers: { 'content-type': 'text/html' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function morphsTheFragment(): Promise<void> {
  const dom = page('<p>old</p>');
  const asked: Asked[] = [];
  const morphed: string[] = [];
  const refresher = createRefresher({
    document: dom.window.document,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      asked.push({
        url: String(input),
        fragment: headers.get('x-uw-fragment'),
        accept: headers.get('accept'),
      });
      return html('<p>new</p>');
    }) as typeof fetch,
    morph: (target, text) => {
      morphed.push(`${target.id}:${text}`);
    },
  });
  await refresher.refresh();
  expect(asked).toEqual([
    { url: 'https://uw.example/harnesses/h/board', fragment: 'main', accept: 'text/html' },
  ]);
  expect(morphed).toEqual(['main:<p>new</p>']);
}

async function newerWins(): Promise<void> {
  const dom = page('<p>old</p>');
  const answers = [deferred(), deferred()];
  let call = 0;
  const morphed: string[] = [];
  const refresher = createRefresher({
    document: dom.window.document,
    fetch: (async () => (answers[call++] ?? deferred()).promise) as typeof fetch,
    morph: (_target, text) => {
      morphed.push(text);
    },
  });
  const first = refresher.refresh();
  const second = refresher.refresh();
  const third = refresher.refresh();
  answers[1]?.resolve(html('newer'));
  await second;
  answers[0]?.resolve(html('older'));
  await Promise.all([first, third]);
  expect(call).toBe(2);
  expect(morphed).toEqual(['newer']);
}

async function dirtyFormSurvives(): Promise<void> {
  const dom = page(
    '<form data-command="reject" data-dirty><textarea name="findings"></textarea></form><p>3 findings</p>',
  );
  const { window } = dom;
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('DOMParser', window.DOMParser);
  vi.stubGlobal('Node', window.Node);
  vi.stubGlobal('Element', window.Element);
  vi.stubGlobal('Document', window.Document);
  const textarea = window.document.querySelector('textarea');
  if (textarea !== null) textarea.value = 'Fix the copy';
  const refresher = createRefresher({
    document: window.document,
    fetch: (async () =>
      html(
        '<form data-command="reject"><textarea name="findings"></textarea></form><p>4 findings</p>',
      )) as typeof fetch,
    morph: morphMain,
  });
  await refresher.refresh();
  expect(window.document.querySelector('textarea')?.value).toBe('Fix the copy');
  expect(window.document.querySelector('form')?.hasAttribute('data-dirty')).toBe(true);
  expect(window.document.querySelector('p')?.textContent).toBe('4 findings');
}

describe('the fragment refresh', () => {
  it('a refresh asks for the main fragment and morphs it in', morphsTheFragment);
  it('an older answer never replaces a newer one', newerWins);
  it('a dirty form survives a refresh', dirtyFormSurvives);
});
