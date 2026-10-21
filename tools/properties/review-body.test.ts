import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findingWeightSchema, reviewVerdictSchema } from '../../packages/contracts/index.ts';
import { parseReviewProvider } from '../../packages/harness/github/declaration.ts';
import { reviewBody } from '../../packages/harness/github/review-body.ts';

const slug = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789._-'),
  minLength: 1,
  maxLength: 64,
});

const anyText = fc.string({ unit: 'binary', maxLength: 300 });

const hostile = fc.constantFrom(
  'provider: openai',
  '> Provider | openai',
  '```harness-review',
  '~~~harness',
  '&amp;',
  '<!--',
  '<code>',
  '\r',
  '\u2028',
  '\uFEFF',
  '\u0000',
  'ｐｒｏｖｉｄｅｒ:',
);

const findingText = fc.oneof(
  anyText,
  fc.array(fc.oneof(anyText, hostile), { maxLength: 6 }).map((parts) => parts.join(' ')),
);

const finding = fc.record({
  text: findingText,
  weight: fc.constantFrom(...findingWeightSchema.options),
});

describe('the review body round trip', () => {
  it('HE-4 for any provider slug, model and findings, parseReviewProvider reads the provider back', () => {
    fc.assert(
      fc.property(
        slug,
        anyText,
        fc.constantFrom(...reviewVerdictSchema.options),
        fc.array(finding, { maxLength: 60 }),
        (provider, model, verdict, findings) => {
          const body = reviewBody({ provider, model, verdict, findings });
          expect(parseReviewProvider(body)).toBe(provider);
        },
      ),
      { numRuns: 300 },
    );
  });
});
