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

async function queuedAfterTheFlight(): Promise<void> {
  const dom = page('<p>old</p>');
  const answers = [deferred(), deferred(), deferred()];
  const log: string[] = [];
  let call = 0;
  const morphed: string[] = [];
  const refresher = createRefresher({
    document: dom.window.document,
    fetch: (async () => {
      log.push(`fetch ${call + 1}`);
      return (answers[call++] ?? deferred()).promise;
    }) as typeof fetch,
    morph: (_target, text) => {
      morphed.push(text);
    },
  });
  const first = refresher.refresh();
  log.push('trigger after the first fetch');
  const second = refresher.refresh();
  const third = refresher.refresh();
  expect(call).toBe(1);
  answers[0]?.resolve(html('before the change'));
  await first;
  await Promise.resolve();
  expect(call).toBe(2);
  answers[1]?.resolve(html('after the change'));
  await Promise.all([second, third]);
  expect(log).toEqual(['fetch 1', 'trigger after the first fetch', 'fetch 2']);
  expect(morphed).toEqual(['before the change', 'after the change']);
  expect(call).toBe(2);
}

async function failedFlightStillQueues(): Promise<void> {
  const dom = page('<p>old</p>');
  let call = 0;
  const morphed: string[] = [];
  const failing = deferred();
  const refresher = createRefresher({
    document: dom.window.document,
    fetch: (async () => {
      call += 1;
      if (call === 1) return failing.promise;
      return html('after');
    }) as typeof fetch,
    morph: (_target, text) => {
      morphed.push(text);
    },
  });
  const first = refresher.refresh();
  const queued = refresher.refresh();
  failing.resolve(new Response('no', { status: 500 }));
  await Promise.all([first, queued]);
  expect(call).toBe(2);
  expect(morphed).toEqual(['after']);
  await refresher.refresh();
  expect(call).toBe(3);
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
  it(
    'a trigger during a refresh sends exactly one more request after it settles',
    queuedAfterTheFlight,
  );
  it('a refresh that fails still sends the one queued after it', failedFlightStillQueues);
  it('a dirty form survives a refresh', dirtyFormSurvives);
});
