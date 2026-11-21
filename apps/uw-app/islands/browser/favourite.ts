async function toggle(button: Element, send: typeof fetch): Promise<void> {
  const pageId = button.getAttribute('data-favourite') ?? '';
  const on = button.getAttribute('aria-pressed') !== 'true';
  const response = await send(`/api/pages/${encodeURIComponent(pageId)}/favourite`, {
    method: on ? 'PUT' : 'DELETE',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return;
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.toggleAttribute('data-on', on);
}

export function wireFavourite(document: Document, send: typeof fetch): void {
  document.addEventListener('click', (event) => {
    const pressed = event.target as Element | null;
    const button = pressed?.closest('[data-favourite]') ?? null;
    if (button === null) return;
    event.preventDefault();
    void toggle(button, send).catch(() => undefined);
  });
}
