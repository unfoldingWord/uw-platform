import { stageBracketSchema, type StageBracket } from '@uw/contracts';
import type { FlowStage } from '@uw/harness';
import { humanGateSvg } from '@uw/ui/components/human-action.tsx';
import { domId } from '@uw/ui/components/text.ts';
import { boardPath } from './paths.ts';

const NODE_WIDTH = 176;
const NODE_HEIGHT = 64;
const GAP = 40;
const PAD = 24;
const NODE_TOP = 44;
const FEED_DROP = 72;
const ARROW = 'flow-arrow';
const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

const bracketWords: ReadonlyMap<StageBracket, string> = new Map([
  ['product_package', 'Product package'],
  ['build_package', 'Build package'],
  ['deploy_package', 'Deploy package'],
  ['iterate', 'Iterate'],
]);

export function bracketText(bracket: StageBracket): string {
  return bracketWords.get(bracket) ?? bracket;
}

type Slot = { readonly x: number; readonly stage: FlowStage | null };
type Band = { readonly bracket: StageBracket; readonly slots: readonly Slot[] };

function slotX(index: number): number {
  return PAD + index * (NODE_WIDTH + GAP);
}

function bandsOf(stages: readonly FlowStage[]): readonly Band[] {
  let index = 0;
  return stageBracketSchema.options.map((bracket) => {
    const inBand = stages
      .filter((entry) => entry.stage.bracket === bracket)
      .sort((left, right) => left.stage.position - right.stage.position);
    const listed = inBand.length === 0 ? [null] : inBand;
    const slots = listed.map((stage) => ({ x: slotX(index++), stage }));
    return { bracket, slots };
  });
}

function nodeLabel(entry: FlowStage): string {
  const { stage } = entry;
  return `${stage.title}, ${entry.count} items, ${entry.held} of ${stage.wipLimit} in progress`;
}

function nodeClass(entry: FlowStage): string {
  if (entry.stage.exitGate === 'human_approval') return humanGateSvg;
  return entry.stage.paused ? 'fill-bg stroke-ocean' : 'fill-surface stroke-ocean';
}

function Node(props: { readonly harnessId: string; readonly slot: Slot }) {
  const { stage: entry, x } = props.slot;
  if (entry === null) return null;
  const { stage } = entry;
  return (
    <g data-stage={stage.key}>
      <a href={boardPath(props.harnessId, stage.key)} aria-label={nodeLabel(entry)} class={focus}>
        <rect
          x={x}
          y={NODE_TOP}
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          rx="8"
          stroke-width="2"
          class={nodeClass(entry)}
        />
        <text x={x + 12} y={NODE_TOP + 24} class="fill-ink text-xs font-bold">
          {stage.title}
        </text>
        <text x={x + 12} y={NODE_TOP + 46} class="fill-muted text-xs">
          {stage.paused ? 'Paused' : `${entry.held} of ${stage.wipLimit} in progress`}
        </text>
      </a>
    </g>
  );
}

function BandBox(props: { readonly band: Band }) {
  const first = props.band.slots[0]?.x ?? PAD;
  const width = props.band.slots.length * (NODE_WIDTH + GAP) - GAP + 24;
  return (
    <g data-bracket={props.band.bracket}>
      <rect
        x={first - 12}
        y="4"
        width={width}
        height={NODE_TOP + NODE_HEIGHT + 8}
        rx="12"
        class="fill-bg stroke-line"
      />
      <text x={first} y="24" class="fill-muted text-xs font-bold">
        {bracketText(props.band.bracket)}
      </text>
    </g>
  );
}

function stepArrows(slots: readonly Slot[]) {
  const placed = slots.filter((slot) => slot.stage !== null);
  const pairs = placed.slice(1).map((slot, index) => ({ slot, from: placed.at(index) }));
  return pairs.map(({ slot, from }) => {
    const y = NODE_TOP + NODE_HEIGHT / 2;
    return (
      <line
        data-next={`${from?.stage?.stage.key ?? ''} ${slot.stage?.stage.key ?? ''}`}
        x1={(from?.x ?? 0) + NODE_WIDTH}
        y1={y}
        x2={slot.x - 4}
        y2={y}
        stroke-width="2"
        class="stroke-ocean"
        marker-end={`url(#${ARROW})`}
      />
    );
  });
}

function feedArrows(slots: readonly Slot[]) {
  const byKey = new Map(
    slots.flatMap((slot) => (slot.stage ? [[slot.stage.stage.key, slot]] : [])),
  );
  const bottom = NODE_TOP + NODE_HEIGHT;
  return slots.flatMap((slot) =>
    (slot.stage?.stage.feeds ?? []).flatMap((target) => {
      const to = byKey.get(target);
      if (to === undefined || slot.stage === null) return [];
      const fromX = slot.x + NODE_WIDTH / 2;
      const toX = to.x + NODE_WIDTH / 2;
      const d = `M ${fromX} ${bottom} C ${fromX} ${bottom + FEED_DROP} ${toX} ${bottom + FEED_DROP} ${toX} ${bottom + 6}`;
      return [
        <path
          data-feeds={`${slot.stage.stage.key} ${target}`}
          d={d}
          fill="none"
          stroke-width="2"
          class="stroke-ocean"
          marker-end={`url(#${ARROW})`}
        />,
      ];
    }),
  );
}

export function FlowDiagram(props: {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly stages: readonly FlowStage[];
}) {
  const bands = bandsOf(props.stages);
  const slots = bands.flatMap((band) => band.slots);
  const placed = slots.flatMap((slot) => (slot.stage === null ? [] : [slot.stage.stage.title]));
  const titleId = domId('flow', props.harnessId, 'title');
  const descId = domId('flow', props.harnessId, 'desc');
  const width = slotX(slots.length) - GAP + PAD;
  const height = NODE_TOP + NODE_HEIGHT + FEED_DROP + 24;
  return (
    <div class="overflow-x-auto rounded-lg border border-line bg-surface p-2">
      <svg
        role="group"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox={`0 0 ${width} ${height}`}
        class="h-auto w-full min-w-0"
      >
        <title id={titleId}>{`${props.harnessKey} as the build, measure, learn loop`}</title>
        <desc id={descId}>{`Stages in order: ${placed.join(', then ')}`}</desc>
        <defs>
          <marker
            id={ARROW}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" class="fill-ocean" />
          </marker>
        </defs>
        {bands.map((band) => (
          <BandBox band={band} />
        ))}
        {stepArrows(slots)}
        {feedArrows(slots)}
        {slots.map((slot) => (
          <Node harnessId={props.harnessId} slot={slot} />
        ))}
      </svg>
    </div>
  );
}
