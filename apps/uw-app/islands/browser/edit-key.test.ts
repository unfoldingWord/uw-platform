import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireEditKey } from './edit-key.ts';

function screen(withPencil: boolean) {
  const pencil = withPencil ? '<a href="/pages/p1/edit" aria-label="Edit this page">Edit</a>' : '';
  const dom = new JSDOM(
    `<body><main>${pencil}<input name="q"><div contenteditable="true">x</div></main></body>`,
  );
  const went: string[] = [];
  wireEditKey(dom.window.document, (href) => went.push(href));
  const press = (target: Element | null, init: KeyboardEventInit = {}) =>
    target?.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'e',
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  return { document: dom.window.document, went, press };
}

describe('#175 the e key opens edit mode, as the pencil does', () => {
  it('goes to the pencil address when e is pressed on the page', () => {
    const made = screen(true);
    made.press(made.document.body);
    expect(made.went).toEqual(['/pages/p1/edit']);
  });

  it('leaves e alone while typing, with a modifier, or where there is no pencil', () => {
    const made = screen(true);
    made.press(made.document.querySelector('input'));
    made.press(made.document.querySelector('[contenteditable]'));
    made.press(made.document.body, { ctrlKey: true });
    made.press(made.document.body, { metaKey: true });
    expect(made.went).toEqual([]);
    const reader = screen(false);
    reader.press(reader.document.body);
    expect(reader.went).toEqual([]);
  });
});
