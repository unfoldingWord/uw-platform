import { describe, expect, it } from 'vitest';
import { editorCanShow } from './editor-html.ts';
import { roundTripSamples } from './round-trip-samples.ts';

describe('#175 a page opens in the formatted editor only when the editor keeps all of it', () => {
  it.each(roundTripSamples.map((sample) => [sample.name, sample.markdown] as const))(
    'keeps %s',
    (_name, markdown) => {
      expect(editorCanShow(markdown)).toBe(true);
    },
  );

  it.each([
    ['a superscript', 'Area is measured in m<sup>2</sup>.'],
    ['a subscript', 'Water is H<sub>2</sub>O.'],
    ['an HTML comment', 'Visible.\n\n<!-- kept for the auditors -->'],
    ['an inline comment', 'Visible <!-- hidden --> text.'],
    ['a keyboard key', 'Press <kbd>Ctrl</kbd>.'],
    ['a summary with markup', '<details>\n<summary><b>Bold</b></summary>\n\nBody.\n\n</details>'],
    ['a raw block', '<div class="note">Boxed.</div>'],
  ])('sends a page with %s to the text field', (_name, markdown) => {
    expect(editorCanShow(markdown)).toBe(false);
  });
});
