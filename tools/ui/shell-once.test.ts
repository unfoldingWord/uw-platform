import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const components = 'packages/ui/components/';

type Piece = { readonly owner: string; readonly marks: readonly RegExp[] };

const pieces: readonly Piece[] = [
  {
    owner: `${components}shell.tsx`,
    marks: [/<html\b/, /<main\b/, /\bfunction\s+Shell\b/, /\bconst\s+Shell\b/],
  },
  {
    owner: `${components}sidebar.tsx`,
    marks: [/aria-label="Main"/, /\bfunction\s+Sidebar\b/, /\bconst\s+Sidebar\b/],
  },
  {
    owner: `${components}top-bar.tsx`,
    marks: [/<header\b/, /aria-label="Breadcrumb"/, /\bfunction\s+TopBar\b/, /\bconst\s+TopBar\b/],
  },
  {
    owner: `${components}page-head.tsx`,
    marks: [/<h1\b/, /\bfunction\s+PageHead\b/, /\bconst\s+PageHead\b/],
  },
  {
    owner: `${components}segmented-control.tsx`,
    marks: [/type="radio"/, /\bfunction\s+SegmentedControl\b/, /\bconst\s+SegmentedControl\b/],
  },
  {
    owner: `${components}theme-switch.tsx`,
    marks: [/\bfunction\s+ThemeSwitch\b/, /\bconst\s+ThemeSwitch\b/],
  },
];

const beforeTheShell = new Map<string, readonly RegExp[]>([
  ['apps/uw-app/health/routes.tsx', [/<html\b/, /<main\b/, /<h1\b/]],
  ['apps/uw-app/auth/pending-approval.tsx', [/<html\b/, /<h1\b/]],
]);

function scanned(path: string): boolean {
  return /^(apps|packages)\//.test(path) && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);
}

function secondPieces(path: string, text: string): string[] {
  const allowed = new Set((beforeTheShell.get(path) ?? []).map((mark) => mark.source));
  return pieces
    .filter((piece) => piece.owner !== path)
    .flatMap((piece) => piece.marks)
    .filter((mark) => !allowed.has(mark.source) && mark.test(text))
    .map((mark) => `${path}: ${mark.source}`);
}

describe('WB-11 each shell piece exists once', () => {
  it('WB-11 no file outside its owner defines a second shell, sidebar, top bar, page head, segmented control or theme switch', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .flatMap((path) => secondPieces(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every owner file exists and carries its marks', () => {
    for (const piece of pieces) {
      const text = readFileSync(piece.owner, 'utf8');
      expect(
        piece.marks.some((mark) => mark.test(text)),
        piece.owner,
      ).toBe(true);
    }
  });

  it('the pages written before the shell still carry the markup they are excused for, so the list only shrinks', () => {
    for (const [path, marks] of beforeTheShell) {
      const text = readFileSync(path, 'utf8');
      for (const mark of marks) expect(mark.test(text), `${path}: ${mark.source}`).toBe(true);
    }
  });

  it.each([
    [
      'apps/uw-app/pages/screen.tsx',
      '<div class="bg-ocean-panel"><nav aria-label="Main"></nav></div>',
    ],
    ['apps/uw-app/pages/screen.tsx', '<header><nav aria-label="Breadcrumb"></nav></header>'],
    ['apps/uw-app/pages/screen.tsx', '<h1 class="text-2xl">Board</h1>'],
    ['apps/uw-app/pages/screen.tsx', 'export function PageHead() { return null; }'],
    ['apps/uw-app/pages/screen.tsx', '<input type="radio" name="view" />'],
    ['packages/ui/components/card.tsx', 'export const Sidebar = () => null;'],
    ['apps/uw-app/health/routes.tsx', '<nav aria-label="Main">second sidebar</nav>'],
  ])('flags a planted second piece in %s: %s', (path, text) => {
    expect(scanned(path)).toBe(true);
    expect(secondPieces(path, text)).not.toEqual([]);
  });

  it('passes a page that renders inside the shell', () => {
    const page = '<Shell title="Board"><PageHead title="Board" /><p>Items</p></Shell>';
    expect(secondPieces('apps/uw-app/pages/board.tsx', page)).toEqual([]);
  });
});
