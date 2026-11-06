import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const owner = 'packages/ui/components/human-action.tsx';

const humanUtility =
  /(?:bg|text|border|fill|stroke|outline|ring|accent|decoration)(?:-[trblxy])?-human\b/;
const kindle = [
  humanUtility,
  /\bshadow-person\b/,
  /--uw-(?:human|glow-human|shadow-person|kindle)\b/,
  /-kindle\b/i,
  /["'`]kindle["'`]/i,
];

function scanned(path: string): boolean {
  return (
    ((/^(apps\/|packages\/ui\/components\/)/.test(path) && /\.tsx?$/.test(path)) ||
      (/^apps\//.test(path) && /\.css$/.test(path))) &&
    !/\.test\.tsx?$/.test(path)
  );
}

function usesKindle(path: string, text: string): boolean {
  return path !== owner && kindle.some((pattern) => pattern.test(text));
}

describe('WB-11 UI-1 Kindle, the human role, marks a human action', () => {
  it('WB-11 Kindle marks a human action and nothing else', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .filter((path) => usesKindle(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the human action itself carries Kindle, so the check is not vacuous', () => {
    expect(scanned(owner)).toBe(true);
    expect(usesKindle('packages/ui/components/badge.tsx', readFileSync(owner, 'utf8'))).toBe(true);
  });

  it.each([
    ['packages/ui/components/kanban-card.tsx', '<article class="border border-human">x</article>'],
    ['packages/ui/components/lane.tsx', '<span class="bg-human-soft text-text">Paused</span>'],
    ['packages/ui/components/badge.tsx', "const warm = 'bg-human text-on-accent';"],
    ['apps/uw-app/pages/board.tsx', '<a class="text-human">Open</a>'],
    ['apps/uw-app/routes/gates.tsx', '<p style="color: var(--uw-kindle)">x</p>'],
    ['apps/uw-app/islands/live/flash.ts', "element.classList.add('outline-human');"],
    ['packages/ui/components/badge.tsx', "const tone = 'kindle'; const c = `bg-${tone}`;"],
    ['apps/uw-app/pages/board.tsx', 'const tones = { warm: "Kindle" };'],
    ['apps/uw-app/pages/board.css', '.warm { background: var(--uw-kindle); }'],
    ['apps/uw-app/pages/board.css', '.warm { @apply bg-human-soft; }'],
    ['apps/uw-app/pages/board.tsx', '<a class="hover:border-human-line">Open</a>'],
    ['apps/uw-app/pages/board.tsx', '<button class="shadow-person">Open</button>'],
    ['apps/uw-app/pages/board.css', '.warm { box-shadow: var(--uw-shadow-person); }'],
  ])('flags a planted Kindle use in %s: %s', (path, text) => {
    expect(scanned(path)).toBe(true);
    expect(usesKindle(path, text)).toBe(true);
  });

  it.each([
    ['apps/uw-app/pages/board.tsx', '<HumanActionButton label="Approve" name="d" value="a" />'],
    ['apps/uw-app/pages/board.tsx', "const kindled = 'kindled';"],
    ['packages/ui/components/badge.tsx', '<span class="bg-ok-soft text-text">x</span>'],
    ['apps/uw-app/commands/gate.ts', "if (principal.kind === 'human') return;"],
    ['apps/uw-app/views/parts/gate-panel.tsx', '<p class="text-text-3">A human decides</p>'],
  ])('passes a piece that does not use Kindle in %s: %s', (path, text) => {
    expect(usesKindle(path, text)).toBe(false);
  });

  it('reads only shipped component and app sources', () => {
    expect(scanned('packages/ui/components/human-action.test.ts')).toBe(false);
    expect(scanned('packages/ui/tokens/theme.css')).toBe(false);
    expect(scanned('packages/ui/app.css')).toBe(false);
    expect(scanned('apps/uw-app/pages/board.css')).toBe(true);
    expect(scanned('packages/ui/generated/app-css.ts')).toBe(false);
  });
});
