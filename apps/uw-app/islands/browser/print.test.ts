import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wirePrint } from './print.ts';

describe('#175 a page is printed, or saved as a PDF, from its read view', () => {
  it('prints when the print control is pressed, and at no other press', () => {
    const { document } = new JSDOM(
      '<main><button data-print><span>Print</span></button><button>Other</button></main>',
    ).window;
    let printed = 0;
    wirePrint(document, () => {
      printed += 1;
    });
    document.querySelectorAll('button')[1]?.click();
    expect(printed).toBe(0);
    document.querySelector('span')?.click();
    expect(printed).toBe(1);
  });
});
