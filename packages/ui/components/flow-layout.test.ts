import { describe, expect, it } from 'vitest';
import {
  layoutMap,
  mapNodes,
  removeNode,
  shortTitle,
  type MapNode,
  type MapPhase,
  type MapStage,
} from './flow-layout.ts';

const phases: readonly MapPhase[] = [
  { key: 'one', label: 'One' },
  { key: 'two', label: 'Two' },
  { key: 'three', label: 'Three' },
];

function stage(key: string, phase: string, feeds: readonly string[] = []): MapStage {
  return { key, title: key, label: key, phase, gate: false, paused: false, feeds, lines: [] };
}

function stacksStagesInTheirPhase(): void {
  const map = layoutMap(phases, [stage('a', 'one'), stage('b', 'one'), stage('c', 'two')]);
  const spots = map.boxes.map((box) => [box.column, box.row, box.x, box.y]);
  expect(spots.map(([column, row]) => [column, row])).toEqual([
    [0, 0],
    [0, 1],
    [1, 0],
  ]);
  const [a, b, c] = spots;
  expect(b?.[2]).toBe(a?.[2]);
  expect(Number(b?.[3])).toBeGreaterThan(Number(a?.[3]));
  expect(Number(c?.[2])).toBeGreaterThan(Number(a?.[2]));
  expect(c?.[3]).toBe(a?.[3]);
}

function keepsAnEmptyPhaseColumn(): void {
  const map = layoutMap(phases, [stage('a', 'one'), stage('c', 'three')]);
  expect(map.phases.map((phase) => phase.key)).toEqual(['one', 'two', 'three']);
  const third = map.phases[2];
  expect(map.boxes[1]?.x).toBeGreaterThan(third?.x ?? Infinity);
  expect(map.width).toBeGreaterThanOrEqual((third?.x ?? 0) + (third?.width ?? 0));
}

function leavesOutUnknownPhases(): void {
  const map = layoutMap(phases, [stage('a', 'one'), stage('z', 'nowhere')]);
  expect(map.boxes.map((box) => box.stage.key)).toEqual(['a']);
}

function drawsOneForwardArrowBetween(): void {
  const map = layoutMap(phases, [stage('a', 'one'), stage('b', 'one'), stage('c', 'two')]);
  expect(map.steps.map((step) => [step.from, step.to])).toEqual([
    ['a', 'b'],
    ['b', 'c'],
  ]);
  expect(map.steps[0]?.d).toMatch(/^M [\d.]+ [\d.]+ L /);
  expect(map.steps[1]?.d).toMatch(/^M [\d.]+ [\d.]+ C /);
}

function drawsEachLoopInItsLane(): void {
  const map = layoutMap(phases, [
    stage('a', 'one'),
    stage('b', 'two', ['a']),
    stage('c', 'three', ['a', 'gone', 'c']),
  ]);
  expect(map.loops.map((loop) => [loop.from, loop.to])).toEqual([
    ['b', 'a'],
    ['c', 'a'],
  ]);
  const bottom = Math.max(...map.phases.map((phase) => phase.y + phase.height));
  const [first, second] = map.loops;
  expect(first?.midY).toBeGreaterThan(bottom);
  expect(second?.midY).toBeGreaterThan(first?.midY ?? Infinity);
  expect(map.height).toBeGreaterThan(second?.midY ?? Infinity);
}

function shortensLongTitles(): void {
  expect(shortTitle('Plan approved')).toBe('Plan approved');
  const long = shortTitle('Issue closed and the learning written down');
  expect(long.endsWith('…')).toBe(true);
  expect(long.length).toBeLessThanOrEqual(24);
}

function linksLiveBoxes(): void {
  const live = { ...stage('a', 'one'), label: 'a, 2 items', href: '/q/a' };
  const svg = mapNodes(layoutMap(phases, [live]), options(false));
  const box = found(svg, (n) => n.attrs['data-stage'] === 'a');
  const link = box.children?.[0];
  expect(link?.tag).toBe('a');
  expect(link?.attrs['href']).toBe('/q/a');
  expect(link?.attrs['aria-label']).toBe('a, 2 items');
  expect(all(svg, (n) => n.attrs['data-loop-handle'] !== undefined)).toEqual([]);
}

