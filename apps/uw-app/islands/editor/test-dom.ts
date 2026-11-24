import { JSDOM } from 'jsdom';

const copied = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLSpanElement',
  'HTMLImageElement',
  'HTMLInputElement',
  'SVGElement',
  'Text',
  'DocumentFragment',
  'ShadowRoot',
  'Range',
  'Selection',
  'DOMParser',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

class Unobserved {
  observe(): void {
    return undefined;
  }
  unobserve(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
}

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

export function installDom(html: string, url = 'https://uw.example/'): JSDOM {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const { window } = dom;
  for (const name of copied) {
    define(name, name === 'window' ? window : Reflect.get(window, name));
  }
  define('addEventListener', window.addEventListener.bind(window));
  define('removeEventListener', window.removeEventListener.bind(window));
  define('dispatchEvent', window.dispatchEvent.bind(window));
  define('ResizeObserver', Unobserved);
  define('IntersectionObserver', Unobserved);
  Object.defineProperty(window, 'ResizeObserver', { value: Unobserved, configurable: true });
  Object.defineProperty(window, 'IntersectionObserver', { value: Unobserved, configurable: true });
  return dom;
}
