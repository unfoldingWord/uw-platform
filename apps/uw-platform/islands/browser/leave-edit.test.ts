import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { LEAVE_QUESTION, wireLeaveEdit } from './leave-edit.ts';

type Screen = {
  readonly inEditMode?: boolean;
  readonly live?: boolean;
  readonly unsaved?: boolean;
  readonly answer?: boolean;
};

function screen(options: Screen = {}) {
  const live = options.live === true ? ' data-draft-live=""' : '';
  const unsaved = options.unsaved === true ? ' data-unsaved=""' : '';
  const back =
    options.inEditMode === false ? '' : '<a href="/pages/p1" data-leave-edit>Back to reading</a>';
  const dom = new JSDOM(
    `<body><main><form data-page-edit${live}${unsaved}>${back}<input name="title"><div contenteditable="true">x</div></form><dialog open><button>Close</button></dialog></main></body>`,
  );
  const document = dom.window.document;
  const went: string[] = [];
  const asked: string[] = [];
  wireLeaveEdit(document, {
    go: (href) => went.push(href),
    confirm: (question) => {
      asked.push(question);
      return options.answer ?? false;
    },
  });
  const press = (target: Element | null, init: KeyboardEventInit = {}) =>
    target?.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  const type = () =>
    document
      .querySelector('input[name="title"]')
      ?.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const clickBack = () => {
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a[data-leave-edit]')?.dispatchEvent(click);
    return click.defaultPrevented;
  };
  const unload = () => {
    const event = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const save = (blocked: boolean) => {
    const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    if (blocked) event.preventDefault();
    document.querySelector('form')?.dispatchEvent(event);
  };
  return { document, went, asked, press, type, clickBack, unload, save };
}

describe('ADR 0026 Esc leaves edit mode for the read view, as Back to reading does', () => {
  it('goes to the read view when Esc is pressed outside any field and nothing changed', () => {
    const made = screen();
    made.press(made.document.body);
    expect(made.went).toEqual(['/pages/p1']);
    expect(made.asked).toEqual([]);
  });

  it('leaves Esc alone in the title, in the editor, in an open dialog, with a modifier, or off edit mode', () => {
    const made = screen();
    made.press(made.document.querySelector('input'));
    made.press(made.document.querySelector('[contenteditable]'));
    made.press(made.document.querySelector('dialog button'));
    made.press(made.document.body, { shiftKey: true });
    expect(made.went).toEqual([]);
    const reading = screen({ inEditMode: false });
    reading.press(reading.document.body);
    expect(reading.went).toEqual([]);
  });
});

describe('ADR 0026 leaving edit mode never drops text no shared draft holds without asking', () => {
  it('asks before Esc leaves typed text with no shared draft, and stays when the answer is no', () => {
    const made = screen();
    made.type();
    made.press(made.document.body);
    expect(made.asked).toEqual([LEAVE_QUESTION]);
    expect(made.went).toEqual([]);
  });

  it('leaves after asking when the answer is yes', () => {
    const made = screen({ answer: true });
    made.type();
    made.press(made.document.body);
    expect(made.went).toEqual(['/pages/p1']);
  });

  it('asks for text kept from a refused save even before anything is typed', () => {
    const made = screen({ unsaved: true });
    made.press(made.document.body);
    expect(made.asked).toEqual([LEAVE_QUESTION]);
    expect(made.went).toEqual([]);
  });

  it('does not ask while a shared draft holds the text', () => {
    const made = screen({ live: true });
    made.type();
    made.press(made.document.body);
    expect(made.asked).toEqual([]);
    expect(made.went).toEqual(['/pages/p1']);
  });

  it('asks on Back to reading too, and keeps the person on the page when the answer is no', () => {
    const made = screen();
    made.type();
    expect(made.clickBack()).toBe(true);
    expect(made.asked).toEqual([LEAVE_QUESTION]);
    const clean = screen();
    expect(clean.clickBack()).toBe(false);
    expect(clean.asked).toEqual([]);
  });
});

describe('leaving through the frame, switcher or browser', () => {
  it('guards navigation after typing or a refused save, but allows shared drafts', () => {
    const made = screen();
    expect(made.unload()).toBe(false);
    made.type();
    expect(made.unload()).toBe(true);
    expect(screen({ unsaved: true }).unload()).toBe(true);
    expect(screen({ unsaved: true, live: true }).unload()).toBe(false);
  });

  it('protects a title change even when the body is in a shared draft', () => {
    const made = screen({ live: true });
    const title = made.document.querySelector('input');
    if (title === null) throw new Error('Missing title field');
    title.value = 'Updated title';
    made.type();
    expect(made.unload()).toBe(true);
  });

  it('allows a save or confirmed departure without a second prompt', () => {
    const made = screen({ unsaved: true, answer: true });
    made.save(true);
    expect(made.unload()).toBe(true);
    made.save(false);
    expect(made.unload()).toBe(false);
    made.type();
    expect(made.unload()).toBe(true);
    made.clickBack();
    expect(made.unload()).toBe(false);
  });
});
