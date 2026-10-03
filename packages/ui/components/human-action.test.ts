import axe from 'axe-core';
import Color from 'colorjs.io';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { resolveToken, themeTokens } from '../../../tools/ui/css-tokens.ts';
import { HumanActionButton, HumanGateMark } from './human-action.tsx';

async function dom(element: ReturnType<typeof jsx>): Promise<Document> {
  const markup = await element.toString();
  return new JSDOM(`<!DOCTYPE html><html lang="en"><body><main>${markup}</main></body></html>`)
    .window.document;
}

function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('not rendered');
  return value;
}

const approve = { label: 'Approve', name: 'decision', value: 'approve' };

function classesOf(element: Element | null): string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/);
}

function contrast(theme: 'light' | 'dark', ink: string, ground: string): number {
  const tokens = themeTokens(theme);
  return new Color(resolveToken(`--uw-${ink}`, tokens)).contrast(
    new Color(resolveToken(`--uw-${ground}`, tokens)),
    'WCAG21',
  );
}

describe('WB-11 the human action', () => {
  it('WB-11 a human action is a Kindle button with an accessible name and visible focus', async () => {
    const document = await dom(jsx(HumanActionButton, approve));
    const button = found(document.querySelector('button'));
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.getAttribute('name')).toBe('decision');
    expect(button.getAttribute('value')).toBe('approve');
    expect(button.textContent).toBe('Approve');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(classesOf(button)).toEqual(
      expect.arrayContaining([
        'bg-kindle',
        'text-on-accent',
        'focus-visible:outline-2',
        'outline-focus',
      ]),
    );
  });

  it('WB-11 a refused human action is disabled with its closed reason shown beside it', async () => {
    const document = await dom(
      jsx(HumanActionButton, { ...approve, disabledReason: 'checks_not_green' }),
    );
    const button = found(document.querySelector('button'));
    expect(button.hasAttribute('disabled')).toBe(true);
    const reason = found(document.getElementById(found(button.getAttribute('aria-describedby'))));
    expect(reason.textContent).toBe('Checks not green');
    expect(reason.parentElement).toBe(button.parentElement);
    expect(`${button.outerHTML}${reason.outerHTML}`).not.toMatch(/red/);
  });
});

describe('the human action, refused or escaped', () => {
  it('a human action without a refusal has no description', async () => {
    const document = await dom(jsx(HumanActionButton, { ...approve, disabledReason: null }));
    expect(document.querySelector('button')?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('a human action escapes its label and its reason', async () => {
    const document = await dom(
      jsx(HumanActionButton, { ...approve, label: '<b>x</b>', disabledReason: '<i>y</i>' }),
    );
    expect(document.querySelector('b, i')).toBeNull();
    expect(document.querySelector('button')?.textContent).toBe('<b>x</b>');
  });

  it('two refused actions on one page describe themselves with different ids', async () => {
    const first = await jsx(HumanActionButton, { ...approve, disabledReason: 'a' }).toString();
    const second = await jsx(HumanActionButton, {
      label: 'Reject',
      name: 'decision',
      value: 'reject',
      disabledReason: 'a',
    }).toString();
    const ids = [first, second].map((markup) => /aria-describedby="([^"]+)"/.exec(markup)?.[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it('WB-11 the human gate mark is a Kindle-edged label in ink on the soft Kindle fill', async () => {
    const document = await dom(jsx(HumanGateMark, { label: 'Ship' }));
    const mark = document.querySelector('span');
    expect(mark?.textContent).toBe('Ship');
    expect(classesOf(mark)).toEqual(
      expect.arrayContaining(['bg-kindle-soft', 'text-ink', 'border', 'border-kindle']),
    );
  });
});

describe('Kindle is a fill or an edge, never a text colour', () => {
  it.each(['light', 'dark'] as const)(
    'the human action text and the gate mark text meet 4.5:1 in %s',
    (theme) => {
      expect(contrast(theme, 'on-accent', 'kindle')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme, 'ink', 'kindle-soft')).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('Kindle on the light surface is below 4.5:1, so no piece writes text in Kindle', async () => {
    expect(contrast('light', 'kindle', 'surface')).toBeLessThan(4.5);
    const markup = [
      await jsx(HumanActionButton, approve).toString(),
      await jsx(HumanActionButton, { ...approve, disabledReason: 'x' }).toString(),
      await jsx(HumanGateMark, { label: 'Ship' }).toString(),
    ].join('');
    expect(markup).not.toMatch(/\btext-kindle/);
  });
});

describe('the human action passes axe-core', () => {
  it('has no axe-core violations, enabled, refused and as a gate mark', async () => {
    const parts = [
      jsx(HumanActionButton, approve),
      jsx(HumanActionButton, { ...approve, value: 'reject', disabledReason: 'checks_not_green' }),
      jsx(HumanGateMark, { label: 'Ship' }),
    ];
    const markup = (await Promise.all(parts.map((part) => part.toString()))).join('');
    const window = new JSDOM(
      `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><form>${markup}</form></main></body></html>`,
      { runScripts: 'outside-only' },
    ).window;
    window.eval(axe.source);
    const runner = (window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(window.document, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.passes.map((pass) => pass.id)).toEqual(expect.arrayContaining(['button-name']));
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    window.close();
  });
});
