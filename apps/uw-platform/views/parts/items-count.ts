import { formatCount } from '@uw/core/money';
import type { BoardColumn } from '@uw/harness';

type Counted = Pick<BoardColumn, 'next' | 'uncounted'> & { readonly cards: readonly unknown[] };

export function itemsText(column: Counted, botAuthors: readonly string[]): string {
  const more = column.next !== null;
  const counted = formatCount(column.cards.length - column.uncounted);
  const head = more ? `${counted} or more` : counted;
  if (column.uncounted === 0) return head;
  const left = more ? `at least ${formatCount(column.uncounted)}` : formatCount(column.uncounted);
  return `${head}, not counting ${left} by ${botAuthors.join(', ')}`;
}
