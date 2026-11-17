import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireCommandForms } from './command-form.ts';
import { wireNewWorkflow, workflowKey } from './new-workflow.ts';

const ids = [
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000003',
];

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

function wired(markup: string, answers: readonly Response[]) {
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
    return reply;
  }) as typeof globalThis.fetch;
  const uuid = () => {
    const id = ids[next] ?? 'none';
    next += 1;
    return id;
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

async function goesOnWhenTheDraftFails(): Promise<void> {
  const scene = wired(form(), [
    answer(200, { status: 'accepted' }),
    answer(409, { status: 'error', reason: 'draft_held' }),
  ]);
  submit(scene.document);
  await settled();
  expect(scene.went).toEqual([`/harnesses/${ids[0]}`]);
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

  it('still goes to Flow when the draft does not open', goesOnWhenTheDraftFails);

  it('says in plain words why a create was refused, and stays on the page', refusalsInPlainWords);

  it('checks the name and repository before sending anything', checksBeforeSending);

  it('ignores a second submit while the first is sending', ignoresASecondSubmit);
});
