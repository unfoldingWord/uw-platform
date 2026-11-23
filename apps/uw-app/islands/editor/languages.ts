import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { LanguageDescription, type LanguageSupport } from '@codemirror/language';

function described(
  name: string,
  alias: readonly string[],
  support: () => LanguageSupport,
): LanguageDescription {
  return LanguageDescription.of({
    name,
    alias: [...alias],
    load: () => Promise.resolve(support()),
  });
}

export const codeLanguages: readonly LanguageDescription[] = [
  described('JavaScript', ['js', 'javascript'], () => javascript()),
  described('TypeScript', ['ts', 'typescript'], () => javascript({ typescript: true })),
  described('JSON', ['json'], () => json()),
  described('Python', ['py', 'python'], () => python()),
  described('HTML', ['html'], () => html()),
  described('CSS', ['css'], () => css()),
  described('SQL', ['sql'], () => sql()),
  described('YAML', ['yaml', 'yml'], () => yaml()),
  described('Markdown', ['md', 'markdown'], () => markdown()),
];
