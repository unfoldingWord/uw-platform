const NAVIGATING = 'data-navigating';

function plainClick(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function linkOf(
  event: MouseEvent,
  view: NonNullable<Document['defaultView']>,
): HTMLAnchorElement | null {
  if (!(event.target instanceof view.Element)) return null;
  const link = event.target.closest('a[href]');
  return link instanceof view.HTMLAnchorElement ? link : null;
}

function sameTab(link: HTMLAnchorElement): boolean {
  return !link.hasAttribute('download') && (link.target === '' || link.target === '_self');
}

function anotherPage(link: HTMLAnchorElement, document: Document): boolean {
  const here = new URL(document.location.href);
  const there = new URL(link.href, here);
  if (there.origin !== here.origin) return false;
  return there.pathname !== here.pathname || there.search !== here.search;
}

function leavingLink(event: MouseEvent, document: Document): boolean {
  const view = document.defaultView;
  if (view === null || !plainClick(event)) return false;
  const link = linkOf(event, view);
  return link !== null && sameTab(link) && anotherPage(link, document);
}

export function wireNavigating(document: Document): void {
  const root = document.documentElement;
  const start = () => root.setAttribute(NAVIGATING, '');
  document.addEventListener('click', (event) => {
    if (leavingLink(event, document)) start();
  });
  document.addEventListener('submit', (event) => {
    if (!event.defaultPrevented) start();
  });
  document.defaultView?.addEventListener('pageshow', () => root.removeAttribute(NAVIGATING));
}
