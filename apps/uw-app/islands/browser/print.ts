export function wirePrint(document: Document, print: () => void): void {
  document.addEventListener('click', (event) => {
    const pressed = event.target as Element | null;
    if (pressed?.closest('[data-print]') == null) return;
    event.preventDefault();
    print();
  });
}
