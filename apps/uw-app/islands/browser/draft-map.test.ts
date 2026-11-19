import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { DRAFT_CHECK_MS, wireDraftEditor, type DraftTimers } from './draft-editor.ts';
import { redrawMap } from './draft-map.ts';

const harnessId = 'd7000000-0000-4000-8000-000000000009';

function options(chosen: string, values: readonly (readonly [string, string])[]): string {
  return values
    .map(
      ([value, text]) =>
        `<option value="${value}"${value === chosen ? ' selected' : ''}>${text}</option>`,
    )
    .join('');
}

function row(
  key: string,
  phase: string,
  feeds: readonly string[],
  others: readonly string[],
): string {
  const loops = others
    .map(
      (other) =>
        `<label><input type="checkbox" data-loop value="${other}"${feeds.includes(other) ? ' checked' : ''}>${other}</label>`,
    )
    .join('');
  return `<li data-draft-row data-id="" data-key="${key}" data-instructions="" data-validators="">
    <input name="title" value="${key}">
    <select name="bracket">${options(phase, [
      ['build_package', 'Build package'],
      ['iterate', 'Iterate'],
    ])}</select>
    <select name="exitGate">${options('checks', [
      ['checks', 'Checks pass'],
      ['human_approval', 'A person approves'],
    ])}</select>
    <select name="agentPickup">${options('allowed', [['allowed', 'Agents may pick up']])}</select>
    <select name="connector"><option value="none" selected>None</option></select>
    <input name="wipLimit" type="number" value="3">
    <fieldset data-loops><legend>Loops back to</legend>${loops}</fieldset>
    <ul data-problems></ul></li>`;
}

function page(feeds: readonly string[] = []): JSDOM {
  const svg = `<svg data-map-editable viewBox="0 0 10 10"><g data-bracket="build_package"><text>Build package</text></g><g data-bracket="iterate"><text>Iterate</text></g></svg>`;
  const markup = `<section data-draft-editor data-harness="${harnessId}" data-revision="2">
    <p data-draft-status></p>
    <form data-command="publish_workflow_draft"><input type="hidden" name="revision" value="2" data-draft-revision><button type="submit" data-draft-publish>Publish</button></form>
    <div data-draft-map data-map-id="draft-map-x" data-map-title="Software draft, as a map" data-gate-box="gate-box" data-gate-line="gate-line">${svg}</div>
    <ul data-draft-general></ul>
    <ol data-draft-rows>${row('plan', 'build_package', feeds, ['check', 'ship'])}${row('check', 'build_package', [], ['plan', 'ship'])}${row('ship', 'build_package', [], ['plan', 'check'])}</ol>
    </section>`;
  return new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://uw.example/' });
}

function wired(feeds: readonly string[] = []) {
  const dom = page(feeds);
  const document = dom.window.document;
  const waiting = new Map<number, () => void>();
  let next = 0;
  const timers: DraftTimers = {
    setTimeout: (run, ms) => {
      expect(ms).toBe(DRAFT_CHECK_MS);
      next += 1;
      waiting.set(next, run);
      return next;
    },
    clearTimeout: (handle) => waiting.delete(Number(handle)),
  };
  const aim: { target: Element | null } = { target: null };
  const fetch = (async () => new Response('{}', { status: 200 })) as typeof globalThis.fetch;
  wireDraftEditor(document, { fetch, uuid: () => 'r', timers, hitTest: () => aim.target });
  const root = document.querySelector<HTMLElement>('[data-draft-editor]');
  if (root === null) throw new Error('no editor');
  redrawMap(root);
  return { dom, document, waiting, aim };
}

type Wired = ReturnType<typeof wired>;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}

function pointer(scene: Wired, type: string, element: Element, at = 5): void {
  element.dispatchEvent(
    new scene.dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at,
      clientY: at,
    }),
  );
}

function dragTo(scene: Wired, from: Element, onto: Element | null): void {
  pointer(scene, 'pointerdown', from);
  pointer(scene, 'pointermove', from, 40);
  scene.aim.target = onto;
  pointer(scene, 'pointerup', from, 40);
}

function clickOnly(scene: Wired, from: Element, onto: Element | null): void {
  pointer(scene, 'pointerdown', from);
  scene.aim.target = onto;
  pointer(scene, 'pointerup', from);
}

function box(scene: Wired, key: string): Element {
  return must(scene.document.querySelector(`[data-draft-map] [data-stage="${key}"]`));
}

function rowKeys(scene: Wired): readonly (string | undefined)[] {
  return [
    ...scene.document.querySelectorAll<HTMLElement>('[data-draft-rows] > [data-draft-row]'),
  ].map((entry) => entry.dataset['key']);
}

function mapKeys(scene: Wired): readonly (string | null)[] {
  return [...scene.document.querySelectorAll('[data-draft-map] [data-box]')].map((entry) =>
    entry.getAttribute('data-stage'),
  );
}

function phaseOf(scene: Wired, key: string): string {
  return must(
    scene.document.querySelector<HTMLSelectElement>(`[data-key="${key}"] [name="bracket"]`),
  ).value;
}

function loopTicked(scene: Wired, from: string, to: string): boolean {
  return must(
    scene.document.querySelector<HTMLInputElement>(
      `[data-key="${from}"] input[data-loop][value="${to}"]`,
    ),
  ).checked;
}

function movesADraggedStagePast(): void {
  const scene = wired();
  expect(mapKeys(scene)).toEqual(['plan', 'check', 'ship']);
  dragTo(scene, box(scene, 'plan'), box(scene, 'ship').querySelector('rect'));
  expect(rowKeys(scene)).toEqual(['check', 'ship', 'plan']);
  expect(mapKeys(scene)).toEqual(['check', 'ship', 'plan']);
  expect(scene.waiting.size).toBe(1);
}

