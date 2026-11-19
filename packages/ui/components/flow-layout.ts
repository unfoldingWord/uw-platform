export type MapPhase = { readonly key: string; readonly label: string };

export type MapLine = { readonly text: string; readonly human?: boolean };

export type MapStage = {
  readonly key: string;
  readonly title: string;
  readonly label: string;
  readonly phase: string;
  readonly gate: boolean;
  readonly paused: boolean;
  readonly feeds: readonly string[];
  readonly lines: readonly MapLine[];
  readonly href?: string;
};

export type PlacedPhase = MapPhase & {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PlacedBox = {
  readonly stage: MapStage;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly column: number;
  readonly row: number;
};

export type MapArrow = {
  readonly from: string;
  readonly to: string;
  readonly d: string;
  readonly midX: number;
  readonly midY: number;
};

export type MapLayout = {
  readonly width: number;
  readonly height: number;
  readonly phases: readonly PlacedPhase[];
  readonly boxes: readonly PlacedBox[];
  readonly steps: readonly MapArrow[];
  readonly loops: readonly MapArrow[];
};

export const mapClass = {
  phase: 'fill-lane stroke-line-soft',
  phaseLabel: 'fill-text-3 text-xs font-heavy',
  box: 'fill-surface stroke-line',
  pausedBox: 'fill-canvas stroke-line-strong',
  title: 'fill-text text-xs font-heavy',
  line: 'fill-text-3 text-xs',
  step: 'stroke-text-3',
  stepHead: 'fill-text-3',
  loop: 'stroke-accent',
  loopHead: 'fill-accent',
  link: 'outline-offset-2 outline-accent-text focus-visible:outline-2',
  grab: 'cursor-grab touch-none',
  handle: 'cursor-crosshair touch-none fill-accent stroke-surface',
  loopHit: 'cursor-pointer stroke-transparent outline-none',
  chosen: 'stroke-accent-text',
  remove: 'cursor-pointer fill-surface stroke-accent-text',
  removeMark: 'fill-accent-text text-xs font-heavy',
  dragging: 'opacity-50',
  target: 'stroke-accent-text',
} as const;

export const MAP_BOX_WIDTH = 184;
export const MAP_BOX_HEIGHT = 106;
export const MAP_LINE_TOPS: readonly number[] = [20, 38, 56, 74, 92];
export const MAP_TITLE_LENGTH = 24;

const PAD = 8;
const INSET = 12;
const COLUMN_GAP = 16;
const LABEL_SPACE = 36;
const ROW_GAP = 28;
const LOOP_GAP = 20;
const LOOP_STEP = 14;
const COLUMN_WIDTH = MAP_BOX_WIDTH + 2 * INSET;
const ROW = MAP_BOX_HEIGHT + ROW_GAP;

export function shortTitle(title: string): string {
  if (title.length <= MAP_TITLE_LENGTH) return title;
  return `${title.slice(0, MAP_TITLE_LENGTH - 1).trimEnd()}…`;
}

function columnX(column: number): number {
  return PAD + column * (COLUMN_WIDTH + COLUMN_GAP);
}

function placeBoxes(phases: readonly MapPhase[], stages: readonly MapStage[]): PlacedBox[] {
  const rows = new Map<string, number>();
  const columns = new Map(phases.map((phase, index) => [phase.key, index]));
  return stages.flatMap((stage) => {
    const column = columns.get(stage.phase);
    if (column === undefined) return [];
    const row = rows.get(stage.phase) ?? 0;
    rows.set(stage.phase, row + 1);
    const x = columnX(column) + INSET;
    const y = PAD + LABEL_SPACE + row * ROW;
    return [{ stage, x, y, width: MAP_BOX_WIDTH, height: MAP_BOX_HEIGHT, column, row }];
  });
}

function stepPath(from: PlacedBox, to: PlacedBox): MapArrow {
  const fromCentre = from.x + from.width / 2;
  const toCentre = to.x + to.width / 2;
  if (from.column === to.column) {
    const top = from.y + from.height;
    const end = to.y - 2;
    return {
      from: from.stage.key,
      to: to.stage.key,
      d: `M ${fromCentre} ${top} L ${toCentre} ${end}`,
      midX: fromCentre,
      midY: (top + end) / 2,
    };
  }
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x - 2;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(12, Math.abs(x2 - x1) / 2);
  const toward = x2 >= x1 ? 1 : -1;
  return {
    from: from.stage.key,
    to: to.stage.key,
    d: `M ${x1} ${y1} C ${x1 + bend * toward} ${y1} ${x2 - bend * toward} ${y2} ${x2} ${y2}`,
    midX: (x1 + x2) / 2,
    midY: (y1 + y2) / 2,
  };
}

function gapLeftOf(box: PlacedBox, lane: number): number {
  const gap = box.column === 0 ? PAD : COLUMN_GAP;
  return box.x - INSET - gap / 2 - (lane % 2) * 2;
}

function loopPath(from: PlacedBox, to: PlacedBox, lane: number, depth: number): MapArrow {
  const y1 = from.y + (from.height * 3) / 4;
  const y2 = to.y + (to.height * 3) / 4;
  const out = gapLeftOf(from, lane);
  const back = gapLeftOf(to, lane);
  return {
    from: from.stage.key,
    to: to.stage.key,
    d: `M ${from.x} ${y1} H ${out} V ${depth} H ${back} V ${y2} H ${to.x - 2}`,
    midX: (out + back) / 2,
    midY: depth,
  };
}

export function layoutMap(phases: readonly MapPhase[], stages: readonly MapStage[]): MapLayout {
  const boxes = placeBoxes(phases, stages);
  const rows = Math.max(1, ...boxes.map((box) => box.row + 1));
  const columnHeight = LABEL_SPACE + rows * ROW - ROW_GAP + INSET;
  const placedPhases = phases.map((phase, index) => ({
    ...phase,
    x: columnX(index),
    y: PAD,
    width: COLUMN_WIDTH,
    height: columnHeight,
  }));
  const byKey = new Map(boxes.map((box) => [box.stage.key, box]));
  const steps = boxes.slice(1).map((box, index) => stepPath(boxes.at(index) ?? box, box));
  const firstLane = PAD + columnHeight + LOOP_GAP;
  const pairs = boxes.flatMap((box) =>
    box.stage.feeds.flatMap((target) => {
      const to = byKey.get(target);
      return to === undefined || to === box ? [] : [{ from: box, to }];
    }),
  );
  const loops = pairs.map((pair, index) =>
    loopPath(pair.from, pair.to, index, firstLane + index * LOOP_STEP),
  );
  const width = columnX(phases.length) - COLUMN_GAP + PAD;
  const height = firstLane + Math.max(0, pairs.length - 1) * LOOP_STEP + 2 * PAD;
  return { width, height, phases: placedPhases, boxes, steps, loops };
}

export type MapNode = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly text?: string;
  readonly children?: readonly MapNode[];
};

