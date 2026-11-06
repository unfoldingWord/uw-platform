import { literalTexts } from './colour-literals.ts';

const lengthLiteral = /(?<![\w#.-])\d*\.?\d+(?:px|rem|em)\b/;
const sizedProperty =
  /\b(?:width|height|margin|padding|gap|inset|top|left|right|bottom|font-size|line-height|letter-spacing|border-radius|border-width|outline-offset)[\w-]*\s*:\s*[^;"'`]*?\d(?:px|rem|em)\b/;
const shadowProperty = /\bbox-shadow\s*:(?!\s*(?:var\(|none\b|inherit\b|initial\b))/;
const breakpoint = /^\s*--breakpoint-[\w-]+\s*:/;

function topLevelSegments(token: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of token) {
    if (character === '[') depth += 1;
    if (character === ']') depth -= 1;
    if (character === ':' && depth === 0) {
      segments.push(current);
      current = '';
    } else current += character;
  }
  return [...segments, current];
}

function isArbitraryUtility(token: string): boolean {
  const utility = topLevelSegments(token).at(-1) ?? '';
  return /^!?-?[a-z][\w-]*-\[[^\]]+\]$/.test(utility) || /^\[[\w-]+:[^\]]+\]$/.test(utility);
}

export function arbitraryClasses(path: string, text: string): string[] {
  return literalTexts(path, text)
    .flatMap((literal) => literal.replace(/^["'`}]|["'`$]$/g, '').split(/[\s"'`]+/))
    .filter(isArbitraryUtility);
}

export function rawCssValues(text: string): string[] {
  return text
    .split(/[;{}]/)
    .filter((declaration) => !breakpoint.test(declaration))
    .filter((declaration) => lengthLiteral.test(declaration) || shadowProperty.test(declaration))
    .map((declaration) => declaration.trim());
}

export function rawStyleValues(path: string, text: string): string[] {
  return literalTexts(path, text).filter(
    (literal) => sizedProperty.test(literal) || shadowProperty.test(literal),
  );
}
