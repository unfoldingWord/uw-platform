import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { REVEAL_SHOWN_MS, wireReveal } from './reveal.ts';

const credentialId = 'c1590000-0000-4000-8000-000000000001';
const requestId = 'c1590000-0000-4000-8000-000000000002';
const value = 'uw-planted-reveal-value-159';

type Sent = {
  readonly url: string;
  readonly init: RequestInit;
  readonly busy: string | null;
  readonly quiet: string | null;
};

function page(): JSDOM {
  const form = `<form data-reveal="${credentialId}" method="post" action="#"><button type="submit">Reveal the value</button><button type="button" data-reveal-hide hidden>Hide the value</button><p data-outcome role="status"></p><pre data-revealed hidden></pre></form>`;
  return new JSDOM(`<!DOCTYPE html><body><main id="main">${form}</main></body>`, {
    url: 'https://uw.example/credentials/x',
  });
}

function accepted(): Response {
  return new Response(JSON.stringify({ status: 'accepted', requestId, value }), { status: 200 });
}

function refusedWith(reason: string): Response {
  return new Response(JSON.stringify({ status: 'error', requestId, reason }), { status: 403 });
}

function wired(dom: JSDOM, answer: () => Promise<Response>) {
  const document = dom.window.document;
  const sent: Sent[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const form = document.querySelector('form');
    sent.push({
      url: String(input),
      init: init ?? {},
      busy: form?.getAttribute('aria-busy') ?? null,
      quiet: form?.querySelector('button[type="submit"]')?.getAttribute('aria-disabled') ?? null,
    });
    return answer();
  }) as typeof fetch;
  wireReveal(document, {
    fetch: fetcher,
    uuid: () => requestId,
    timers: {
      setTimeout: (run, ms) => {
        const timer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        const found = timers.find((timer) => timer === handle);
        if (found !== undefined) found.cleared = true;
      },
    },
  });
  return { document, sent, timers, window: dom.window };
}

function submit(document: Document): void {
  const form = document.querySelector('form');
  const event = new document.defaultView!.SubmitEvent('submit', {
    bubbles: true,
    cancelable: true,
  });
  form?.dispatchEvent(event);
}

async function settled(): Promise<void> {
  for (let n = 0; n < 5; n += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const shown = (document: Document) => document.querySelector('[data-revealed]');
const outcome = (document: Document) => document.querySelector('[data-outcome]')?.textContent;

type Run = ReturnType<typeof wired>;

const leaving: Readonly<Record<'hide' | 'timer' | 'pagehide', (run: Run) => void>> = {
  hide: (run) => {
    const hide = run.document.querySelector('[data-reveal-hide]');
    hide?.dispatchEvent(new run.window.MouseEvent('click', { bubbles: true }));
    expect(run.timers[0]?.cleared).toBe(true);
  },
  timer: (run) => run.timers[0]?.run(),
  pagehide: (run) => run.window.dispatchEvent(new run.window.Event('pagehide')),
};

describe('#159 revealing a value in the browser', () => {
  it('goes busy before it asks, posts the credential in the body, and shows the value only as text', async () => {
    const run = wired(page(), async () => accepted());
    submit(run.document);
    expect(run.document.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    await settled();
    expect(run.sent).toHaveLength(1);
    expect(run.sent[0]).toMatchObject({
      url: '/api/credentials/reveal',
      busy: 'true',
      quiet: 'true',
    });
    expect(run.sent[0]?.init).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(JSON.parse(String(run.sent[0]?.init.body))).toEqual({
      command: 'reveal_credential',
      requestId,
      credentialId,
    });
    expect(shown(run.document)?.textContent).toBe(value);
    expect(shown(run.document)?.hasAttribute('hidden')).toBe(false);
    expect(run.document.querySelector('[data-reveal-hide]')?.hasAttribute('hidden')).toBe(false);
    expect(run.document.querySelector('form')?.hasAttribute('aria-busy')).toBe(false);
    const withoutText = run.document.documentElement.outerHTML.replace(`>${value}<`, '><');
    expect(withoutText).not.toContain(value);
    expect(run.window.location.href).toBe('https://uw.example/credentials/x');
    expect(run.window.localStorage.length + run.window.sessionStorage.length).toBe(0);
  });
});

describe('#159 a reveal that is refused, and a value that is forgotten', () => {
  it('shows a refusal in place by its reason and shows no value', async () => {
    const run = wired(page(), async () => refusedWith('key_service_not_configured'));
    submit(run.document);
    await settled();
    expect(outcome(run.document)).toBe('Key service not configured');
    expect(shown(run.document)?.textContent).toBe('');
    expect(shown(run.document)?.hasAttribute('hidden')).toBe(true);
  });

  it('says so when the request never reaches the platform', async () => {
    const run = wired(page(), () => Promise.reject(new Error('offline')));
    submit(run.document);
    await settled();
    expect(outcome(run.document)).toBe('Internal error');
    expect(shown(run.document)?.textContent).toBe('');
  });

  it.each(['hide', 'timer', 'pagehide'] as const)('forgets the value on %s', async (leave) => {
    const run = wired(page(), async () => accepted());
    submit(run.document);
    await settled();
    expect(shown(run.document)?.textContent).toBe(value);
    expect(run.timers.map((timer) => timer.ms)).toEqual([REVEAL_SHOWN_MS]);
    leaving[leave](run);
    expect(shown(run.document)?.textContent).toBe('');
    expect(shown(run.document)?.hasAttribute('hidden')).toBe(true);
    expect(run.document.documentElement.outerHTML).not.toContain(value);
  });
});

describe('#159 a reveal that is overtaken', () => {
  it('does not show an answer that arrives after you left the page', async () => {
    let release: (response: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const run = wired(page(), () => held);
    submit(run.document);
    await settled();
    run.window.dispatchEvent(new run.window.Event('pagehide'));
    release(accepted());
    await settled();
    expect(shown(run.document)?.textContent).toBe('');
    expect(run.document.documentElement.outerHTML).not.toContain(value);
  });

  it('asks once while it is busy', async () => {
    let release: (response: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const run = wired(page(), () => held);
    submit(run.document);
    submit(run.document);
    await settled();
    expect(run.sent).toHaveLength(1);
    release(accepted());
    await settled();
    expect(shown(run.document)?.textContent).toBe(value);
  });
});