function editableBoxesHaveHandles(): void {
  const map = layoutMap(phases, [stage('a', 'one'), stage('b', 'two', ['a'])]);
  const svg = mapNodes(map, options(true));
  expect(all(svg, (n) => n.attrs['data-loop-handle'] !== undefined)).toHaveLength(2);
  const hit = found(svg, (n) => n.attrs['data-loop'] === 'b a');
  expect(hit.attrs['tabindex']).toBe('0');
  expect(hit.attrs['aria-label']).toBe('The loop from b to a. Press Delete to remove it.');
  expect(found(svg, (n) => n.attrs['data-feeds'] === 'b a').attrs['stroke-dasharray']).toBe('6 4');
  const remove = removeNode(map, map.loops[0]!);
  expect(remove.attrs['aria-label']).toBe('Remove the loop from b to a');
}

function marksAPersonApprovedStage(): void {
  const gate = {
    ...stage('ship', 'two'),
    gate: true,
    lines: [{ text: '0 of 1 in progress' }, { text: 'Person approves', human: true }],
  };
  const svg = mapNodes(layoutMap(phases, [gate]), options(false));
  const box = found(svg, (n) => n.attrs['data-stage'] === 'ship');
  const human = all(box, (n) => (n.attrs['class'] ?? '').startsWith('gate-'));
  expect(human.map((n) => n.text ?? n.tag)).toEqual(['rect', 'Person approves']);
}

function loopsGoRoundTheBoxes(): void {
  const map = layoutMap(phases, [
    stage('a', 'one'),
    stage('b', 'one'),
    stage('c', 'two'),
    stage('d', 'three', ['a', 'c']),
  ]);
  const turns = map.loops.flatMap((loop) =>
    [...loop.d.matchAll(/H ([\d.-]+)/g)].map((match) => Number(match[1])),
  );
  const inside = turns.filter((x) => map.boxes.some((box) => x > box.x && x < box.x + box.width));
  expect(turns.length).toBeGreaterThan(0);
  expect(inside).toEqual([]);
}

describe('the flow map layout', () => {
  it('stacks the stages of a phase down its column, in the order given', stacksStagesInTheirPhase);

  it('keeps a column for a phase with no stages', keepsAnEmptyPhaseColumn);

  it('leaves out a stage whose phase is not on the map', leavesOutUnknownPhases);

  it(
    'draws one forward arrow between each stage and the next, across phases',
    drawsOneForwardArrowBetween,
  );

  it(
    'draws a loop from each feed to its target, each in its own lane below the columns',
    drawsEachLoopInItsLane,
  );

  it('shortens a long title with an ellipsis and leaves a short one alone', shortensLongTitles);

  it('links a live box to its queue and names it, with no drag handle', linksLiveBoxes);

  it(
    'gives an editable box a loop handle and each loop a focusable target to delete it',
    editableBoxesHaveHandles,
  );

  it(
    'marks a person-approved stage with the human outline and its human line',
    marksAPersonApprovedStage,
  );
  it('runs each loop down the gaps between columns, never through a stage', loopsGoRoundTheBoxes);
});

function options(editable: boolean) {
  return {
    id: 'm',
    title: 'Map',
    desc: 'Stages',
    editable,
    gate: { box: 'gate-box', line: 'gate-line' },
  };
}

function all(root: MapNode, test: (node: MapNode) => boolean): MapNode[] {
  const own = test(root) ? [root] : [];
  return [...own, ...(root.children ?? []).flatMap((child) => all(child, test))];
}

function found(root: MapNode, test: (node: MapNode) => boolean): MapNode {
  const hit = all(root, test)[0];
  if (hit === undefined) throw new Error('not drawn');
  return hit;
}
