import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireCommandForms } from './command-form.ts';
import { wireNewWorkflow, workflowKey } from './new-workflow.ts';

const idOf = (n: number): string => `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = [idOf(1), idOf(2), idOf(3), idOf(4), idOf(5)];

type Reply = Response | 'lost';

type Sent = { readonly url: string; readonly body: Readonly<Record<string, unknown>> };

function form(repository = ''): string {
  return `<form data-command="activate_template" data-new-workflow method="post" action="#">
    <input name="title" value="Translation Helps — Review">
    <select name="jdArea"><option value="80-89" selected>80-89</option></select>
    <input type="radio" name="template" value="software">
    <input type="radio" name="template" value="bml" checked>
    <input name="repository" value="${repository}">
    <button type="submit">Create and open in Flow</button>
    <p data-outcome role="status"></p></form>`;
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function wired(markup: string, answers: readonly Reply[]) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://uw.example/' });
  const document = dom.window.document;
  const sent: Sent[] = [];
  const went: string[] = [];
  let next = 0;
  let replies = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const reply = answers[replies] ?? answer(200, { status: 'accepted' });
    replies += 1;
    if (reply === 'lost') throw new TypeError('network connection lost');
    return reply;
  }) as typeof globalThis.fetch;
  const uuid = () => {
    next += 1;
    return idOf(next);
  };
  let refreshed = 0;
  wireCommandForms(document, { fetch, uuid, afterAccepted: () => (refreshed += 1) });
  wireNewWorkflow(document, { fetch, uuid, go: (href) => went.push(href) });
  return { document, sent, went, refreshed: () => refreshed };
}

function submit(document: Document): void {
  const event = new document.defaultView!.SubmitEvent('submit', {
    bubbles: true,
    cancelable: true,
  });
  document.querySelector('form')?.dispatchEvent(event);
}

async function settled(): Promise<void> {
  for (let n = 0; n < 8; n += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function outcome(document: Document): string | null | undefined {
  return document.querySelector('[data-outcome]')?.textContent;
}

function makesAKey(): void {
  expect(workflowKey('Translation Helps — Review')).toBe('translation-helps-review');
  expect(workflowKey('  --BML 2: the flywheel!! ')).toBe('bml-2-the-flywheel');
  expect(workflowKey('x'.repeat(90))).toHaveLength(60);
  expect(workflowKey('日本語')).toBe('');
}

async function createsOpensAndGoes(): Promise<void> {
  const scene = wired(form(' unfoldingWord/helps '), []);
  submit(scene.document);
  await settled();
  expect(scene.sent.map((sent) => sent.url)).toEqual([
    `/api/harness/${ids[0]}/commands/activate_template`,
    `/api/harness/${ids[0]}/commands/open_workflow_draft`,
  ]);
  expect(scene.sent[0]?.body).toEqual({
    command: 'activate_template',
    requestId: ids[1],
    harnessKey: 'translation-helps-review',
    title: 'Translation Helps — Review',
    jdArea: '80-89',
    template: 'bml',
    repository: 'unfoldingWord/helps',
  });
  expect(scene.sent[1]?.body).toEqual({ command: 'open_workflow_draft', requestId: ids[2] });
  expect(scene.went).toEqual([`/harnesses/${ids[0]}`]);
  expect(scene.refreshed()).toBe(0);
}

async function blankRepositoryIsNull(): Promise<void> {
  const scene = wired(form(), []);
  submit(scene.document);
  await settled();
  expect(scene.sent[0]?.body['repository']).toBeNull();
}

function urls(scene: ReturnType<typeof wired>): readonly string[] {
  return scene.sent.map((sent) => sent.url.split('/commands/')[1] ?? '');
}

function fieldsLocked(document: Document): boolean {
  return document.querySelector('input[name="title"]')?.hasAttribute('disabled') ?? false;
}

async function replaysALostCreate(): Promise<void> {
  const scene = wired(form(), ['lost', answer(200, { status: 'accepted' })]);
  submit(scene.document);
  await settled();
  expect(outcome(scene.document)).toContain('We couldn’t tell whether the workflow was created');
  expect(fieldsLocked(scene.document)).toBe(true);
  expect(scene.went).toEqual([]);
  submit(scene.document);
  await settled();
  expect(urls(scene)).toEqual(['activate_template', 'activate_template', 'open_workflow_draft']);
  expect(scene.sent[1]?.url).toBe(scene.sent[0]?.url);
  expect(scene.sent[1]?.body).toEqual(scene.sent[0]?.body);
  expect(scene.went).toEqual([`/harnesses/${ids[0]}`]);
}

async function staysWhenTheDraftDoesNotOpen(): Promise<void> {
  const scene = wired(form(), [
    answer(200, { status: 'accepted' }),
    answer(409, { status: 'error', reason: 'draft_held' }),
  ]);
  submit(scene.document);
  await settled();
  expect(scene.went).toEqual([]);
  expect(outcome(scene.document)).toContain(
    'Your workflow was created, but its draft didn’t open (Draft held)',
  );
  const link = scene.document.querySelector('[data-outcome] a');
  expect([link?.getAttribute('href'), link?.textContent]).toEqual([
    `/harnesses/${ids[0]}`,
    'open its Flow tab',
  ]);
  expect(fieldsLocked(scene.document)).toBe(true);
  submit(scene.document);
  await settled();
  expect(urls(scene)).toEqual(['activate_template', 'open_workflow_draft', 'open_workflow_draft']);
  expect(scene.sent[2]?.url).toBe(scene.sent[1]?.url);
  expect(scene.sent[2]?.body['requestId']).not.toBe(scene.sent[1]?.body['requestId']);
  expect(scene.went).toEqual([`/harnesses/${ids[0]}`]);
}

async function replaysALostDraftOpen(): Promise<void> {
  const scene = wired(form(), [answer(200, { status: 'accepted' }), 'lost']);
  submit(scene.document);
  await settled();
  expect(scene.went).toEqual([]);
  submit(scene.document);
  await settled();
  expect(urls(scene)).toEqual(['activate_template', 'open_workflow_draft', 'open_workflow_draft']);
  expect(scene.sent[2]?.body).toEqual(scene.sent[1]?.body);
  expect(scene.went).toEqual([`/harnesses/${ids[0]}`]);
}

async function aRefusalStartsAfresh(): Promise<void> {
  const scene = wired(form(), [answer(409, { status: 'error', reason: 'harness_exists' })]);
  submit(scene.document);
  await settled();
  expect(fieldsLocked(scene.document)).toBe(false);
  submit(scene.document);
  await settled();
  expect(scene.sent[1]?.url).not.toBe(scene.sent[0]?.url);
  expect(scene.sent[1]?.body['requestId']).not.toBe(scene.sent[0]?.body['requestId']);
}

async function refusalsInPlainWords(): Promise<void> {
  const reasons = [
    ['harness_exists', 'A workflow with this name or repository already exists.'],
    ['not_permitted', 'You’re not an admin of that area.'],
    ['rate_limited', 'Rate limited'],
  ] as const;
  for (const [reason, words] of reasons) {
    const scene = wired(form(), [answer(409, { status: 'error', reason })]);
    submit(scene.document);
    await settled();
    expect(outcome(scene.document)).toBe(words);
    expect(scene.went).toEqual([]);
    expect(scene.document.querySelector('form')?.hasAttribute('aria-busy')).toBe(false);
  }
}

async function checksBeforeSending(): Promise<void> {
  const scene = wired(form('not a repo'), []);
  submit(scene.document);
  await settled();
  expect(scene.sent).toEqual([]);
  expect(outcome(scene.document)).toBe('Check the name, and give the repository as owner/name.');
}

async function ignoresASecondSubmit(): Promise<void> {
  const scene = wired(form(), []);
  submit(scene.document);
  submit(scene.document);
  await settled();
  expect(scene.sent).toHaveLength(2);
  expect(scene.went).toHaveLength(1);
}

describe('#111 the New workflow form', () => {
  it('makes a lowercase hyphenated key from the name', makesAKey);

  it(
    'creates the workflow under a new id, opens its draft and goes to its Flow tab',
    createsOpensAndGoes,
  );

  it('sends no repository when the field is blank', blankRepositoryIsNull);

  it(
    'resends the same create after a lost response, so it cannot make a second workflow',
    replaysALostCreate,
  );

  it(
    'stays on the page with a link to Flow when the draft does not open, and retries only the draft',
    staysWhenTheDraftDoesNotOpen,
  );

  it('resends the same draft open after a lost response', replaysALostDraftOpen);

  it('starts a new create, with new ids, after a refusal', aRefusalStartsAfresh);

  it('says in plain words why a create was refused, and stays on the page', refusalsInPlainWords);

  it('checks the name and repository before sending anything', checksBeforeSending);

  it('ignores a second submit while the first is sending', ignoresASecondSubmit);
});
