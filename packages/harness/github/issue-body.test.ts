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

describe('EI-2 a done-when ignores what a reader never sees', () => {
  it('skips a multi-line template comment, and a heading or blocker inside one', () => {
    const template = [
      '## Done when',
      '<!--',
      'Say what finished looks like.',
      '- One line each.',
      '-->',
      '',
    ];
    expect(doneWhenOf(template.join('\n'))).toEqual([]);
    expect(doneWhenOf('<!--\n## Done when\nIt ships.\n-->\n')).toEqual([]);
    expect(doneWhenOf('## Done when\n<!-- a\nb --> It ships.\n')).toEqual(['It ships.']);
    expect(blockedByOf('<!--\nBlocked by: #123\n-->\nBlocked by: #7', repository)).toEqual([7]);
  });

  it('does not count a Blocked by line as a done-when', () => {
    expect(doneWhenOf('## Done when\nBlocked by: #4')).toEqual([]);
    expect(doneWhenOf('## Done when\n- It ships.\n- **Blocked by:** #4')).toEqual(['It ships.']);
  });

  it('reads only the first Done when heading, even when it is empty', () => {
    expect(doneWhenOf('## Done when\n\n## Done when\nIt ships.')).toEqual([]);
  });

  it('reads a body written with CRLF line ends', () => {
    expect(doneWhenOf('Intro.\r\n## Done when\r\n- It ships.\r\n## Notes\r\nNo.')).toEqual([
      'It ships.',
    ]);
    expect(blockedByOf('Blocked by: #41\r\nBlocked by: #42\r\n', repository)).toEqual([41, 42]);
  });

  it('parses hostile lines in linear time', () => {
    const reps = 100_000;
    const started = Date.now();
    expect(doneWhenOf(`# ${' #'.repeat(reps)}x\nIt ships.`)).toEqual([]);
    expect(doneWhenOf(`## Done when\n- ${'<!--'.repeat(reps)}`)).toEqual([]);
    expect(blockedByOf(`Blocked by: #${'.'.repeat(reps)}x`, repository)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
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
