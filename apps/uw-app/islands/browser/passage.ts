const MOST_QUOTED = 500;

export type Selected = { readonly text: string; readonly inside: Node | null };

function quoteIn(document: Document, selected: Selected): string {
  const body = document.querySelector('[data-page-body]');
  if (body === null || selected.inside === null || !body.contains(selected.inside)) return '';
  return selected.text.replace(/\s+/g, ' ').trim().slice(0, MOST_QUOTED);
}

export function wirePassageComment(
  document: Document,
  deps: { readonly selected: () => Selected; readonly go: (href: string) => void },
): void {
  document.addEventListener('click', (event) => {
    const pressed = event.target as Element | null;
    const button = pressed?.closest('[data-comment-passage]') ?? null;
    if (button === null) return;
    event.preventDefault();
    const href = button.getAttribute('data-href') ?? '';
    const quote = quoteIn(document, deps.selected());
    deps.go(quote === '' ? href : `${href}?quote=${encodeURIComponent(quote)}`);
  });
}
