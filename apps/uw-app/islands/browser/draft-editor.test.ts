import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireCommandForms } from './command-form.ts';
import { DRAFT_CHECK_MS, wireDraftEditor, type DraftTimers } from './draft-editor.ts';

const harnessId = 'd7000000-0000-4000-8000-000000000001';
const checkId = 'd7000000-0000-4000-8000-000000000002';
const publishRequest = 'd7000000-0000-4000-8000-000000000003';

function row(key: string, id: string, feeds: readonly string[], others: readonly string[]): string {
  const loops = others
    .map(
      (other) =>
        `<label><input type="checkbox" data-loop value="${other}"${feeds.includes(other) ? ' checked' : ''}>${other}</label>`,
    )
    .join('');
  return `<li data-draft-row data-id="${id}" data-key="${key}" data-instructions="" data-validators="">
    <code>${key}</code>
    <button type="button" data-move="up">Move up</button><button type="button" data-move="down">Move down</button><button type="button" data-remove>Remove</button>
    <input name="title" value="${key}"><select name="bracket"><option value="build_package" selected>Build</option></select>
    <select name="exitGate"><option value="checks" selected>Checks</option></select>
    <select name="agentPickup"><option value="allowed" selected>Allowed</option></select>
    <select name="connector"><option value="none" selected>None</option></select>
    <input name="wipLimit" type="number" value="3">
    <fieldset data-loops><legend>Loops back to</legend>${loops}</fieldset>
    <ul data-problems></ul></li>`;
}

function page(): JSDOM {
  const markup = `<section data-draft-editor data-harness="${harnessId}" data-revision="2">
    <p data-draft-status></p><button type="button" data-draft-add>Add stage</button>
    <form data-command="publish_workflow_draft" data-harness="${harnessId}"><input type="hidden" name="revision" value="2" data-draft-revision><button type="submit" data-draft-publish>Publish</button></form>
    <ul data-draft-general></ul>
    <ol data-draft-rows>${row('check', checkId, [], ['ship'])}${row('ship', '', [], ['check'])}</ol>
    <template data-draft-template>${row('new_stage', '', [], [])}</template></section>`;
  return new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://uw.example/' });
}

type Call = { readonly url: string; readonly body: unknown };

function fakeTimers() {
  const waiting = new Map<number, () => void>();
  let next = 0;
  const timers: DraftTimers = {
    setTimeout: (run, ms) => {
      expect(ms).toBe(DRAFT_CHECK_MS);
      next += 1;
      waiting.set(next, run);
      return next;
    },
    clearTimeout: (handle) => waiting.delete(Number(handle)),
  };
  return { timers, waiting, fire: () => [...waiting.values()].forEach((run) => run()) };
}

function recorder(calls: Call[], check: object = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    const answer = url.endsWith('/draft') ? check : { status: 'accepted' };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
}

function wired(check: object) {
  const dom = page();
  const document = dom.window.document;
  const calls: Call[] = [];
  const clock = fakeTimers();
  wireDraftEditor(document, {
    fetch: recorder(calls, check),
    uuid: () => 'r',
    timers: clock.timers,
  });
  return { document, dom, calls, clock };
}

