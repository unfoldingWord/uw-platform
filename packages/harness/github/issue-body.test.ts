import { describe, expect, it } from 'vitest';
import { blockedByOf, doneWhenOf } from './issue-body.ts';

const repository = 'unfoldingWord/uw-platform';

describe('EI-2 a done-when is a heading with at least one line under it', () => {
  it('reads the lines under a Done when heading, stripping list markers and checkboxes', () => {
    const body = [
      'Show the board.',
      '',
      '## Done when',
      '',
      '- The board lists every stage.',
      '* [ ] A card shows its holder.',
      '1. The lanes show their WIP.',
      '',
      '## Notes',
      'Not part of it.',
    ].join('\n');
    expect(doneWhenOf(body)).toEqual([
      'The board lists every stage.',
      'A card shows its holder.',
      'The lanes show their WIP.',
    ]);
  });

  it('accepts any case, any heading level and a trailing colon', () => {
    expect(doneWhenOf('### done WHEN:\nIt ships.')).toEqual(['It ships.']);
    expect(doneWhenOf('# Done when #\nIt ships.')).toEqual(['It ships.']);
  });

  it('finds none without a heading, under an empty heading, under a template comment or inside a fence', () => {
    expect(doneWhenOf('Show the board.')).toEqual([]);
    expect(doneWhenOf('**Done when:** it ships.')).toEqual([]);
    expect(doneWhenOf('## Done when\n\n## Notes\nIt ships.')).toEqual([]);
    expect(doneWhenOf('## Done when\n<!-- say what finished looks like -->\n')).toEqual([]);
    expect(doneWhenOf('```\n## Done when\nIt ships.\n```')).toEqual([]);
    expect(doneWhenOf('## Done when\n```\nIt ships.\n```')).toEqual([]);
  });

  it('bounds the lines and drops NUL characters', () => {
    const many = ['## Done when', ...Array.from({ length: 30 }, (_, n) => `- Line ${n}`)].join(
      '\n',
    );
    expect(doneWhenOf(many)).toHaveLength(20);
    expect(doneWhenOf(`## Done when\n- ${'x'.repeat(600)}`)[0]).toHaveLength(500);
    expect(doneWhenOf('## Done when\n- It\u0000 ships.')).toEqual(['It ships.']);
  });
});

describe('EI-3 blockers come from Blocked by lines naming this repository', () => {
  it('reads #N and owner/name#N for this repository, in any case, once each', () => {
    const body = [
      'Blocked by: #41, #42',
      '- **Blocked by:** unfoldingWord/UW-Platform#43 and #41',
      'blocked by: #44',
    ].join('\n');
    expect(blockedByOf(body, repository)).toEqual([41, 42, 43, 44]);
  });

  it('skips other repositories, struck references, fenced lines and lines that are not Blocked by', () => {
    const body = [
      'Blocked by: nextgen-chess/lasker-chessdata-service#33, ~~#45~~, #46',
      'Consumed by: #47',
      'See #48',
      '```',
      'Blocked by: #49',
      '```',
    ].join('\n');
    expect(blockedByOf(body, repository)).toEqual([46]);
  });

  it('finds none in an empty body', () => {
    expect(blockedByOf('', repository)).toEqual([]);
  });
});
