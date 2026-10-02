type Priority = 'Must' | 'Later' | 'Built';
export type Requirement = { readonly id: string; readonly priority: Priority };
export type BuildStep = { readonly step: number; readonly ids: readonly string[] };

const requirementRow = /^\| ([A-Z]{2}-\d+) \|.*\| (Must|Later|Built) \| [^|]* \|$/;
const stepLine = /^(\d+)\. \*\*[^*]+\*\*\s*(.*)$/;
const range = /\b([A-Z]{2})-(\d+) to \1-(\d+)\b/g;
const single = /\b[A-Z]{2}-\d+\b/g;
const priorities: ReadonlyMap<string, Priority> = new Map<string, Priority>([
  ['Must', 'Must'],
  ['Later', 'Later'],
  ['Built', 'Built'],
]);

export function parseRequirements(prd: string): Requirement[] {
  return prd.split('\n').flatMap((line) => {
    const match = requirementRow.exec(line);
    const priority = priorities.get(match?.[2] ?? '');
    return match?.[1] && priority ? [{ id: match[1], priority }] : [];
  });
}

function section(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

function idsIn(text: string): string[] {
  const expanded = [...text.matchAll(range)].flatMap(([, prefix, from, to]) =>
    Array.from(
      { length: Number(to) - Number(from) + 1 },
      (_, offset) => `${prefix}-${Number(from) + offset}`,
    ),
  );
  const singles = text.replace(range, ' ').match(single) ?? [];
  return [...expanded, ...singles];
}

export function parseBuildOrder(prd: string): BuildStep[] {
  return section(prd, '## 13. Build order').flatMap((line) => {
    const match = stepLine.exec(line);
    return match?.[1] ? [{ step: Number(match[1]), ids: idsIn(match[2] ?? '') }] : [];
  });
}
