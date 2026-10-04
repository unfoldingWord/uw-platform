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
  {
    owner: `${components}card.tsx`,
    marks: [/\bfunction\s+Card\b/, /\bconst\s+Card\b/],
  },
  {
    owner: `${components}badge.tsx`,
    marks: [/\bfunction\s+Badge\b/, /\bconst\s+Badge\b/],
  },
  {
    owner: `${components}chip.tsx`,
    marks: [/aria-pressed=/, /\bfunction\s+Chip\b/, /\bconst\s+Chip\b/],
  },
  {
    owner: `${components}table.tsx`,
    marks: [/<table\b/, /scope="col"/, /\bfunction\s+Table\b/, /\bconst\s+Table\b/],
  },
  {
    owner: `${components}kpi.tsx`,
    marks: [/<dt\b/, /\bfunction\s+Kpi\b/, /\bconst\s+Kpi\b/],
  },
  {
    owner: `${components}note.tsx`,
    marks: [/role="note"/, /\bfunction\s+Note\b/, /\bconst\s+Note\b/],
  },
  {
    owner: `${components}evidence-label.tsx`,
    marks: [/\bfunction\s+EvidenceLabel\b/, /\bconst\s+EvidenceLabel\b/],
  },
  {
    owner: `${components}human-action.tsx`,
    marks: [
      /\bfunction\s+HumanActionButton\b/,
      /\bconst\s+HumanActionButton\b/,
      /\bfunction\s+HumanGateMark\b/,
      /\bconst\s+HumanGateMark\b/,
    ],
  },
  {
    owner: `${components}field.tsx`,
    marks: [
      /\bfunction\s+TextField\b/,
      /\bfunction\s+TextAreaField\b/,
      /\bfunction\s+SelectField\b/,
    ],
  },
  {
    owner: `${components}command-form.tsx`,
    marks: [/data-command=/, /\bfunction\s+CommandForm\b/],
  },
  {
    owner: `${components}gate-callout.tsx`,
    marks: [
      /\bfunction\s+GateCallout\b/,
      /\bconst\s+GateCallout\b/,
      /\bfunction\s+GateFacts\b/,
      /\bconst\s+GateFacts\b/,
    ],
  },
  {
    owner: `${components}lane.tsx`,
    marks: [/\bfunction\s+Lane\b/, /\bconst\s+Lane\b/],
  },
  {
    owner: `${components}kanban-card.tsx`,
    marks: [/<article\b/, /\bfunction\s+KanbanCard\b/, /\bconst\s+KanbanCard\b/],
  },
];

const sharedMarks = new Map<string, readonly RegExp[]>([
  [`${components}gate-callout.tsx`, [/<dt\b/]],
  [`${components}kanban-card.tsx`, [/<dt\b/]],
  [`${components}lane.tsx`, [/<dt\b/]],
]);

const beforeTheShell = new Map<string, readonly RegExp[]>([
  ['apps/uw-app/health/routes.tsx', [/<html\b/, /<main\b/, /<h1\b/]],
  ['apps/uw-app/auth/pending-approval.tsx', [/<html\b/, /<h1\b/]],
]);

function scanned(path: string): boolean {
  return /^(apps|packages)\//.test(path) && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);
}

const humanAction = `${components}human-action.tsx`;

