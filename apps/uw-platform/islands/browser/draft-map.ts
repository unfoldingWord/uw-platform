import {
  draftMapStage,
  layoutMap,
  mapClass,
  mapNodes,
  orderWords,
  removeNode,
  type MapLayout,
  type MapNode,
  type MapPhase,
} from '@uw/ui/components/flow-layout.ts';

const svgSpace = 'http://www.w3.org/2000/svg';
const DRAG_START_PX = 4;

export type HitTest = (x: number, y: number) => Element | null;

type Control = HTMLInputElement | HTMLSelectElement;

type Drag =
  | {
      readonly kind: 'move';
      readonly root: HTMLElement;
      readonly key: string;
      readonly box: SVGGElement;
      readonly x: number;
      readonly y: number;
      moved: boolean;
    }
  | { readonly kind: 'loop'; readonly root: HTMLElement; readonly key: string };

function rowsOf(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-draft-rows] > [data-draft-row]')];
}

function rowOf(root: Element, key: string): HTMLElement | undefined {
  return rowsOf(root).find((row) => row.dataset['key'] === key);
}

function control(row: Element, name: string): Control | null {
  return row.querySelector<Control>(`[name="${name}"]`);
}

function chosenText(row: Element, name: string): string {
  const select = row.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  return select?.selectedOptions[0]?.textContent?.trim() ?? '';
}

function loopBoxes(row: Element): HTMLInputElement[] {
  return [...row.querySelectorAll<HTMLInputElement>('input[data-loop]')];
}

function phasesOf(svg: Element): MapPhase[] {
  return [...svg.querySelectorAll('[data-bracket]')].map((phase) => ({
    key: phase.getAttribute('data-bracket') ?? '',
    label: phase.querySelector('text')?.textContent ?? '',
  }));
}

function layoutOf(root: HTMLElement, svg: Element): MapLayout {
  const stages = rowsOf(root).map((row) =>
    draftMapStage({
      key: row.dataset['key'] ?? '',
      title: control(row, 'title')?.value ?? '',
      phase: control(row, 'bracket')?.value ?? '',
      exitGate: control(row, 'exitGate')?.value ?? '',
      pickup: chosenText(row, 'agentPickup'),
      exit: chosenText(row, 'exitGate'),
      feeds: loopBoxes(row)
        .filter((box) => box.checked)
        .map((box) => box.value),
    }),
  );
  return layoutMap(phasesOf(svg), stages);
}

function toDom(document: Document, node: MapNode): Element {
  const element = document.createElementNS(svgSpace, node.tag);
  for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value);
  if (node.text !== undefined) element.textContent = node.text;
  for (const child of node.children ?? []) element.append(toDom(document, child));
  return element;
}

function mapOf(root: Element): { wrapper: HTMLElement; svg: SVGSVGElement } | null {
  const wrapper = root.querySelector<HTMLElement>('[data-draft-map]');
  const svg = wrapper?.querySelector<SVGSVGElement>('svg[data-map-editable]');
  return wrapper === null || wrapper === undefined || svg === null || svg === undefined
    ? null
    : { wrapper, svg };
}

export function redrawMap(root: HTMLElement): void {
  const found = mapOf(root);
  if (found === null) return;
  const layout = layoutOf(root, found.svg);
  const fresh = mapNodes(layout, {
    id: found.wrapper.dataset['mapId'] ?? 'draft-map',
    title: found.wrapper.dataset['mapTitle'] ?? '',
    desc: orderWords(layout),
    editable: true,
    gate: {
      box: found.wrapper.dataset['gateBox'] ?? '',
      line: found.wrapper.dataset['gateLine'] ?? '',
    },
  });
  found.svg.replaceWith(toDom(root.ownerDocument, fresh));
}

function phaseIndex(root: HTMLElement, phase: string): number {
  const found = mapOf(root);
  return found === null ? -1 : phasesOf(found.svg).findIndex((entry) => entry.key === phase);
}

function setPhase(row: Element, phase: string): void {
  const select = control(row, 'bracket');
  if (select !== null) select.value = phase;
}

