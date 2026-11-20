export type MenuItem = {
  readonly title: string;
  readonly meta: string;
  readonly choose: () => void;
};

export type Menu = {
  show(items: readonly MenuItem[], at: DOMRect | null): void;
  move(by: number): void;
  choose(): boolean;
  hide(): void;
  isOpen(): boolean;
};

const SELECTED = 'aria-selected';
const GAP = 6;

function place(panel: HTMLElement, at: DOMRect | null): void {
  if (at === null) return;
  panel.style.left = `${String(Math.round(at.left))}px`;
  panel.style.top = `${String(Math.round(at.bottom + GAP))}px`;
}

function rowFor(template: HTMLTemplateElement, item: MenuItem, selected: boolean): HTMLElement {
  const row = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
  row.setAttribute(SELECTED, selected ? 'true' : 'false');
  const title = row.querySelector('[data-title]');
  const meta = row.querySelector('[data-meta]');
  if (title !== null) title.textContent = item.title;
  if (meta !== null) meta.textContent = item.meta;
  return row;
}

export function createMenu(root: Element): Menu | null {
  const panel = root.querySelector<HTMLElement>('[data-editor-menu]');
  const template = root.querySelector<HTMLTemplateElement>('[data-editor-menu-row]');
  if (panel === null || template === null) return null;
  let items: readonly MenuItem[] = [];
  let selected = 0;
  const draw = () => {
    const rows = items.map((item, index) => rowFor(template, item, index === selected));
    panel.replaceChildren(...rows);
    rows.at(selected)?.scrollIntoView?.({ block: 'nearest' });
  };
  panel.addEventListener('mousedown', (event) => {
    const row = (event.target as Element | null)?.closest('[role="option"]') ?? null;
    const index = row === null ? -1 : [...panel.children].indexOf(row);
    if (index < 0) return;
    event.preventDefault();
    items.at(index)?.choose();
  });
  return {
    show: (next, at) => {
      items = next;
      selected = 0;
      panel.hidden = next.length === 0;
      place(panel, at);
      draw();
    },
    move: (by) => {
      if (items.length === 0) return;
      selected = (selected + by + items.length) % items.length;
      draw();
    },
    choose: () => {
      const item = items.at(selected);
      if (item === undefined || panel.hidden) return false;
      item.choose();
      return true;
    },
    hide: () => {
      items = [];
      panel.hidden = true;
      panel.replaceChildren();
    },
    isOpen: () => !panel.hidden,
  };
}
