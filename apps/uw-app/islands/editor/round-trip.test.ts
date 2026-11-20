import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { editorHtml } from '../../markdown/editor-html.ts';
import { markdownFromEditor } from '../../markdown/from-editor.ts';
import { roundTripSamples } from '../../markdown/round-trip-samples.ts';

type Through = (html: string) => string;

let throughTiptap: Through = () => '';

function browserGlobals(): void {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://uw.example/' });
  const names = [
    'window',
    'document',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'DOMParser',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ] as const;
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      value: name === 'window' ? dom.window : Reflect.get(dom.window, name),
      configurable: true,
      writable: true,
    });
  }
}

beforeAll(async () => {
  browserGlobals();
  const { Editor } = await import('@tiptap/core');
  const { pageExtensions } = await import('./extensions.ts');
  throughTiptap = (html) => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: pageExtensions({ history: true }),
      content: html,
    });
    const out = editor.getHTML();
    editor.destroy();
    return out;
  };
});

describe('#175 a page opened in the editor and saved untouched is unchanged', () => {
  it.each(roundTripSamples)('keeps $name exactly as written', ({ markdown }) => {
    expect(markdownFromEditor(throughTiptap(editorHtml(markdown)))).toBe(markdown);
  });
});