function movesIntoADroppedPhase(): void {
  const scene = wired();
  const iterate = must(
    scene.document.querySelector('[data-draft-map] [data-bracket="iterate"] rect'),
  );
  dragTo(scene, box(scene, 'check'), iterate);
  expect(phaseOf(scene, 'check')).toBe('iterate');
  expect(rowKeys(scene)).toEqual(['plan', 'ship', 'check']);
  const x = (key: string) => Number(box(scene, key).querySelector('rect')?.getAttribute('x'));
  expect(x('check')).toBeGreaterThan(x('ship'));
}

function drawsALoopFromTheHandle(): void {
  const scene = wired();
  const handle = must(box(scene, 'ship').querySelector('[data-loop-handle]'));
  dragTo(scene, handle, box(scene, 'plan'));
  expect(loopTicked(scene, 'ship', 'plan')).toBe(true);
  expect(scene.document.querySelector('[data-draft-map] [data-feeds="ship plan"]')).not.toBeNull();
  expect(scene.waiting.size).toBe(1);
}

function removesALoopWithDelete(): void {
  const scene = wired(['ship']);
  const loop = must(scene.document.querySelector('[data-draft-map] [data-loop="plan ship"]'));
  loop.dispatchEvent(new scene.dom.window.MouseEvent('click', { bubbles: true }));
  const remove = must(scene.document.querySelector('[data-loop-remove="plan ship"]'));
  expect(remove.getAttribute('aria-label')).toBe('Remove the loop from plan to ship');
  remove.dispatchEvent(
    new scene.dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
  );
  expect(loopTicked(scene, 'plan', 'ship')).toBe(false);
  expect(scene.document.querySelector('[data-draft-map] [data-feeds]')).toBeNull();
  expect(scene.waiting.size).toBe(1);
}

function redrawsABoxOnEdit(): void {
  const scene = wired();
  const title = must(
    scene.document.querySelector<HTMLInputElement>('[data-key="check"] [name="title"]'),
  );
  title.value = 'Review verdict';
  title.dispatchEvent(new scene.dom.window.Event('input', { bubbles: true }));
  expect(box(scene, 'check').querySelector('text')?.textContent).toBe('Review verdict');
}

function ignoresDeadDrops(): void {
  const scene = wired();
  dragTo(scene, box(scene, 'plan'), null);
  dragTo(scene, box(scene, 'check'), box(scene, 'check'));
  const handle = must(box(scene, 'plan').querySelector('[data-loop-handle]'));
  dragTo(scene, handle, box(scene, 'plan'));
  expect(rowKeys(scene)).toEqual(['plan', 'check', 'ship']);
  expect(loopTicked(scene, 'plan', 'check')).toBe(false);
  expect(scene.waiting.size).toBe(0);
  expect(box(scene, 'plan').getAttribute('transform')).toBeNull();
}

function aClickIsNotADrag(): void {
  const scene = wired();
  const own = must(
    scene.document.querySelector('[data-draft-map] [data-bracket="build_package"] rect'),
  );
  clickOnly(scene, box(scene, 'plan'), own);
  expect(rowKeys(scene)).toEqual(['plan', 'check', 'ship']);
  expect(scene.waiting.size).toBe(0);
}

function focusShowsTheChoice(): void {
  const scene = wired(['ship']);
  const loop = must(
    scene.document.querySelector<SVGElement>('[data-draft-map] [data-loop="plan ship"]'),
  );
  loop.dispatchEvent(new scene.dom.window.FocusEvent('focusin', { bubbles: true }));
  expect(scene.document.querySelector('[data-loop-remove="plan ship"]')).not.toBeNull();
  const drawn = scene.document.querySelector('[data-draft-map] [data-feeds="plan ship"]');
  expect(drawn?.getAttribute('class')).toContain('stroke-accent-text');
  expect(loop.getAttribute('class')).toContain('outline-none');
}

function gateUsesThePageStyle(): void {
  const scene = wired();
  const exit = must(
    scene.document.querySelector<HTMLSelectElement>('[data-key="ship"] [name="exitGate"]'),
  );
  exit.value = 'human_approval';
  exit.dispatchEvent(new scene.dom.window.Event('change', { bubbles: true }));
  const ship = box(scene, 'ship');
  expect(ship.querySelector('rect')?.getAttribute('class')).toBe('gate-box');
  const last = [...ship.querySelectorAll('text')].at(-1);
  expect([last?.textContent, last?.getAttribute('class')]).toEqual([
    'A person approves',
    'gate-line',
  ]);
}

describe('#109 the draft map edits the workflow by dragging', () => {
  it(
    'moves a dragged stage past the stage it is dropped on, redraws the map and starts one save',
    movesADraggedStagePast,
  );

  it('moves a stage dropped on another phase into that phase', movesIntoADroppedPhase);

  it('draws a loop from a stage’s handle to the stage it is dropped on', drawsALoopFromTheHandle);

  it('removes a selected loop with Delete', removesALoopWithDelete);

  it('redraws a box as its row is edited', redrawsABoxOnEdit);

  it('changes nothing when a stage is dropped on itself or outside the map', ignoresDeadDrops);

  it('leaves the order alone when a stage is clicked without moving', aClickIsNotADrag);

  it(
    'shows a focused loop as chosen, with its remove button, instead of an outline',
    focusShowsTheChoice,
  );

  it('draws a person-approved stage with the gate style the page hands it', gateUsesThePageStyle);
});
