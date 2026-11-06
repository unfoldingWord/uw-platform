import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../../../tools/repo-files.ts';
import {
  freeGlyph,
  iconModule,
  iconNames,
  proGlyph,
  type IconPack,
} from '../../../tools/ui/icons.ts';
import { Icon, type IconProps } from './icon.tsx';

const load = createRequire(import.meta.url);
const freeRegular = load('@fortawesome/free-regular-svg-icons') as IconPack;
const freeSolid = load('@fortawesome/free-solid-svg-icons') as IconPack;

async function svgOf(props: IconProps): Promise<SVGSVGElement> {
  const markup = (await jsx(Icon, props).toString()).toString();
  const svg = new JSDOM(markup).window.document.querySelector('svg');
  if (svg === null) throw new Error('no svg');
  return svg;
}

describe('UI-4 one icon component draws icons by name', () => {
  it('UI-4 draws the Font Awesome Free artwork for a name, sized by a token', async () => {
    const svg = await svgOf({ name: 'house', size: 4 });
    const house = freeGlyph('house', [freeRegular, freeSolid]);
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(house?.paths[0]);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${house?.width} ${house?.height}`);
    expect(svg.getAttribute('class')).toContain('size-size-4');
  });

  it('UI-4 a name with no artwork draws a placeholder of the same size', async () => {
    const svg = await svgOf({ name: 'no-such-icon', size: 4 });
    expect(svg.querySelector('path')).toBeNull();
    expect(svg.querySelector('rect')).not.toBeNull();
    expect(svg.getAttribute('class')).toContain('size-size-4');
  });

  it('UI-4 an icon is hidden from assistive technology unless it is labelled', async () => {
    const quiet = await svgOf({ name: 'robot' });
    expect(quiet.getAttribute('aria-hidden')).toBe('true');
    const named = await svgOf({ name: 'robot', label: 'Agent' });
    expect(named.getAttribute('role')).toBe('img');
    expect(named.getAttribute('aria-label')).toBe('Agent');
    expect(named.hasAttribute('aria-hidden')).toBe(false);
  });

  it('UI-4 every name the screens use has Free artwork, through its nearest Free icon', () => {
    for (const name of iconNames)
      expect(freeGlyph(name, [freeRegular, freeSolid]), name).not.toBeNull();
    expect(freeGlyph('wave-pulse', [freeRegular, freeSolid])).toEqual(
      freeGlyph('heart-pulse', [freeRegular, freeSolid]),
    );
  });

  it('UI-4 with Pro installed, Regular draws the interface and Duotone draws both of its layers', () => {
    const regular: IconPack = { faHouse: { icon: [576, 512, [], 'f015', 'M1'] } };
    const duotone: IconPack = { faHouse: { icon: [576, 512, [], 'f015', ['M2', 'M3']] } };
    const module = iconModule(
      ['house'],
      (name) => proGlyph(name, regular),
      (name) => proGlyph(name, duotone),
    );
    expect(module).toContain('"paths":["M1"]');
    expect(module).toContain('"paths":["M2","M3"]');
  });
});

describe('UI-4 no Pro artwork is in the repository, and nothing needs the token', () => {
  it('UI-4 the committed icon module is the Free build', () => {
    expect(() =>
      execFileSync('node', ['tools/ui/build-icons.ts', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  }, 60_000);

  it('UI-4 no package.json depends on a Font Awesome Pro package', () => {
    const manifests = repoFiles().filter((path) => path.endsWith('package.json'));
    expect(manifests.length).toBeGreaterThan(3);
    for (const path of manifests)
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/@fortawesome\/pro-/);
  });
});
