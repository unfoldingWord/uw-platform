import type { Child } from 'hono/jsx';

export type Column = { readonly key: string; readonly label: string; readonly numeric?: boolean };

const numericClasses = 'text-right font-mono';

function cellClasses(column: Column): string {
  return column.numeric === true ? numericClasses : 'text-left';
}

export function Table(props: {
  readonly caption: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Readonly<Record<string, Child>>[];
}) {
  return (
    <div class="overflow-x-auto rounded-lg border border-line">
      <table class="w-full border-collapse text-sm text-ink">
        <caption class="sr-only">{props.caption}</caption>
        <thead class="bg-surface">
          <tr>
            {props.columns.map((column) => (
              <th
                scope="col"
                class={`border-b border-line px-3 py-2 font-bold text-muted ${cellClasses(column)}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const cells = new Map(Object.entries(row));
            return (
              <tr class="border-b border-line last:border-b-0">
                {props.columns.map((column) => (
                  <td class={`px-3 py-2 ${cellClasses(column)}`}>
                    {cells.get(column.key) ?? null}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