function moveOnto(root: HTMLElement, row: HTMLElement, target: HTMLElement): void {
  const rows = rowsOf(root);
  if (rows.indexOf(row) < rows.indexOf(target)) target.after(row);
  else target.before(row);
  setPhase(row, control(target, 'bracket')?.value ?? '');
}

function moveIntoPhase(root: HTMLElement, row: HTMLElement, phase: string): void {
  const others = rowsOf(root).filter((entry) => entry !== row);
  const inPhase = others.filter((entry) => control(entry, 'bracket')?.value === phase);
  const wanted = phaseIndex(root, phase);
  const later = others.find(
    (entry) => phaseIndex(root, control(entry, 'bracket')?.value ?? '') > wanted,
  );
  const last = inPhase.at(-1);
  if (last !== undefined) last.after(row);
  else if (later !== undefined) later.before(row);
  else others.at(-1)?.after(row);
  setPhase(row, phase);
}

function dropOnStage(root: HTMLElement, row: HTMLElement, stage: string): boolean {
  const onto = rowOf(root, stage);
  if (onto === undefined || onto === row) return false;
  moveOnto(root, row, onto);
  return true;
}

function dropMove(drag: Extract<Drag, { kind: 'move' }>, target: Element | null): boolean {
  const row = rowOf(drag.root, drag.key);
  if (!drag.moved || row === undefined || target === null) return false;
  const stage = target.closest('[data-stage]')?.getAttribute('data-stage') ?? null;
  if (stage !== null) return dropOnStage(drag.root, row, stage);
  const phase = target.closest('[data-bracket]')?.getAttribute('data-bracket') ?? null;
  if (phase === null) return false;
  moveIntoPhase(drag.root, row, phase);
  return true;
}

function dropLoop(drag: Extract<Drag, { kind: 'loop' }>, target: Element | null): boolean {
  const to = target?.closest('[data-stage]')?.getAttribute('data-stage');
  if (to === undefined || to === null || to === drag.key) return false;
  const row = rowOf(drag.root, drag.key);
  const box = row === undefined ? undefined : loopBoxes(row).find((entry) => entry.value === to);
  if (box === undefined || box.checked) return false;
  box.checked = true;
  return true;
}

function pair(element: Element, name: string): readonly [string, string] | null {
  const [from, to] = (element.getAttribute(name) ?? '').split(' ');
  return from === undefined || to === undefined ? null : [from, to];
}

function clearChoice(svg: Element): void {
  svg.querySelector('[data-loop-remove]')?.remove();
  for (const path of svg.querySelectorAll('[data-feeds]')) {
    path.setAttribute('class', mapClass.loop);
  }
}

function choose(root: HTMLElement, hit: Element): void {
  const found = mapOf(root);
  const ends = pair(hit, 'data-loop');
  if (found === null || ends === null) return;
  clearChoice(found.svg);
  const layout = layoutOf(root, found.svg);
  const loop = layout.loops.find((entry) => entry.from === ends[0] && entry.to === ends[1]);
  if (loop === undefined) return;
  found.svg
    .querySelector(`[data-feeds="${ends[0]} ${ends[1]}"]`)
    ?.setAttribute('class', `${mapClass.loop} ${mapClass.chosen}`);
  found.svg.append(toDom(root.ownerDocument, removeNode(layout, loop)));
}

function unloop(root: HTMLElement, element: Element): boolean {
  const ends = pair(element, element.hasAttribute('data-loop') ? 'data-loop' : 'data-loop-remove');
  if (ends === null) return false;
  const row = rowOf(root, ends[0]);
  const box =
    row === undefined ? undefined : loopBoxes(row).find((entry) => entry.value === ends[1]);
  if (box === undefined || !box.checked) return false;
  box.checked = false;
  return true;
}

function editorOf(target: EventTarget | null): { root: HTMLElement; element: Element } | null {
  const element = target instanceof Object && 'closest' in target ? (target as Element) : null;
  const root = element?.closest<HTMLElement>('[data-draft-editor]') ?? null;
  if (element === null || root === null || element.closest('[data-draft-map]') === null)
    return null;
  return { root, element };
}

