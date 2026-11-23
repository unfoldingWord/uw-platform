import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['apps/uw-app/views/screens', 'apps/uw-app/views/parts'];

const personFields =
  /\.(?:displayName|authorName|ownerName|grantedByName|grantedBy|savedBy|owner|person|email)\b/u;
const cellKey = /^\s*(?:owner|granted|who|by|person):\s/u;
const childName = /\{[^{}]*\.(?:displayName|savedBy|ownerName|grantedByName)\s*\}/u;
const alwaysRaw = [
  /\bholderText\(/u,
  /\.authorName\b/u,
  /=\s*[\w.]*holder\.name;/u,
  /\bnamesFor\(/u,
];

const allowed = new Set([
  'apps/uw-app/views/parts/holder.tsx',
  'apps/uw-app/views/parts/holder-words.ts',
]);

function viewFiles(): readonly string[] {
  return roots.flatMap((root) =>
    readdirSync(root)
      .filter((file) => /\.tsx?$/u.test(file) && !file.includes('.test.'))
      .map((file) => join(root, file)),
  );
}

function printsAPersonAsText(line: string): boolean {
  if (alwaysRaw.some((pattern) => pattern.test(line))) return true;
  if (!personFields.test(line)) return false;
  return (cellKey.test(line) && !line.includes('<')) || childName.test(line);
}

function offendingLines(file: string): readonly string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      printsAPersonAsText(line) ? [`${file}:${String(index + 1)} ${line.trim()}`] : [],
    );
}

describe('#208 every screen shows a person through the person chip', () => {
  it('prints no display name, owner, author or holder as bare text in a view', () => {
    const offending = viewFiles()
      .filter((file) => !allowed.has(file))
      .flatMap(offendingLines);
    expect(offending).toEqual([]);
  });

  it('finds the bare names the views printed before the chip', () => {
    const before = [
      '<span class="font-heavy text-text">{props.person.displayName}</span>',
      "by: line.grant.grantedBy ?? 'Set up with the platform',",
      'const who = comment.authorName ?? comment.author;',
      "owner: entry.owner ?? 'No owner',",
      'person: grant.person,',
      'granted: permission.grantedByName,',
      'who: entry.savedBy,',
      'owner: line.owner,',
      "{ label: 'Holder', value: holderText(card.holder, at) },",
      'const name = draft.holder.name;',
      'names: await namesFor(db, reply.rows, stored.definition.properties),',
    ];
    expect(before.filter((line) => !printsAPersonAsText(line))).toEqual([]);
  });

  it('renders a person only through the chip component in packages/ui', () => {
    const chip = readFileSync('apps/uw-app/views/parts/person.tsx', 'utf8');
    expect(chip).toContain("from '@uw/ui/components/person-chip.tsx'");
  });
});
