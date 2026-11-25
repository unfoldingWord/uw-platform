import { describe, expect, it } from 'vitest';
import { jdIdOfTitle, nextFreeJdId, titleWithJdId } from './jd-ids.ts';

describe('a page title carries its JD ID at its start', () => {
  it('reads the number only when it leads the title and stands alone', () => {
    expect(jdIdOfTitle('00.27 My page')).toBe('00.27');
    expect(jdIdOfTitle('00.27')).toBe('00.27');
    expect(jdIdOfTitle(' 00.27 My page')).toBe('00.27');
    expect(jdIdOfTitle('00.271 My page')).toBeNull();
    expect(jdIdOfTitle('My page 00.27')).toBeNull();
    expect(jdIdOfTitle('00.2 My page')).toBeNull();
  });

  it('gives the next number after the highest one taken in the category', () => {
    expect(nextFreeJdId('01', [])).toBe('01.01');
    expect(nextFreeJdId('01', ['01.05', '01.53', '02.99', '01.11'])).toBe('01.54');
  });

  it('falls back to the first gap when the category is full at the top, and to nothing when full', () => {
    expect(nextFreeJdId('01', ['01.01', '01.99'])).toBe('01.02');
    const every = Array.from({ length: 99 }, (_, n) => `01.${String(n + 1).padStart(2, '0')}`);
    expect(nextFreeJdId('01', every)).toBeNull();
  });

  it('puts a number on a title, replacing the number it had', () => {
    expect(titleWithJdId('My page', '00.27')).toBe('00.27 My page');
    expect(titleWithJdId('01.12 My page', '00.27')).toBe('00.27 My page');
    expect(titleWithJdId('', '00.27')).toBe('00.27 ');
    expect(titleWithJdId('  ', '00.27')).toBe('00.27 ');
  });
});
