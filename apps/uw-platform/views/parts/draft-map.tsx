import type { DraftStage } from '@uw/contracts';
import { draftMapStage, layoutMap, mapNodes, orderWords } from '@uw/ui/components/flow-layout.ts';
import { domId } from '@uw/ui/components/text.ts';
import { draftChoices, type Choice } from './draft-words.ts';
import { gateStyle, mapPhases, mapSvg } from './flow-diagram.tsx';

const mapHint =
  'Drag a stage to move it, or drag from the dot in its corner onto another stage to draw a loop. Select a loop and press Delete to remove it. Move up, Move down, Phase and Loops back to below do the same from the keyboard.';

function labelOf(choices: readonly Choice[], value: string): string {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

function mapStageOf(stage: DraftStage) {
  return draftMapStage({
    key: stage.key,
    title: stage.title,
    phase: stage.bracket,
    exitGate: stage.exitGate,
    pickup: labelOf(draftChoices.agentPickup, stage.agentPickup),
    exit: labelOf(draftChoices.exitGate, stage.exitGate),
    feeds: stage.feeds,
  });
}

export function DraftMap(props: {
  readonly harnessId: string;
  readonly harnessTitle: string;
  readonly stages: readonly DraftStage[];
  readonly editable: boolean;
}) {
  const id = domId('draft-map', props.harnessId);
  const title = `${props.harnessTitle} draft, as a map`;
  const layout = layoutMap(mapPhases, props.stages.map(mapStageOf));
  const root = mapNodes(layout, {
    id,
    title,
    desc: orderWords(layout),
    editable: props.editable,
    gate: gateStyle,
  });
  return (
    <div class="flex flex-col gap-2">
      {props.editable ? <p class="m-0 text-sm text-text-3">{mapHint}</p> : null}
      <div
        data-draft-map
        data-map-id={id}
        data-map-title={title}
        data-gate-box={gateStyle.box}
        data-gate-line={gateStyle.line}
        class="overflow-x-auto rounded-md border border-line-soft p-2"
      >
        {mapSvg(root)}
      </div>
    </div>
  );
}
