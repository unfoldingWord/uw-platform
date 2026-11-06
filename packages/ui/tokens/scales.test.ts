import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { brandAnchors, colourScales, type ScaleName } from '../../../tools/ui/scales.ts';

const designTable: Record<ScaleName, readonly string[]> = {
  inspire: [
    '#eef9ff',
    '#daf1fe',
    '#b0e3ff',
    '#75d1ff',
    '#31ade3',
    '#299ed1',
    '#177ea9',
    '#046387',
    '#014964',
    '#012d40',
    '#011621',
  ],
  ocean: [
    '#f0f8fe',
    '#ddf0fd',
    '#c9deee',
    '#aec8db',
    '#91afc5',
    '#7497b0',
    '#517a96',
    '#32607e',
    '#014263',
    '#022c44',
    '#011624',
  ],
  cultivate: [
    '#defeff',
    '#b5fcfe',
    '#9eebed',
    '#70c9cc',
    '#67bbbe',
    '#56a0a3',
    '#428082',
    '#316466',
    '#214a4b',
    '#0f2e2f',
    '#031718',
  ],
  kindle: [
    '#fff5ea',
    '#ffe9d0',
    '#ffd29c',
    '#f9b55c',
    '#e59d33',
    '#c28326',
    '#9c6817',
    '#7c5008',
    '#5c3a02',
    '#3b2300',
    '#1e1001',
  ],
  grey: [
    '#ffffff',
    '#f0f8fe',
    '#e6f0f7',
    '#d8e1e8',
    '#c3ccd3',
    '#9da6ad',
    '#798288',
    '#58656f',
    '#404c55',
    '#243038',
    '#162129',
    '#0c171f',
    '#040d15',
  ],
};

describe('UI-1 the colour scales are generated from the brand colours', () => {
  it.each(Object.entries(brandAnchors))('UI-1 %s sits exactly on its step', (name, anchor) => {
    expect(
      colourScales()
        .get(name as ScaleName)
        ?.get(anchor.step),
    ).toBe(anchor.hex);
  });

  it.each(Object.keys(designTable) as ScaleName[])(
    "UI-1 the %s scale is the design's section 5.1 table",
    (name) => {
      expect([...(colourScales().get(name)?.values() ?? [])]).toEqual(designTable[name]);
    },
  );

  it('UI-1 the committed scales.css is the generator output', () => {
    expect(() =>
      execFileSync('node', ['tools/ui/build-tokens.ts', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