export type GateStyle = { readonly box: string; readonly line: string };

export type MapOptions = {
  readonly id: string;
  readonly gate: GateStyle;
  readonly title: string;
  readonly desc: string;
  readonly editable: boolean;
};

function node(
  tag: string,
  attrs: Record<string, string>,
  children: readonly MapNode[] = [],
  text?: string,
): MapNode {
  return text === undefined ? { tag, attrs, children } : { tag, attrs, children, text };
}

function marker(id: string, head: string): MapNode {
  return node(
    'marker',
    {
      id,
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '7',
      markerHeight: '7',
      orient: 'auto-start-reverse',
    },
    [node('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: head })],
  );
}

function phaseNode(phase: PlacedPhase): MapNode {
  return node('g', { 'data-bracket': phase.key }, [
    node('rect', {
      x: String(phase.x),
      y: String(phase.y),
      width: String(phase.width),
      height: String(phase.height),
      rx: '10',
      class: mapClass.phase,
    }),
    node(
      'text',
      { x: String(phase.x + INSET), y: String(phase.y + 22), class: mapClass.phaseLabel },
      [],
      phase.label,
    ),
  ]);
}

function boxClass(stage: MapStage, gate: GateStyle): string {
  if (stage.gate) return gate.box;
  return stage.paused ? mapClass.pausedBox : mapClass.box;
}

function boxFace(box: PlacedBox, gate: GateStyle): MapNode[] {
  const { stage, x, y } = box;
  const rect = node('rect', {
    x: String(x),
    y: String(y),
    width: String(box.width),
    height: String(box.height),
    rx: '8',
    'stroke-width': stage.gate ? '2' : '1',
    class: boxClass(stage, gate),
  });
  const title = node(
    'text',
    { x: String(x + INSET), y: String(y + (MAP_LINE_TOPS[0] ?? 20)), class: mapClass.title },
    [],
    shortTitle(stage.title),
  );
  const lines = stage.lines.slice(0, MAP_LINE_TOPS.length - 1).map((line, index) =>
    node(
      'text',
      {
        x: String(x + INSET),
        y: String(y + (MAP_LINE_TOPS[index + 1] ?? 0)),
        class: line.human === true ? gate.line : mapClass.line,
      },
      [],
      line.text,
    ),
  );
  return [rect, title, ...lines];
}

function handleNode(box: PlacedBox): MapNode {
  return node('circle', {
    'data-loop-handle': box.stage.key,
    cx: String(box.x + box.width - INSET),
    cy: String(box.y + box.height - INSET),
    r: '6',
    'stroke-width': '2',
    class: mapClass.handle,
  });
}

function boxNode(box: PlacedBox, editable: boolean, gate: GateStyle): MapNode {
  const { stage } = box;
  const face = boxFace(box, gate);
  if (stage.href !== undefined) {
    const link = node(
      'a',
      { href: stage.href, 'aria-label': stage.label, class: mapClass.link },
      face,
    );
    return node('g', { 'data-stage': stage.key }, [link]);
  }
  if (!editable) {
    return node('g', { 'data-stage': stage.key, role: 'img', 'aria-label': stage.label }, face);
  }
  return node(
    'g',
    {
      'data-stage': stage.key,
      'data-box': '',
      role: 'img',
      'aria-label': stage.label,
      class: mapClass.grab,
    },
    [...face, handleNode(box)],
  );
}

function titleOf(layout: MapLayout, key: string): string {
  return layout.boxes.find((box) => box.stage.key === key)?.stage.title ?? key;
}

export function loopWords(layout: MapLayout, loop: MapArrow): string {
  return `loop from ${titleOf(layout, loop.from)} to ${titleOf(layout, loop.to)}`;
}

function loopNodes(layout: MapLayout, loop: MapArrow, id: string, editable: boolean): MapNode[] {
  const drawn = node('path', {
    'data-feeds': `${loop.from} ${loop.to}`,
    d: loop.d,
    fill: 'none',
    'stroke-width': '2',
    'stroke-dasharray': '6 4',
    class: mapClass.loop,
    'marker-end': `url(#${id}-loop)`,
  });
  if (!editable) return [drawn];
  const hit = node('path', {
    'data-loop': `${loop.from} ${loop.to}`,
    d: loop.d,
    fill: 'none',
    'stroke-width': '12',
    'pointer-events': 'stroke',
    tabindex: '0',
    role: 'button',
    'aria-label': `The ${loopWords(layout, loop)}. Press Delete to remove it.`,
    class: mapClass.loopHit,
  });
  return [drawn, hit];
}

function stepNode(step: MapArrow, id: string): MapNode {
  return node('path', {
    'data-next': `${step.from} ${step.to}`,
    d: step.d,
    fill: 'none',
    'stroke-width': '1.5',
    class: mapClass.step,
    'marker-end': `url(#${id}-step)`,
  });
}

export function mapNodes(layout: MapLayout, options: MapOptions): MapNode {
  const { id, editable } = options;
  return node(
    'svg',
    {
      role: 'group',
      'aria-labelledby': `${id}-title ${id}-desc`,
      viewBox: `0 0 ${layout.width} ${layout.height}`,
      class: 'h-auto w-full min-w-flow',
      ...(editable ? { 'data-map-editable': '' } : {}),
    },
    [
      node('title', { id: `${id}-title` }, [], options.title),
      node('desc', { id: `${id}-desc` }, [], options.desc),
      node('defs', {}, [
        marker(`${id}-step`, mapClass.stepHead),
        marker(`${id}-loop`, mapClass.loopHead),
      ]),
      ...layout.phases.map(phaseNode),
      ...layout.steps.map((step) => stepNode(step, id)),
      ...layout.loops.flatMap((loop) => loopNodes(layout, loop, id, editable)),
      ...layout.boxes.map((box) => boxNode(box, editable, options.gate)),
    ],
  );
}

export function removeNode(layout: MapLayout, loop: MapArrow): MapNode {
  return node(
    'g',
    {
      'data-loop-remove': `${loop.from} ${loop.to}`,
      role: 'button',
      tabindex: '0',
      'aria-label': `Remove the ${loopWords(layout, loop)}`,
    },
    [
      node('circle', {
        cx: String(loop.midX),
        cy: String(loop.midY),
        r: '9',
        'stroke-width': '2',
        class: mapClass.remove,
      }),
      node(
        'text',
        {
          x: String(loop.midX),
          y: String(loop.midY + 4),
          'text-anchor': 'middle',
          class: mapClass.removeMark,
        },
        [],
        '×',
      ),
    ],
  );
}

export type DraftMapInput = {
  readonly key: string;
  readonly title: string;
  readonly phase: string;
  readonly exitGate: string;
  readonly pickup: string;
  readonly exit: string;
  readonly feeds: readonly string[];
};

export function draftMapStage(input: DraftMapInput): MapStage {
  const title = input.title.trim() === '' ? 'New stage' : input.title.trim();
  const gate = input.exitGate === 'human_approval';
  return {
    key: input.key,
    title,
    label: `${title}, ${input.pickup}, ${input.exit}`,
    phase: input.phase,
    gate,
    paused: false,
    feeds: input.feeds,
    lines: [{ text: input.pickup }, { text: input.exit, human: gate }],
  };
}

export function orderWords(layout: MapLayout): string {
  return `Stages in order: ${layout.boxes.map((box) => box.stage.title).join(', then ')}`;
}
