const LEADING_ID = /^\s*([0-9]{2}\.[0-9]{2})(?=\s|$)/;
const LAST_ITEM = 99;

export function jdIdOfTitle(title: string): string | null {
  return LEADING_ID.exec(title)?.[1] ?? null;
}

function itemOf(id: string, category: string): number | null {
  if (!id.startsWith(`${category}.`)) return null;
  const item = Number(id.slice(category.length + 1));
  return Number.isInteger(item) && item >= 1 && item <= LAST_ITEM ? item : null;
}

function idOf(category: string, item: number): string {
  return `${category}.${String(item).padStart(2, '0')}`;
}

export function nextFreeJdId(category: string, taken: Iterable<string>): string | null {
  const used = new Set<number>();
  for (const id of taken) {
    const item = itemOf(id, category);
    if (item !== null) used.add(item);
  }
  const highest = Math.max(0, ...used);
  if (highest < LAST_ITEM) return idOf(category, highest + 1);
  for (let item = 1; item <= LAST_ITEM; item += 1) {
    if (!used.has(item)) return idOf(category, item);
  }
  return null;
}

export function titleWithJdId(title: string, id: string): string {
  const rest = title.replace(LEADING_ID, '').trim();
  return `${id} ${rest}`;
}