const decisionAttribute = /\b(?:name|value)=\{?\s*["'`](?:approve|reject|take_over|override)["'`]/g;

function enclosingTag(text: string, index: number): string | null {
  const before = text.slice(0, index);
  const opening = before.lastIndexOf('<');
  if (opening < 0) return null;
  return /^<([A-Za-z][\w.]*)/.exec(before.slice(opening))?.[1] ?? null;
}

function handRolledDecisions(path: string, text: string): string[] {
  if (path === humanAction) return [];
  return [...text.matchAll(decisionAttribute)]
    .filter((match) => enclosingTag(text, match.index) !== 'HumanActionButton')
    .map((match) => `${path}: ${match[0]}`);
}

function secondPieces(path: string, text: string): string[] {
  const allowed = new Set(
    [...(beforeTheShell.get(path) ?? []), ...(sharedMarks.get(path) ?? [])].map(
      (mark) => mark.source,
    ),
  );
  return pieces
    .filter((piece) => piece.owner !== path)
    .flatMap((piece) => piece.marks)
    .filter((mark) => !allowed.has(mark.source) && mark.test(text))
    .map((mark) => `${path}: ${mark.source}`);
}

const planted: readonly (readonly [string, string])[] = [
  [
    'apps/uw-app/pages/screen.tsx',
    '<div class="bg-ocean-panel"><nav aria-label="Main"></nav></div>',
  ],
  ['apps/uw-app/pages/screen.tsx', '<header><nav aria-label="Breadcrumb"></nav></header>'],
  ['apps/uw-app/pages/screen.tsx', '<h1 class="text-2xl">Board</h1>'],
  ['apps/uw-app/pages/screen.tsx', 'export function PageHead() { return null; }'],
  ['apps/uw-app/pages/screen.tsx', '<input type="radio" name="view" />'],
  ['packages/ui/components/card.tsx', 'export const Sidebar = () => null;'],
  ['apps/uw-app/pages/spend.tsx', 'export function Badge() { return null; }'],
  ['apps/uw-app/pages/spend.tsx', '<table><caption>Spend</caption></table>'],
  ['apps/uw-app/pages/spend.tsx', '<p role="note">Hand-rolled note</p>'],
  ['apps/uw-app/pages/spend.tsx', 'export const Kpi = () => null;'],
  ['apps/uw-app/health/routes.tsx', '<nav aria-label="Main">second sidebar</nav>'],
  ['apps/uw-app/pages/gate.tsx', 'export function HumanActionButton() { return null; }'],
  ['packages/ui/components/lane.tsx', 'export const HumanGateMark = () => null;'],
  ['apps/uw-app/pages/gate.tsx', 'export function GateCallout() { return null; }'],
  ['apps/uw-app/pages/gate.tsx', 'export const GateFacts = () => null;'],
  ['apps/uw-app/pages/board.tsx', 'export function Lane() { return null; }'],
  ['apps/uw-app/pages/board.tsx', '<article class="rounded-lg">card</article>'],
  ['packages/ui/components/lane.tsx', 'export const KanbanCard = () => null;'],
  ['apps/uw-app/pages/board.tsx', '<dl><dt>Stage</dt><dd>Build</dd></dl>'],
];

describe('WB-11 each shell piece exists once', () => {
  it('WB-11 no file outside its owner defines a second shell, sidebar, top bar, page head, segmented control, theme switch, card, badge, chip, table, KPI, note, evidence label, human action, gate callout, lane or kanban card', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .flatMap((path) => secondPieces(path, readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('WB-11 no file outside the human action offers a gate decision with a control of its own', () => {
    const offenders = repoFiles()
      .filter(scanned)
      .flatMap((path) => handRolledDecisions(path, readFileSync(path, 'utf8')));
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

  it.each(planted)('flags a planted second piece in %s: %s', (path, text) => {
    expect(scanned(path)).toBe(true);
    expect(secondPieces(path, text)).not.toEqual([]);
  });

  it('lets only the gate facts, the kanban card and the lane share the KPI description term', () => {
    expect(secondPieces(`${components}kanban-card.tsx`, '<dl><dt>Stage</dt></dl>')).toEqual([]);
    expect(secondPieces(`${components}lane.tsx`, '<dl><dt>Exit</dt></dl>')).toEqual([]);
    expect(secondPieces(`${components}gate-callout.tsx`, '<dl><dt>Tier</dt></dl>')).toEqual([]);
    expect(
      secondPieces(`${components}kanban-card.tsx`, 'export const Kpi = () => null;'),
    ).not.toEqual([]);
  });

  it('passes a page that renders inside the shell', () => {
    const page = '<Shell title="Board"><PageHead title="Board" /><p>Items</p></Shell>';
    expect(secondPieces('apps/uw-app/pages/board.tsx', page)).toEqual([]);
  });
});

describe('the human action is the only gate decision control', () => {
  it.each([
    '<button type="submit" name="decision" value="approve">Approve</button>',
    "<button type='submit' name='decision' value='reject'>Reject</button>",
    "<button value={'take_over'}>Take over</button>",
    '<button value={`override`}>Override</button>',
    '<input type="hidden" name="approve" />',
    '<HumanActionButton itemId={id} label="Approve" name="decision" value="approve" /><button value="approve">x</button>',
    '<form><Button variant="primary" value="approve" /></form>',
  ])('flags a planted hand-rolled decision control: %s', (text) => {
    expect(handRolledDecisions('apps/uw-app/pages/gate.tsx', text)).not.toEqual([]);
  });

  it.each([
    '<HumanActionButton itemId={id} label="Approve" name="decision" value="approve" />',
    "<HumanActionButton\n  itemId={id}\n  label='Reject'\n  name='decision'\n  value={'reject'}\n/>",
    "const decision = command === 'approve';",
    '<button type="submit" name="decision" value={decision}>Go</button>',
  ])('passes the human action and code that names no decision control: %s', (text) => {
    expect(handRolledDecisions('apps/uw-app/pages/gate.tsx', text)).toEqual([]);
  });

  it('lets the human action itself carry decision values', () => {
    expect(handRolledDecisions(humanAction, '<button value="approve">')).toEqual([]);
  });
});
