import axe from 'axe-core';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { KanbanCard } from './kanban-card.tsx';
import { Lane } from './lane.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('not rendered');
  return value;
}

const card = (title: string) =>
  jsx(KanbanCard, { title, href: `/items/${title}`, meta: [{ label: 'Owner', value: 'Ana' }] });

describe('WB-11 the lane', () => {
  it('WB-11 a lane shows its count against its WIP limit and says when it is paused', async () => {
    const document = await dom(
      jsx(Lane, {
        stageKey: 'build',
        title: 'Build',
        count: 3,
        wipLimit: 3,
        paused: true,
        children: card('one'),
      }),
    );
    const lane = found(document.querySelector('section'));
    const heading = found(document.getElementById(found(lane.getAttribute('aria-labelledby'))));
    expect(heading.textContent).toBe('Build');
    expect(lane.contains(heading)).toBe(true);
    expect(lane.textContent).toContain('3 of 3');
    const badge = found(
      [...lane.querySelectorAll('span')].find((span) => span.textContent === 'Paused'),
    );
    expect(badge.getAttribute('class')).toContain('border-dashed');
    expect(found(lane.querySelector('article a')).getAttribute('href')).toBe('/items/one');
  });

  it('a lane that is not paused says nothing about pausing', async () => {
    const document = await dom(
      jsx(Lane, { stageKey: 'build', title: 'Build', count: 1, wipLimit: 3 }),
    );
    expect(document.body.textContent).not.toContain('Paused');
    expect(document.body.textContent).toContain('1 of 3');
  });

  it('a lane escapes its title', async () => {
    const document = await dom(
      jsx(Lane, { stageKey: 'build', title: '<b>x</b>', count: 0, wipLimit: 1 }),
    );
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('<b>x</b>');
  });
});

describe('the lane ids and keyboard order', () => {
  it('lanes with colliding or non-Latin titles each label themselves with their own heading', async () => {
    const lanes = [
      ['build', 'Build'],
      ['build_again', 'build!'],
      ['check', 'Строить'],
      ['review', 'Проверка'],
    ].map(([stageKey, title]) =>
      jsx(Lane, { stageKey: found(stageKey), title: found(title), count: 0, wipLimit: 1 }),
    );
    const markup = (await Promise.all(lanes.map((lane) => lane.toString()))).join('');
    const document = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`).window.document;
    const named = [...document.querySelectorAll('section')].map(
      (lane) =>
        found(document.getElementById(found(lane.getAttribute('aria-labelledby')))).textContent,
    );
    expect(named).toEqual(['Build', 'build!', 'Строить', 'Проверка']);
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('every card in a lane is reached with the keyboard through its link, in order', async () => {
    const document = await dom(
      jsx(Lane, {
        stageKey: 'build',
        title: 'Build',
        count: 2,
        wipLimit: 3,
        children: [card('one'), card('two')],
      }),
    );
    const stops = [...document.querySelectorAll('a, button, [tabindex]')];
    expect(stops.map((stop) => stop.getAttribute('href'))).toEqual(['/items/one', '/items/two']);
    expect(document.querySelector('[tabindex^="-"]')).toBeNull();
  });
});

describe('the lane passes axe-core', () => {
  it('has no axe-core violations, paused, with cards', async () => {
    const lane = jsx(Lane, {
      stageKey: 'build',
      title: 'Build',
      count: 2,
      wipLimit: 3,
      paused: true,
      children: [card('one'), card('two')],
    });
    const window = new JSDOM(
      `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main>${await lane.toString()}</main></body></html>`,
      { runScripts: 'outside-only' },
    ).window;
    window.eval(axe.source);
    const runner = (window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(window.document, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.passes.map((pass) => pass.id)).toEqual(expect.arrayContaining(['link-name']));
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    window.close();
  });
});
