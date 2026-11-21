const BACK = 'a[data-leave-edit]';

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

export function wireLeaveEdit(document: Document, go: (href: string) => void): void {
  document.addEventListener('keydown', (event) => {
    if (!plainEscape(event) || busyIn(event.target)) return;
    const href = document.querySelector<HTMLAnchorElement>(BACK)?.getAttribute('href');
    if (href === null || href === undefined) return;
    event.preventDefault();
    go(href);
  });
}
