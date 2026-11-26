import { wordChanges, type WordChange } from '../../pages/word-diff.ts';

const piece = 'rounded-sm whitespace-pre-wrap no-underline';
const looks: Readonly<Record<WordChange['kind'], string>> = {
  same: 'whitespace-pre-wrap text-text-2',
  added: `${piece} bg-ok-soft text-ok-text`,
  removed: `${piece} bg-raised text-text-3 line-through`,
};

function Piece(props: { readonly change: WordChange }) {
  const { change } = props;
  if (change.kind === 'added') return <ins class={looks.added}>{change.text}</ins>;
  if (change.kind === 'removed') return <del class={looks.removed}>{change.text}</del>;
  return <span class={looks.same}>{change.text}</span>;
}

const text = 'm-0 rounded-md bg-raised p-3 text-sm whitespace-pre-wrap text-text';

export function WordChanges(props: {
  readonly before: string;
  readonly after: string;
  readonly same: string;
}) {
  const changes = wordChanges(props.before, props.after);
  if (changes === null) {
    return (
      <p class="m-0 text-sm text-text-2">
        These texts differ in too many places to compare word by word. Compare them line by line.
      </p>
    );
  }
  if (!changes.some((change) => change.kind !== 'same')) {
    return <p class="m-0 text-sm text-text-2">{props.same}</p>;
  }
  return (
    <p data-word-changes="" class={text}>
      {changes.map((change) => (
        <Piece change={change} />
      ))}
    </p>
  );
}
