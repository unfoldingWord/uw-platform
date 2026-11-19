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
  readonly bare?: boolean;
}) {
  const frame = props.bare === true ? '' : 'rounded-md border border-line';
  return (
    <div class={`overflow-x-auto bg-surface ${frame}`}>
      <table class="w-full border-collapse text-sm text-text">
        <caption class="sr-only">{props.caption}</caption>
        <thead class="bg-raised">
          <tr>
            {props.columns.map((column) => (
              <th
                scope="col"
                class={`border-b border-line px-3 py-2 text-xs font-heavy tracking-wide whitespace-nowrap text-text-3 uppercase ${cellClasses(column)}`}
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
              <tr class="border-b border-line-soft last:border-b-0 hover:bg-raised">
                {props.columns.map((column) => (
                  <td class={`px-3 py-2 align-middle ${cellClasses(column)}`}>
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
