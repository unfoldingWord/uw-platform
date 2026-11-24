import { plainClick } from './navigating.ts';

const BACK = 'a[data-leave-edit]';
const FORM = 'form[data-page-edit]';

export const LEAVE_QUESTION =
  'Leave without saving? What you typed is not in a shared draft, so it will be lost.';

export type LeaveDeps = {
  readonly go: (href: string) => void;
  readonly confirm: (question: string) => boolean;
};

function busyIn(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null || typeof element.closest !== 'function') return false;
  return (
    element.closest('input, textarea, select, [contenteditable="true"], dialog[open]') !== null
  );
}

function plainEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  return !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
}

function guardDeparture(form: Element, deps: LeaveDeps) {
  let dirty = form.hasAttribute('data-unsaved');
  let allowed = false;
  let save: Event | null = null;
  const title = form.querySelector<HTMLInputElement>('input[name="title"]');
  const needsPrompt = () =>
    title?.value !== title?.defaultValue || (dirty && !form.hasAttribute('data-draft-live'));
  form.addEventListener('input', () => {
    dirty = true;
    allowed = false;
    save = null;
  });
  form.addEventListener('submit', (event) => {
    save = event;
  });
  form.ownerDocument.defaultView?.addEventListener('beforeunload', (event) => {
    if (needsPrompt() && !allowed && save?.defaultPrevented !== false) event.preventDefault();
    allowed = false;
    save = null;
  });
  return () => {
    allowed = !needsPrompt() || deps.confirm(LEAVE_QUESTION);
    return allowed;
  };
}

export function wireLeaveEdit(document: Document, deps: LeaveDeps): void {
  const form = document.querySelector(FORM);
  if (form === null) return;
  const mayLeave = guardDeparture(form, deps);
  document.addEventListener('keydown', (event) => {
    if (!plainEscape(event) || busyIn(event.target)) return;
    const href = document.querySelector<HTMLAnchorElement>(BACK)?.getAttribute('href');
    if (href === null || href === undefined) return;
    event.preventDefault();
    if (mayLeave()) deps.go(href);
  });
  document.addEventListener('click', (event) => {
    if (!plainClick(event)) return;
    const link = (event.target as Element | null)?.closest?.(BACK) ?? null;
    if (link !== null && !mayLeave()) event.preventDefault();
  });
}
