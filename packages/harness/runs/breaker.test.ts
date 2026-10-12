import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEND_CAP, levelOf } from './breaker.ts';

describe('the spend breaker levels', () => {
  it('HE-5 the levels trip at 75 and 90 percent of the cap', () => {
    const { capMinor } = DEFAULT_SPEND_CAP;
    const at = (percent: number) => levelOf((capMinor * percent) / 100, capMinor);
    expect(at(74)).toEqual({ level: 'open', percent: 74 });
    expect(at(75)).toEqual({ level: 'holding', percent: 75 });
    expect(at(89)).toEqual({ level: 'holding', percent: 89 });
    expect(at(90)).toEqual({ level: 'pausing', percent: 90 });
    expect(at(120)).toEqual({ level: 'pausing', percent: 120 });
    expect(levelOf(93_749, capMinor)).toEqual({ level: 'open', percent: 74 });
  });
});
