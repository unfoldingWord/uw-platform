import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireLeaveEdit } from './leave-edit.ts';

function screen(inEditMode: boolean) {
  const back = inEditMode ? '<a href="/pages/p1" data-leave-edit>Back to reading</a>' : '';
  const dom = new JSDOM(
    `<body><main>${back}<input name="title"><div contenteditable="true">x</div><dialog open><button>Close</button></dialog></main></body>`,
  );
  const went: string[] = [];
  wireLeaveEdit(dom.window.document, (href) => went.push(href));
  const press = (target: Element | null, init: KeyboardEventInit = {}) =>
    target?.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  return { document: dom.window.document, went, press };
}

describe('ADR 0026 Esc leaves edit mode for the read view, as Back to reading does', () => {
  it('goes to the read view when Esc is pressed outside any field', () => {
    const made = screen(true);
    made.press(made.document.body);
    expect(made.went).toEqual(['/pages/p1']);
  });

  it('leaves Esc alone in the title, in the editor, in an open dialog, with a modifier, or off edit mode', () => {
    const made = screen(true);
    made.press(made.document.querySelector('input'));
    made.press(made.document.querySelector('[contenteditable]'));
    made.press(made.document.querySelector('dialog button'));
    made.press(made.document.body, { shiftKey: true });
    expect(made.went).toEqual([]);
    const reading = screen(false);
    reading.press(reading.document.body);
    expect(reading.went).toEqual([]);
  });
});
