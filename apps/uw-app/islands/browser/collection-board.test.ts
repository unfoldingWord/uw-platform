import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ROW_TYPE, wireAutosubmit, wireBoards } from './collection-board.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function autosubmitPage() {
  const dom = new JSDOM(
    '<form data-autosubmit data-command="set_property"><select name="value"><option>a</option><option>b</option></select></form>',
  );
  const document = dom.window.document;
  const form = document.querySelector('form');
  const select = document.querySelector('select');
  if (form === null || select === null) throw new Error('no form');
  let submits = 0;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submits += 1;
  });
  wireAutosubmit(document);
  const change = () => select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  return { form, change, submits: () => submits };
}

async function keepsAChangeMadeWhileSaving() {
  const { form, change, submits } = autosubmitPage();
  change();
  expect(submits()).toBe(1);
  form.setAttribute('aria-busy', 'true');
  change();
  change();
  expect(submits()).toBe(1);
  form.removeAttribute('aria-busy');
  await tick();
  expect(submits()).toBe(2);
}

function boardPage() {
  const dom = new JSDOM(
    '<div data-board="v1"><p data-board-outcome></p><section data-group="done"><div data-cards><article data-card data-row="a"></article></div></section></div>',
  );
  return { dom, document: dom.window.document };
}

function dropped(dom: JSDOM, data: Readonly<Record<string, string>>) {
  const event = new dom.window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { getData: (type: string) => data[type] ?? '' },
  });
  Object.defineProperty(event, 'clientY', { value: -1 });
  return event;
}

async function movesTheDroppedRow() {
  const { dom, document } = boardPage();
  const sent: unknown[] = [];
  wireBoards(document, {
    fetch: (_input, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Promise.resolve(Response.json({ status: 'error', reason: 'wip_limit_reached' }));
    },
    uuid: () => '00000000-0000-4000-8000-000000000001',
    afterAccepted: () => undefined,
  });
  const column = document.querySelector('[data-group]');
  column?.dispatchEvent(dropped(dom, { 'text/plain': 'a link someone dragged' }));
  column?.dispatchEvent(dropped(dom, { [ROW_TYPE]: 'r1' }));
  await tick();
  await tick();
  expect(sent).toEqual([
    expect.objectContaining({
      command: 'move_card',
      viewId: 'v1',
      rowId: 'r1',
      group: 'done',
      after: null,
      before: 'a',
    }),
  ]);
  expect(document.querySelector('[data-board-outcome]')?.textContent).toBe('Wip limit reached');
}

describe('#206 inline edits submit on change', () => {
  it(
    'sends a change made while a save is in flight once the first settles',
    keepsAChangeMadeWhileSaving,
  );
});

describe('#206 dragging a card onto a board column', () => {
  it(
    'moves only a dragged row, between its new neighbours, and shows a refusal in place',
    movesTheDroppedRow,
  );
});
