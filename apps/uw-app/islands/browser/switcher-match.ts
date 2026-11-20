import uFuzzy from '@leeoniya/ufuzzy';
import type { PageIndexEntry } from '@uw/contracts';

export type Matcher = (query: string, limit: number) => readonly PageIndexEntry[];

const OUT_OF_ORDER = 1;
const ONE_SLIP = 1;

function searchable(entry: PageIndexEntry): string {
  const id = entry.jdId === null ? [] : [entry.jdId, entry.jdId.replace('.', '')];
  return [entry.title, ...id, ...entry.aliases].join(' ');
}

export function createMatcher(entries: readonly PageIndexEntry[]): Matcher {
  const fuzzy = new uFuzzy({ intraMode: ONE_SLIP });
  const haystack = entries.map(searchable);
  return (query, limit) => {
    const needle = query.trim();
    if (needle === '') return [];
    const [indexes, info, order] = fuzzy.search(haystack, needle, OUT_OF_ORDER);
    if (indexes === null) return [];
    const ranked =
      info === null || order === null ? indexes : order.map((position) => info.idx.at(position));
    return ranked
      .slice(0, limit)
      .map((index) => (index === undefined ? undefined : entries.at(index)))
      .filter((entry): entry is PageIndexEntry => entry !== undefined);
  };
}
