import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { harnessCommandSchemas } from '@uw/contracts';
import { commandBody } from './command-body.ts';
import { OUTCOME_TEXT, wireCommandForms } from './command-form.ts';

const harnessId = 'c7000000-0000-4000-8000-000000000001';
const itemId = 'c7000000-0000-4000-8000-000000000002';
const requestId = 'c7000000-0000-4000-8000-000000000003';
const head = 'a'.repeat(40);

type Sent = { readonly url: string; readonly body: unknown; readonly busy: string | null };

function page(markup: string): JSDOM {
  return new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://uw.example/' });
}

function claimForm(): string {
  return `<form data-command="claim" data-harness="${harnessId}" method="post" action="#"><input type="hidden" name="itemId" value="${itemId}"><input name="note"><button type="submit">Claim</button><p data-outcome role="status"></p></form>`;
}

function gateForm(): string {
  return `<form data-command="decide" data-harness="${harnessId}" method="post" action="#"><input type="hidden" name="itemId" value="${itemId}"><input type="hidden" name="head" value="${head}"><button type="submit" name="decision" value="approve" aria-disabled="true">Approve</button><button type="submit" name="decision" value="take_over">Take over</button><p data-outcome role="status"></p></form>`;
}

function wired(dom: JSDOM, answer: () => Promise<Response>) {
  const sent: Sent[] = [];
  let accepted = 0;
  const document = dom.window.document;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const form = document.querySelector('form');
    sent.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      busy: form?.getAttribute('aria-busy') ?? null,
    });
    return answer();
  }) as typeof fetch;
  wireCommandForms(document, {
    fetch: fetcher,
    uuid: () => requestId,
    afterAccepted: () => (accepted += 1),
  });
  return { sent, document, accepted: () => accepted };
}

function submit(document: Document, submitter?: Element | null): void {
  const form = document.querySelector('form');
  const event = new document.defaultView!.SubmitEvent('submit', {
    bubbles: true,
    cancelable: true,
    submitter: (submitter ?? null) as HTMLElement | null,
  });
  form?.dispatchEvent(event);
}

async function settled(): Promise<void> {
  for (let n = 0; n < 5; n += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function outcomeOf(document: Document): string {
  return document.querySelector('[data-outcome]')?.textContent ?? '';
}

async function busyThenAccepted(): Promise<void> {
  const dom = page(claimForm());
  const run = wired(dom, async () => Response.json({ status: 'accepted', requestId }));
  submit(run.document, run.document.querySelector('button'));
  expect(run.document.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  expect(run.document.querySelector('button')?.getAttribute('aria-disabled')).toBe('true');
  await settled();
  expect(run.sent).toEqual([
    {
      url: `/api/harness/${harnessId}/commands/claim`,
      body: { command: 'claim', requestId, itemId },
      busy: 'true',
    },
  ]);
  expect(outcomeOf(run.document)).toBe(OUTCOME_TEXT['claim']);
  expect(run.document.querySelector('form')?.hasAttribute('aria-busy')).toBe(false);
  expect(run.document.querySelector('button')?.hasAttribute('aria-disabled')).toBe(false);
  expect(run.accepted()).toBe(1);
}

async function refusalInPlace(): Promise<void> {
  const dom = page(claimForm());
  const run = wired(dom, async () =>
    Response.json({ status: 'error', requestId, reason: 'lease_held' }, { status: 409 }),
  );
  submit(run.document, run.document.querySelector('button'));
  await settled();
  expect(outcomeOf(run.document)).toBe('Lease held');
  expect(run.accepted()).toBe(0);
  const broken = wired(page(claimForm()), async () => new Response('<html>', { status: 502 }));
  submit(broken.document, broken.document.querySelector('button'));
  await settled();
  expect(outcomeOf(broken.document)).toBe('Internal error');
}

async function submitterNamesCommand(): Promise<void> {
  const dom = page(gateForm());
  const run = wired(dom, async () => Response.json({ status: 'accepted', requestId }));
  const [approve, takeOver] = [...run.document.querySelectorAll('button')];
  submit(run.document, approve);
  await settled();
  expect(run.sent).toEqual([]);
  expect(approve?.getAttribute('aria-disabled')).toBe('true');
  submit(run.document, takeOver);
  await settled();
  expect(run.sent.map((sent) => [sent.url, sent.body])).toEqual([
    [`/api/harness/${harnessId}/commands/take_over`, { command: 'take_over', requestId, itemId }],
  ]);
  expect(approve?.getAttribute('aria-disabled')).toBe('true');
}

async function dirtyCleared(): Promise<void> {
  const dom = page(claimForm());
  const run = wired(dom, async () => Response.json({ status: 'accepted', requestId }));
  const input = run.document.querySelector('input[name="note"]');
  input?.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  expect(run.document.querySelector('form')?.hasAttribute('data-dirty')).toBe(true);
  submit(run.document, run.document.querySelector('button'));
  await settled();
  expect(run.document.querySelector('form')?.hasAttribute('data-dirty')).toBe(false);
}

describe('the command form island', () => {
  it(
    'the form goes busy before the request and shows the accepted outcome in place',
    busyThenAccepted,
  );
  it('a refusal shows its closed-set reason on the form that refused', refusalInPlace);
  it(
    'a gate form sends the command its submitter names, and a refused submitter sends nothing',
    submitterNamesCommand,
  );
  it('an edited form is marked dirty and cleared after its outcome', dirtyCleared);
});

describe('the command bodies', () => {
  it('commandBody builds each of the eight bodies and refuses a malformed one', () => {
    const bodies = {
      enqueue: commandBody('enqueue', { title: 'Draw the icon' }, requestId),
      reorder: commandBody('reorder', { itemId, beforeItemId: '' }, requestId),
      claim: commandBody('claim', { itemId }, requestId),
      release: commandBody('release', { itemId }, requestId),
      approve: commandBody('approve', { itemId, head }, requestId),
      reject: commandBody(
        'reject',
        { itemId, findings: ' Fix the copy \n\n  Add a test  \n ' },
        requestId,
      ),
      take_over: commandBody('take_over', { itemId }, requestId),
      override: commandBody(
        'override',
        { itemId, head: '', reason: 'The reviewer is away' },
        requestId,
      ),
    };
    for (const [name, body] of Object.entries(bodies)) {
      const schema = new Map(Object.entries(harnessCommandSchemas)).get(name);
      expect(schema?.safeParse(body).success, name).toBe(true);
    }
    expect(bodies.reorder).toMatchObject({ beforeItemId: null });
    expect(bodies.reject).toMatchObject({ findings: ['Fix the copy', 'Add a test'] });
    expect(bodies.override).toMatchObject({ head: null });
    expect(bodies.enqueue).toEqual({
      command: 'enqueue',
      requestId,
      title: 'Draw the icon',
      pageId: null,
      due: null,
    });
    expect(commandBody('enqueue', { title: '' }, requestId)).toBeNull();
    expect(commandBody('claim', { itemId: 'not-an-id' }, requestId)).toBeNull();
    expect(commandBody('stop_run', { itemId }, requestId)).toBeNull();
  });
});
