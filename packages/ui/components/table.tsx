import type { Child } from 'hono/jsx';

export type Column = {
  readonly key: string;
  readonly label: string;
  readonly numeric?: boolean;
  readonly wide?: 'narrow' | 'medium' | 'wide' | undefined;
};

const wideClasses: ReadonlyMap<string, string> = new Map([
  ['narrow', 'min-w-col-min'],
  ['medium', 'min-w-aside'],
  ['wide', 'min-w-col-max'],
]);

const numericClasses = 'text-right font-mono';

function cellClasses(column: Column): string {
  return column.numeric === true ? numericClasses : 'text-left';
}

function headClasses(column: Column): string {
  return `${cellClasses(column)} ${wideClasses.get(column.wide ?? '') ?? ''}`;
}

export function Table(props: {
  readonly caption: string;
  readonly columns: readonly Column[];
  readonly rows: readonly Readonly<Record<string, Child>>[];
  readonly bare?: boolean;
  readonly selected?: number | undefined;
}) {
  const frame = props.bare === true ? '' : '';
  return (
    <div class={`overflow-x-auto ${frame}`}>
      <table class="w-full border-collapse text-sm text-text">
        <caption class="sr-only">{props.caption}</caption>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th
                scope="col"
                class={`border-b border-line-soft px-3 py-2 text-xs font-semibold tracking-wide whitespace-nowrap text-text-3 uppercase ${headClasses(column)}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => {
            const cells = new Map(Object.entries(row));
            const chosen = index === props.selected;
            return (
              <tr
                aria-current={chosen ? 'true' : undefined}
                class={`border-b border-line-soft transition-colors motion-reveal last:border-b-0 ${chosen ? 'bg-accent-soft' : 'hover:bg-raised'}`}
              >
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
