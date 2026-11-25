import { lineChanges, type LineChange } from '../../pages/diff.ts';

const line = 'block rounded-sm px-3 py-1 font-mono text-xs whitespace-pre-wrap no-underline';
const looks: Readonly<Record<LineChange['kind'], string>> = {
  same: `${line} text-text-3`,
  added: `${line} bg-ok-soft text-ok-text`,
  removed: `${line} bg-raised text-text-3 line-through`,
};

function Line(props: { readonly change: LineChange }) {
  const { change } = props;
  if (change.kind === 'added') return <ins class={looks.added}>{change.text}</ins>;
  if (change.kind === 'removed') return <del class={looks.removed}>{change.text}</del>;
  return <span class={looks.same}>{change.text}</span>;
}

export function LineChanges(props: {
  readonly before: string;
  readonly after: string;
  readonly same: string;
}) {
  const changes = lineChanges(props.before, props.after);
  const differs = changes?.some((change) => change.kind !== 'same') ?? true;
  if (changes === null) {
    return <p class="m-0 text-sm text-text-2">These texts are too long to compare line by line.</p>;
  }
  if (!differs) return <p class="m-0 text-sm text-text-2">{props.same}</p>;
  return (
    <div data-changes="" class="-mx-3 flex flex-col">
      {changes.map((change) => (
        <Line change={change} />
      ))}
    </div>
  );
}
