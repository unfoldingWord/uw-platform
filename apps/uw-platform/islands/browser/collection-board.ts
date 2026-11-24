import { reasonText } from '@uw/ui/components/text.ts';
import { answerOf } from './command-form.ts';

type BoardDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
  readonly afterAccepted: () => void;
};

const ENDPOINT = '/api/collections/commands/move_card';
export const ROW_TYPE = 'application/x-uw-row';

function neighbours(
  column: Element,
  dragged: string,
  y: number,
): { after: string | null; before: string | null } {
  const cards = [...column.querySelectorAll('[data-card]')].filter(
    (card) => card.getAttribute('data-row') !== dragged,
  );
  const below = cards.find((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  const index = below === undefined ? cards.length : cards.indexOf(below);
  return {
    after: cards[index - 1]?.getAttribute('data-row') ?? null,
    before: below?.getAttribute('data-row') ?? null,
  };
}

function say(board: Element, text: string): void {
  const region = board.querySelector('[data-board-outcome]');
  if (region !== null) region.textContent = text;
}

async function drop(
  board: Element,
  column: Element,
  event: DragEvent,
  deps: BoardDeps,
): Promise<void> {
  const rowId = event.dataTransfer?.getData(ROW_TYPE) ?? '';
  if (rowId === '') return;
  const { after, before } = neighbours(column, rowId, event.clientY);
  const body = {
    command: 'move_card',
    requestId: deps.uuid(),
    viewId: board.getAttribute('data-board'),
    rowId,
    group: column.getAttribute('data-group'),
    after,
    before,
  };
  board.setAttribute('aria-busy', 'true');
  const response = await deps
    .fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  const answer =
    response === null ? { status: 'error', reason: 'internal_error' } : await answerOf(response);
  board.removeAttribute('aria-busy');
  say(board, answer.status === 'accepted' ? 'Moved' : reasonText(answer.reason));
  if (answer.status === 'accepted') deps.afterAccepted();
}

export function wireBoards(root: Document, deps: BoardDeps): void {
  root.addEventListener('dragstart', (event) => {
    const card = (event.target as Element | null)?.closest?.('[data-card]');
    if (card === null || card === undefined) return;
    event.dataTransfer?.setData(ROW_TYPE, card.getAttribute('data-row') ?? '');
  });
  root.addEventListener('dragover', (event) => {
    if ((event.target as Element | null)?.closest?.('[data-board] [data-group]'))
      event.preventDefault();
  });
  root.addEventListener('drop', (event) => {
    const column = (event.target as Element | null)?.closest?.('[data-board] [data-group]');
    const board = column?.closest('[data-board]');
    if (column === null || column === undefined || board === null || board === undefined) return;
    event.preventDefault();
    if (board.hasAttribute('aria-busy')) return;
    void drop(board, column, event as DragEvent, deps);
  });
}

function submitWhenFree(form: HTMLFormElement): void {
  if (!form.hasAttribute('aria-busy')) {
    form.requestSubmit();
    return;
  }
  const Watch = form.ownerDocument.defaultView?.MutationObserver;
  if (form.hasAttribute('data-owed') || Watch === undefined) return;
  form.setAttribute('data-owed', '');
  const watcher = new Watch(() => {
    if (form.hasAttribute('aria-busy')) return;
    watcher.disconnect();
    form.removeAttribute('data-owed');
    form.requestSubmit();
  });
  watcher.observe(form, { attributes: true, attributeFilter: ['aria-busy'] });
}

export function wireAutosubmit(root: Document): void {
  root.addEventListener('change', (event) => {
    const form = (event.target as (Element & { readonly form?: HTMLFormElement | null }) | null)
      ?.form;
    if (form === null || form === undefined || !form.hasAttribute('data-autosubmit')) return;
    submitWhenFree(form);
  });
}
