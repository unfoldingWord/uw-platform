import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { editorHtml } from './editor-html.ts';
import { markdownFromEditor } from '../islands/editor/from-editor.ts';
import { roundTripSamples } from './round-trip-samples.ts';

type Through = (html: string) => string;
type Shown = (html: string) => HTMLElement;

let throughTiptap: Through = () => '';
let shownInEditor: Shown = () => document.createElement('div');

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
  const { pageExtensions } = await import('../islands/editor/extensions.ts');
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
  shownInEditor = (html) => {
    const element = document.createElement('div');
    new Editor({ element, extensions: pageExtensions({ history: true }), content: html });
    return element;
  };
});

describe('#175 a page opened in the editor and saved untouched is unchanged', () => {
  it.each(roundTripSamples)('keeps $name exactly as written', ({ markdown }) => {
    expect(markdownFromEditor(throughTiptap(editorHtml(markdown)))).toBe(markdown);
  });
});

describe('#214 a video page file in the editor shows as a video and saves unchanged', () => {
  const VIDEO = '00000000-0000-4000-8000-0000000000a1';
  const IMAGE = '00000000-0000-4000-8000-0000000000a2';
  const kindOf = (id: string) =>
    id === VIDEO ? ('video' as const) : id === IMAGE ? ('image' as const) : null;
  const markdown = `Watch this.\n\n![Zoom walkthrough](/api/files/${VIDEO})\n\n![Settings](/api/files/${IMAGE})`;

  it('draws a player for the video and a picture for the image', () => {
    const shown = shownInEditor(editorHtml(markdown, kindOf));
    const video = shown.querySelector('video');
    expect(video?.getAttribute('src')).toBe(`/api/files/${VIDEO}`);
    expect(video?.getAttribute('title')).toBe('Zoom walkthrough');
    expect(video?.hasAttribute('controls')).toBe(true);
    const images = [...shown.querySelectorAll('img[src]')].map((image) =>
      image.getAttribute('src'),
    );
    expect(images).toEqual([`/api/files/${IMAGE}`]);
  });

  it('saves the same markdown embed for the video', () => {
    expect(markdownFromEditor(throughTiptap(editorHtml(markdown, kindOf)))).toBe(markdown);
  });
});
