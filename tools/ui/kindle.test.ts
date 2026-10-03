import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const owner = 'packages/ui/components/human-action.tsx';

const kindle = /-kindle\b|\bkindle-soft\b/;

function scanned(path: string): boolean {
  return (
    /^(apps\/|packages\/ui\/components\/)/.test(path) &&
    /\.tsx?$/.test(path) &&
    !/\.test\.tsx?$/.test(path)
  );
}

function usesKindle(path: string, text: string): boolean {
  return path !== owner && kindle.test(text);
}

describe('WB-11 Kindle marks a human action', () => {
  it('WB-11 Kindle marks a human action and nothing else', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .filter((path) => usesKindle(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the human action itself carries Kindle, so the check is not vacuous', () => {
    expect(scanned(owner)).toBe(true);
    expect(kindle.test(readFileSync(owner, 'utf8'))).toBe(true);
  });

  it.each([
    ['packages/ui/components/kanban-card.tsx', '<article class="border border-kindle">x</article>'],
    ['packages/ui/components/lane.tsx', '<span class="bg-kindle-soft text-ink">Paused</span>'],
    ['packages/ui/components/badge.tsx', "const warm = 'bg-kindle text-on-accent';"],
    ['apps/uw-app/pages/board.tsx', '<a class="text-kindle">Open</a>'],
    ['apps/uw-app/routes/gates.tsx', '<p style="color: var(--uw-kindle)">x</p>'],
    ['apps/uw-app/islands/live/flash.ts', "element.classList.add('outline-kindle');"],
  ])('flags a planted Kindle use in %s: %s', (path, text) => {
    expect(scanned(path)).toBe(true);
    expect(usesKindle(path, text)).toBe(true);
  });

  it.each([
    ['apps/uw-app/pages/board.tsx', '<HumanActionButton label="Approve" name="d" value="a" />'],
    ['apps/uw-app/pages/board.tsx', "const kindled = 'kindled';"],
    ['packages/ui/components/badge.tsx', '<span class="bg-cultivate-soft text-ink">x</span>'],
  ])('passes a piece that does not use Kindle in %s: %s', (path, text) => {
    expect(usesKindle(path, text)).toBe(false);
  });

  it('reads only shipped component and app sources', () => {
    expect(scanned('packages/ui/components/human-action.test.ts')).toBe(false);
    expect(scanned('packages/ui/tokens/theme.css')).toBe(false);
    expect(scanned('packages/ui/app.css')).toBe(false);
    expect(scanned('packages/ui/generated/app-css.ts')).toBe(false);
  });
});
