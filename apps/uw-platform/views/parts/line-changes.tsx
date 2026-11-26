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

const whole =
  'm-0 overflow-x-auto rounded-md bg-raised p-3 font-mono text-xs whitespace-pre-wrap text-text';

function Whole(props: { readonly before: string; readonly after: string }) {
  return (
    <div data-whole-texts="" class="flex flex-col gap-3">
      <p class="m-0 text-sm text-text-2">
        These texts are too long to compare line by line, so both are shown in full.
      </p>
      <p class="m-0 text-xs font-semibold text-text-3">Before</p>
      <pre data-before="" class={whole}>
        {props.before}
      </pre>
      <p class="m-0 text-xs font-semibold text-text-3">After</p>
      <pre data-after="" class={whole}>
        {props.after}
      </pre>
    </div>
  );
}

export function LineChanges(props: {
  readonly before: string;
  readonly after: string;
  readonly same: string;
}) {
  const changes = lineChanges(props.before, props.after);
  const differs = changes?.some((change) => change.kind !== 'same') ?? true;
  if (changes === null) return <Whole before={props.before} after={props.after} />;
  if (!differs) return <p class="m-0 text-sm text-text-2">{props.same}</p>;
  return (
    <div data-changes="" class="-mx-3 flex flex-col">
      {changes.map((change) => (
        <Line change={change} />
      ))}
    </div>
  );
}
