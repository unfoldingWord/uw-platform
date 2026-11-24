const PENCIL = 'main a[aria-label="Edit this page"]';

function typingIn(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null || typeof element.closest !== 'function') return false;
  return (
    element.closest('input, textarea, select, [contenteditable="true"], dialog[open]') !== null
  );
}

export function wireEditKey(document: Document, go: (href: string) => void): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'e' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented || typingIn(event.target)) return;
    const href = document.querySelector<HTMLAnchorElement>(PENCIL)?.getAttribute('href');
    if (href === null || href === undefined) return;
    event.preventDefault();
    go(href);
  });
}
