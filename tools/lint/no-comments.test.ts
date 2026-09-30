import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noCommentsRule } from './no-comments.ts';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

const invalid = (code: string) => ({ code, errors: [{ messageId: 'comment' }] });

tester.run('no-comments', noCommentsRule, {
  valid: [
    'const total = 1;',
    "const url = 'https://example.org/a//b';",
    'const pattern = /a\\/\\/b/;',
    'const text = `// not a comment`;',
  ],
  invalid: [
    invalid('// a line comment\nconst total = 1;'),
    invalid('const total = 1; // trailing'),
    invalid('/* a block comment */ const total = 1;'),
    invalid('/** JSDoc */\nexport function total(): number { return 1; }'),
    invalid('// eslint-disable-next-line no-console\nconsole.log(1);'),
    invalid('// @ts-ignore\nconst total: number = 1;'),
    invalid('// const commented = out();'),
  ],
});
