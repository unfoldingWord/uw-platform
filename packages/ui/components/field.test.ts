import axe from 'axe-core';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SelectField, TextAreaField, TextField } from './field.tsx';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

async function fields(): Promise<JSDOM> {
  const markup = await jsx(
    'div',
    {},
    jsx(TextField, { name: 'title', label: 'Title', scope: 'a', maxLength: 200, required: true }),
    jsx(TextAreaField, {
      name: 'findings',
      label: 'Findings',
      hint: 'One finding per line',
      scope: 'a',
      maxLength: 25_000,
    }),
    jsx(SelectField, {
      name: 'beforeItemId',
      label: 'Move before',
      scope: 'a',
      choices: [
        { value: '', label: 'The end' },
        { value: 'x', label: 'Draw the icon' },
      ],
      selected: 'x',
    }),
  ).toString();
  return new JSDOM(
    `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><form>${markup}</form></main></body></html>`,
  );
}

function labelOf(document: Document, control: Element): Element | null {
  return document.querySelector(`label[for="${control.id}"]`);
}

async function labelledAndFocusable(): Promise<void> {
  const page = await fields();
  const { document } = page.window;
  const controls = [...document.querySelectorAll('input, textarea, select')];
  expect(controls.map((control) => control.getAttribute('name'))).toEqual([
    'title',
    'findings',
    'beforeItemId',
  ]);
  for (const control of controls) {
    expect(labelOf(document, control)?.textContent?.trim()).not.toBe('');
    expect(labelOf(document, control)?.classList.contains('sr-only')).toBe(false);
    expect(control.getAttribute('class')).toContain(focus);
  }
  page.window.close();
}

async function boundsAndHint(): Promise<void> {
  const page = await fields();
  const { document } = page.window;
  const input = document.querySelector('input');
  expect([input?.getAttribute('maxlength'), input?.hasAttribute('required')]).toEqual([
    '200',
    true,
  ]);
  const textarea = document.querySelector('textarea');
  const hint = document.getElementById(textarea?.getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toBe('One finding per line');
  expect(document.querySelector('option[selected]')?.getAttribute('value')).toBe('x');
  const results = await axe.run(document.documentElement, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  page.window.close();
}

describe('the form fields', () => {
  it('each field has a visible label bound to its control and visible focus', labelledAndFocusable);
  it('a field carries its bounds and hint, and the fields pass axe', boundsAndHint);
});
