import { describe, expect, it } from 'vitest';
import { areaOfCategory, jdAreaSchema, jdCategorySchema, jdIdSchema } from './areas.ts';

describe('a category sits in one decade', () => {
  it('takes two digits and nothing else', () => {
    expect(jdCategorySchema.safeParse('61').success).toBe(true);
    expect(jdCategorySchema.safeParse('6').success).toBe(false);
    expect(jdCategorySchema.safeParse('610').success).toBe(false);
    expect(jdCategorySchema.safeParse('6a').success).toBe(false);
  });

  it('gives each category the area of its decade, so 60 and 74 are in different areas', () => {
    expect(areaOfCategory('60')).toBe('60-69');
    expect(areaOfCategory('61')).toBe('60-69');
    expect(areaOfCategory('74')).toBe('70-79');
    expect(areaOfCategory('01')).toBe('00-09');
    expect(jdAreaSchema.safeParse(areaOfCategory('99')).success).toBe(true);
  });

  it('takes a JD ID as NN.NN', () => {
    expect(jdIdSchema.safeParse('01.47').success).toBe(true);
    expect(jdIdSchema.safeParse('1.47').success).toBe(false);
    expect(jdIdSchema.safeParse('01.4').success).toBe(false);
  });
});