function type(dom: JSDOM, input: Element | null, value: string): void {
  if (input === null) throw new Error('no input');
  (input as HTMLInputElement).value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function savesOncePerPause(): Promise<void> {
  const { document, dom, calls, clock } = wired({ revision: 3, problems: [] });
  const title = document.querySelector('[data-key="check"] [name="title"]');
  for (const value of ['C', 'Ch', 'Check']) type(dom, title, value);
  expect(clock.waiting.size).toBe(1);
  expect(calls).toEqual([]);
  clock.fire();
  await settle();
  expect(calls.map((call) => call.url)).toEqual([
    `/api/harness/${harnessId}/commands/save_workflow_draft`,
    `/api/harness/${harnessId}/draft`,
  ]);
  expect(calls[0]?.body).toMatchObject({
    command: 'save_workflow_draft',
    revision: 2,
    stages: [
      { id: checkId, key: 'check', title: 'Check', wipLimit: 3, feeds: [] },
      { id: null, key: 'ship', title: 'ship' },
    ],
  });
  expect(document.querySelector('[data-draft-revision]')?.getAttribute('value')).toBe('3');
  expect(document.querySelector('[data-draft-publish]')?.hasAttribute('aria-disabled')).toBe(false);
}

async function placesProblems(): Promise<void> {
  const problems = [
    { stage: 'ship', code: 'unknown_loop_target', message: 'Ship loops back to gone.' },
    { stage: null, code: 'no_stages', message: 'A workflow needs at least one stage.' },
  ];
  const { document, dom, clock } = wired({ revision: 3, problems });
  type(dom, document.querySelector('[data-key="ship"] [name="title"]'), 'Ship');
  clock.fire();
  await settle();
  expect(document.querySelector('[data-key="ship"] [data-problems]')?.textContent).toBe(
    'Ship loops back to gone.',
  );
  expect(document.querySelector('[data-draft-general]')?.textContent).toBe(
    'A workflow needs at least one stage.',
  );
  expect(document.querySelector('[data-draft-status]')?.textContent).toBe(
    '2 problems to fix before publishing.',
  );
  expect(document.querySelector('[data-draft-publish]')?.getAttribute('aria-disabled')).toBe(
    'true',
  );
}

async function addsMovesAndRemoves(): Promise<void> {
  const { document, calls, clock } = wired({ revision: 3, problems: [] });
  (document.querySelector('[data-draft-add]') as HTMLButtonElement).click();
  const keys = () =>
    [...document.querySelectorAll<HTMLElement>('[data-draft-rows] > [data-draft-row]')].map(
      (entry) => entry.dataset['key'],
    );
  expect(keys()).toEqual(['check', 'ship', 'stage_1']);
  const loops = [...document.querySelectorAll('[data-key="check"] input[data-loop]')];
  expect(loops.map((loop) => (loop as HTMLInputElement).value)).toEqual(['ship', 'stage_1']);
  (document.querySelector('[data-key="stage_1"] [data-move="up"]') as HTMLButtonElement).click();
  expect(keys()).toEqual(['check', 'stage_1', 'ship']);
  (document.querySelector('[data-key="check"] [data-remove]') as HTMLButtonElement).click();
  expect(keys()).toEqual(['stage_1', 'ship']);
  expect(clock.waiting.size).toBe(1);
  clock.fire();
  await settle();
  expect(calls[0]?.body).toMatchObject({ stages: [{ key: 'stage_1' }, { key: 'ship' }] });
}

async function publishesTheLatestEdit(): Promise<void> {
  const { document, dom, calls, clock } = wired({ revision: 3, problems: [] });
  wireCommandForms(document, {
    fetch: recorder(calls),
    uuid: () => publishRequest,
    afterAccepted: () => {},
  });
  type(dom, document.querySelector('[data-key="check"] [name="title"]'), 'Check it');
  const publish = document.querySelector<HTMLButtonElement>('[data-draft-publish]');
  expect(publish?.getAttribute('aria-disabled')).toBe('true');
  publish?.click();
  await settle();
  await settle();
  expect(clock.waiting.size).toBe(0);
  expect(calls.map((call) => call.url)).toEqual([
    `/api/harness/${harnessId}/commands/save_workflow_draft`,
    `/api/harness/${harnessId}/draft`,
    `/api/harness/${harnessId}/commands/publish_workflow_draft`,
  ]);
  expect(calls[0]?.body).toMatchObject({ stages: [{ title: 'Check it' }, { key: 'ship' }] });
  expect(calls[2]?.body).toMatchObject({ command: 'publish_workflow_draft', revision: 3 });
}

async function holdsPublishWhileProblemsRemain(): Promise<void> {
  const problems = [{ stage: 'ship', code: 'title_blank', message: 'Give ship a title.' }];
  const { document, dom, calls } = wired({ revision: 3, problems });
  wireCommandForms(document, {
    fetch: recorder(calls),
    uuid: () => publishRequest,
    afterAccepted: () => {},
  });
  type(dom, document.querySelector('[data-key="ship"] [name="title"]'), '');
  document.querySelector<HTMLButtonElement>('[data-draft-publish]')?.click();
  await settle();
  await settle();
  expect(calls.map((call) => call.url.split('/').pop())).toEqual(['save_workflow_draft', 'draft']);
}

describe('#103 the draft editor checks the draft a few seconds after the last change', () => {
  it('saves an unsaved edit before Publish, then publishes that revision', publishesTheLatestEdit);

  it(
    'does not publish an unsaved edit that the check finds a problem in',
    holdsPublishWhileProblemsRemain,
  );

  it('saves once after typing stops, not once per key, then asks for the check', savesOncePerPause);

  it('puts each problem on its stage, and turns Publish off while any remain', placesProblems);

  it(
    'adds a stage with a fresh key, offers it as a loop target, and moves and removes rows',
    addsMovesAndRemoves,
  );
});
