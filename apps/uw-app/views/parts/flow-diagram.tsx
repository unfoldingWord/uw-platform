import { jsx } from 'hono/jsx';
import { stageBracketSchema, type StageBracket } from '@uw/contracts';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import type { FlowStage } from '@uw/harness';
import {
  layoutMap,
  mapNodes,
  orderWords,
  type MapLine,
  type MapNode,
  type MapPhase,
  type MapStage,
} from '@uw/ui/components/flow-layout.ts';
import { humanGateSvg, humanGateSvgLine } from '@uw/ui/components/human-action.tsx';
import { domId } from '@uw/ui/components/text.ts';
import { costText } from './costs.ts';
import { queuePath } from './paths.ts';

const bracketWords: ReadonlyMap<StageBracket, string> = new Map([
  ['product_package', 'Product package'],
  ['build_package', 'Build package'],
  ['deploy_package', 'Deploy package'],
  ['iterate', 'Iterate'],
]);

export function bracketText(bracket: StageBracket): string {
  return bracketWords.get(bracket) ?? bracket;
}

export const gateStyle = { box: humanGateSvg, line: humanGateSvgLine } as const;

export const mapPhases: readonly MapPhase[] = stageBracketSchema.options.map((key) => ({
  key,
  label: bracketText(key),
}));

const personApproves: MapLine = { text: 'Person approves', human: true };

function itemWords(count: number): string {
  return count === 1 ? '1 item' : `${formatCount(count)} items`;
}

function liveLines(entry: FlowStage, at: Date): MapLine[] {
  const { stage } = entry;
  const oldest = entry.oldestEnteredAt;
  const progress = stage.paused ? 'Paused' : `${entry.held} of ${stage.wipLimit} in progress`;
  const items =
    oldest === null
      ? itemWords(entry.count)
      : `${itemWords(entry.count)} · oldest ${formatDuration(at.getTime() - oldest.getTime())}`;
  const lines: MapLine[] = [
    { text: progress },
    { text: items },
    { text: costText(entry.cost).metered },
  ];
  return stage.exitGate === 'human_approval' ? [...lines, personApproves] : lines;
}

function liveStage(harnessId: string, entry: FlowStage, at: Date): MapStage {
  const { stage } = entry;
  return {
    key: stage.key,
    title: stage.title,
    label: `${stage.title}, ${itemWords(entry.count)}, ${entry.held} of ${stage.wipLimit} in progress`,
    phase: stage.bracket,
    gate: stage.exitGate === 'human_approval',
    paused: stage.paused,
    feeds: stage.feeds,
    lines: liveLines(entry, at),
    href: queuePath(harnessId, stage.key),
  };
}

export function mapSvg(node: MapNode): ReturnType<typeof jsx> {
  return jsx(
    node.tag,
    { ...node.attrs },
    ...(node.text === undefined ? [] : [node.text]),
    ...(node.children ?? []).map(mapSvg),
  );
}

export function FlowDiagram(props: {
  readonly harnessId: string;
  readonly harnessTitle: string;
  readonly stages: readonly FlowStage[];
  readonly at: Date;
}) {
  const ordered = [...props.stages].sort(
    (left, right) => left.stage.position - right.stage.position,
  );
  const stages = ordered.map((entry) => liveStage(props.harnessId, entry, props.at));
  const layout = layoutMap(mapPhases, stages);
  const root = mapNodes(layout, {
    id: domId('flow', props.harnessId),
    title: `${props.harnessTitle} as the build, measure, learn loop`,
    desc: orderWords(layout),
    editable: false,
    gate: gateStyle,
  });
  return (
    <div class="overflow-x-auto rounded-lg border border-line bg-surface p-2">{mapSvg(root)}</div>
  );
}
