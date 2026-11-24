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

function mayLeave(form: Element | null, typed: boolean, deps: LeaveDeps): boolean {
  if (form === null || form.hasAttribute('data-draft-live')) return true;
  if (!typed && !form.hasAttribute('data-unsaved')) return true;
  return deps.confirm(LEAVE_QUESTION);
}

export function wireLeaveEdit(document: Document, deps: LeaveDeps): void {
  const form = document.querySelector(FORM);
  let typed = false;
  form?.addEventListener('input', () => {
    typed = true;
  });
  document.addEventListener('keydown', (event) => {
    if (!plainEscape(event) || busyIn(event.target)) return;
    const href = document.querySelector<HTMLAnchorElement>(BACK)?.getAttribute('href');
    if (href === null || href === undefined) return;
    event.preventDefault();
    if (mayLeave(form, typed, deps)) deps.go(href);
  });
  document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.(BACK) ?? null;
    if (link === null || mayLeave(form, typed, deps)) return;
    event.preventDefault();
  });
}
