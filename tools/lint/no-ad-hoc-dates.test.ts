import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noAdHocDates } from './no-ad-hoc-dates.ts';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

const invalid = (code: string, messageId: string) => ({ code, errors: [{ messageId }] });

tester.run('no-ad-hoc-dates', noAdHocDates, {
  valid: [
    "import { formatDate } from '@uw/core/dates'; formatDate(new Date());",
    'const stamp = new Date().toISOString();',
    "const label = 'Due 2026-03-03';",
    "const text = 'MM is not a date';",
    'const total = amount.toFixed(2);',
    "const words = 'Today'.split(' ');",
  ],
  invalid: [
    invalid('new Date().toLocaleDateString();', 'localeMethod'),
    invalid("new Date().toLocaleDateString('en-US');", 'localeMethod'),
    invalid('when.toLocaleString();', 'localeMethod'),
    invalid('when.toLocaleTimeString();', 'localeMethod'),
    invalid("when['toLocaleString']();", 'localeMethod'),
    invalid('when.toDateString();', 'localeMethod'),
    invalid('when.toUTCString();', 'localeMethod'),
    invalid("new Intl.DateTimeFormat('en-US').format(when);", 'intlFormatter'),
    invalid('new globalThis.Intl.RelativeTimeFormat();', 'intlFormatter'),
    invalid('when.toISOString().slice(0, 10);', 'isoStringCut'),
    invalid("when.toISOString().split('T');", 'isoStringCut'),
    invalid("format(when, 'yyyy-MM-dd');", 'formatToken'),
    invalid("dayjs(when).format('MM/DD/YYYY');", 'formatToken'),
    invalid("format(when, 'MMM d, yyyy');", 'formatToken'),
    invalid("format(when, 'HH:mm');", 'formatToken'),
    invalid('const pattern = `DD.MM.YY`;', 'formatToken'),
  ],
});
