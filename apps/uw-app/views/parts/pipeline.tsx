import type { Stage, StageBracket } from '@uw/contracts';
import { HumanMark, humanFigure, humanNode } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { Kpi } from '@uw/ui/components/kpi.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';

export type Figure = { readonly label: string; readonly value: string; readonly person?: boolean };

const bracketWords: Readonly<Record<StageBracket, string>> = {
  product_package: 'Product package',
  build_package: 'Build package',
  deploy_package: 'Deploy',
  iterate: 'Iterate',
};

type Run = { readonly bracket: StageBracket; readonly stages: readonly Stage[] };

function bracketsOf(stages: readonly Stage[]): readonly Run[] {
  const runs: { bracket: StageBracket; stages: Stage[] }[] = [];
  for (const stage of stages) {
    const last = runs.at(-1);
    if (last !== undefined && last.bracket === stage.bracket) last.stages.push(stage);
    else runs.push({ bracket: stage.bracket, stages: [stage] });
  }
  return runs;
}

function isGate(stage: Stage): boolean {
  return stage.exitGate === 'human_approval';
}

function Node(props: { readonly stage: Stage; readonly count: number; readonly number: number }) {
  const { stage } = props;
  const gate = isGate(stage);
  const ring = gate ? humanNode : 'border-accent text-accent-text';
  return (
    <li
      data-stage={stage.key}
      class="flex w-size-8 shrink-0 flex-col items-center gap-1 text-center"
    >
      <span
        class={`grid size-size-5 place-items-center rounded-full border font-mono text-xs ${ring}`}
      >
        {gate ? (
          <Icon name="user-check" size={2} label="A person decides" />
        ) : (
          String(props.number).padStart(2, '0')
        )}
      </span>
      <span class={`font-mono text-2xl ${gate ? humanFigure : 'text-text'}`}>{props.count}</span>
      <span class="text-xs leading-snug text-text-3">{stage.title}</span>
    </li>
  );
}

function Loops(props: { readonly stages: readonly Stage[] }) {
  const byKey = new Map(props.stages.map((stage) => [stage.key, stage]));
  const loops = props.stages.flatMap((stage) =>
    stage.feeds.flatMap((key) => {
      const target = byKey.get(key);
      return target === undefined ? [] : [{ from: stage, to: target }];
    }),
  );
  if (loops.length === 0) return null;
  return (
    <ul class="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-text-3">
      {loops.map(({ from, to }) => (
        <li class="flex items-center gap-1">
          <Icon name="diagram-project" size={1} />
          {`${from.title} feeds ${to.title}`}
          {props.stages.indexOf(to) === 0 ? (
            <>
              <HumanMark label="A person decides" />
              <span>a person decides</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Figures(props: { readonly figures: readonly Figure[] }) {
  return (
    <div class="grid grid-cols-3 gap-4 lg:border-l lg:border-line lg:pl-5">
      {props.figures.map((figure) => (
        <Kpi label={figure.label} value={figure.value} plain person={figure.person} />
      ))}
    </div>
  );
}

export function Pipeline(props: {
  readonly title: string;
  readonly summary: string;
  readonly stages: readonly Stage[];
  readonly counts: ReadonlyMap<string, number>;
  readonly figures: readonly Figure[];
}) {
  return (
    <section
      aria-label="Pipeline"
      class="mb-5 flex flex-col gap-5 rounded-lg bg-surface p-5 shadow-2 lg:flex-row"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <PageHead title={props.title} lede={props.summary} flush />
        <div class="flex gap-4 overflow-x-auto pb-1">
          {bracketsOf(props.stages).map((run) => (
            <div class="flex shrink-0 flex-col gap-2">
              <p class="m-0 border-b border-line pb-1 text-center text-xs text-text-3">
                {bracketWords[run.bracket]}
              </p>
              <ol class="m-0 flex list-none gap-2 p-0">
                {run.stages.map((stage) => (
                  <Node
                    stage={stage}
                    count={props.counts.get(stage.key) ?? 0}
                    number={props.stages.indexOf(stage) + 1}
                  />
                ))}
              </ol>
            </div>
          ))}
        </div>
        <Loops stages={props.stages} />
      </div>
      <Figures figures={props.figures} />
    </section>
  );
}
