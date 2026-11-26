import type { ChartTable } from '@uw/contracts';
import { csvCell } from '../collections/read-handlers.ts';

export function csvOf(table: ChartTable): string {
  const header = table.columns.map((column) => csvCell(column.label)).join(',');
  const lines = table.rows.map((row) =>
    table.columns.map((column) => csvCell(String(row[column.key] ?? ''))).join(','),
  );
  return [header, ...lines].join('\n');
}