function startDrag(event: PointerEvent): Drag | null {
  const found = editorOf(event.target);
  if (found === null) return null;
  const handle = found.element.closest('[data-loop-handle]');
  if (handle !== null) {
    return { kind: 'loop', root: found.root, key: handle.getAttribute('data-loop-handle') ?? '' };
  }
  const box = found.element.closest<SVGGElement>('[data-box]');
  if (box === null) return null;
  const key = box.getAttribute('data-stage') ?? '';
  return {
    kind: 'move',
    root: found.root,
    key,
    box,
    x: event.clientX,
    y: event.clientY,
    moved: false,
  };
}

function scaleOf(box: SVGGElement): number {
  const svg = box.ownerSVGElement;
  const shown = svg?.getBoundingClientRect().width ?? 0;
  const drawn = svg?.viewBox.baseVal?.width ?? 0;
  return shown > 0 && drawn > 0 ? drawn / shown : 1;
}

function follow(drag: Drag, event: PointerEvent): void {
  if (drag.kind !== 'move') return;
  const scale = scaleOf(drag.box);
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= DRAG_START_PX)
    drag.moved = true;
  const dx = (event.clientX - drag.x) * scale;
  const dy = (event.clientY - drag.y) * scale;
  drag.box.setAttribute('transform', `translate(${dx} ${dy})`);
}

function lift(drag: Drag): void {
  if (drag.kind !== 'move') return;
  drag.box.style.pointerEvents = 'none';
  drag.box.classList.add(mapClass.dragging);
}

const removeKeys = new Set(['Delete', 'Backspace']);
const pressKeys = new Set(['Enter', ' ']);

function escape(root: HTMLElement): void {
  const map = mapOf(root);
  if (map !== null) clearChoice(map.svg);
}

function loopTarget(event: Event): { root: HTMLElement; target: Element } | null {
  const found = editorOf(event.target);
  const target = found?.element.closest('[data-loop], [data-loop-remove]') ?? null;
  return found === null || target === null ? null : { root: found.root, target };
}

function onKey(event: KeyboardEvent, changed: (root: HTMLElement) => void): void {
  const found = loopTarget(event);
  if (found === null) return;
  const { target } = found;
  if (event.key === 'Escape') return escape(found.root);
  const pressing = pressKeys.has(event.key);
  if (!pressing && !removeKeys.has(event.key)) return;
  event.preventDefault();
  if (pressing && target.hasAttribute('data-loop')) return choose(found.root, target);
  if (unloop(found.root, target)) changed(found.root);
}

function onClick(event: MouseEvent, changed: (root: HTMLElement) => void): void {
  const found = editorOf(event.target);
  if (found === null) return;
  const remove = found.element.closest('[data-loop-remove]');
  if (remove !== null && unloop(found.root, remove)) return changed(found.root);
  const loop = found.element.closest('[data-loop]');
  if (loop !== null) choose(found.root, loop);
}

export function wireDraftMap(
  document: Document,
  hitTest: HitTest,
  changed: (root: HTMLElement) => void,
): void {
  let drag: Drag | null = null;
  document.addEventListener('pointerdown', (event) => {
    drag = startDrag(event);
    if (drag === null) return;
    event.preventDefault();
    lift(drag);
  });
  document.addEventListener('pointermove', (event) => {
    if (drag !== null) follow(drag, event);
  });
  document.addEventListener('pointerup', (event) => {
    const done = drag;
    drag = null;
    if (done === null) return;
    const target = hitTest(event.clientX, event.clientY);
    const moved = done.kind === 'move' ? dropMove(done, target) : dropLoop(done, target);
    if (moved) changed(done.root);
    else redrawMap(done.root);
  });
  document.addEventListener('click', (event) => onClick(event, changed));
  document.addEventListener('keydown', (event) => onKey(event, changed));
  document.addEventListener('focusin', (event) => {
    const found = editorOf(event.target);
    const loop = found?.element.closest('[data-loop]') ?? null;
    if (found !== null && loop !== null) choose(found.root, loop);
  });
}
