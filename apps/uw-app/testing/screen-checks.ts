import axe from 'axe-core';
import { JSDOM } from 'jsdom';

const focusable = 'a[href], button, select, textarea, summary, input:not([type=hidden])';
const fixedWidth = [/\b(?:min-|max-)?w-\[\d/, /\bw-\d{3,}/];
const emoji = /\p{Extended_Pictographic}/u;

async function axeProblems(document: Document): Promise<string[]> {
  const results = await axe.run(document.documentElement, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((violation) => `axe: ${violation.id}: ${violation.help}`);
}

function focusProblems(document: Document): string[] {
  return [...document.querySelectorAll(focusable)]
    .filter((element) => !(element.getAttribute('class') ?? '').includes('focus-visible:outline-2'))
    .map((element) => `no visible focus: ${element.outerHTML.slice(0, 80)}`);
}

function attributeProblems(document: Document): string[] {
  const problems: string[] = [];
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.getAttributeNames()) {
      if (attribute === 'style' || attribute.startsWith('on')) {
        problems.push(`inline ${attribute} on ${element.tagName.toLowerCase()}`);
      }
    }
    const classes = element.getAttribute('class') ?? '';
    if (fixedWidth.some((width) => width.test(classes))) {
      problems.push(`fixed width on ${element.tagName.toLowerCase()}: ${classes}`);
    }
  }
  return problems;
}

function visibleText(document: Document): string {
  const body = document.body.cloneNode(true) as HTMLElement;
  for (const hidden of body.querySelectorAll('script, style, template')) hidden.remove();
  return body.textContent ?? '';
}

function copyProblems(document: Document): string[] {
  const text = visibleText(document);
  const problems: string[] = [];
  if (text.includes('!')) problems.push('an exclamation mark in the copy');
  if (emoji.test(text)) problems.push('an emoji in the copy');
  for (const match of text.matchAll(/unfolding\s*word/gi)) {
    if (match[0] !== 'unfoldingWord') problems.push(`unfoldingWord written ${match[0]}`);
  }
  return problems;
}

function headProblems(document: Document): string[] {
  const problems: string[] = [];
  if (document.querySelector('meta[name="color-scheme"][content="light dark"]') === null) {
    problems.push('no color-scheme meta');
  }
  const scripts = [...document.head.querySelectorAll('script:not([src])')];
  if (!scripts.some((script) => (script.textContent ?? '').includes('uw-theme'))) {
    problems.push('no theme script');
  }
  return problems;
}

export async function screenProblems(html: string): Promise<readonly string[]> {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  try {
    return [
      ...(await axeProblems(document)),
      ...focusProblems(document),
      ...attributeProblems(document),
      ...copyProblems(document),
      ...headProblems(document),
    ];
  } finally {
    dom.window.close();
  }
}
