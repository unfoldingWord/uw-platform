type Priority = 'Must' | 'Should' | 'Later' | 'Built';
export type Requirement = { readonly id: string; readonly priority: Priority };
export type BuildStep = { readonly step: number; readonly ids: readonly string[] };

const requirementRow = /^\| ([A-Z]{2}-\d+) \|.*\| (Must|Should|Later|Built) \| [^|]* \|$/;
const stepLine = /^(\d+)\. \*\*[^*]+\*\*\s*(.*)$/;
const requirementId = /\b([A-Z]{2})-(\d+)\b/g;
const priorities: ReadonlyMap<string, Priority> = new Map<string, Priority>([
  ['Must', 'Must'],
  ['Should', 'Should'],
  ['Later', 'Later'],
  ['Built', 'Built'],
]);

const requirementStart = /^\| [A-Z]{2}-\d+ \|/;

export function parseRequirements(prd: string): Requirement[] {
  return prd.split('\n').flatMap((line) => {
    const match = requirementRow.exec(line);
    const priority = priorities.get(match?.[2] ?? '');
    if (match?.[1] && priority) return [{ id: match[1], priority }];
    if (requirementStart.test(line)) throw new Error(`malformed requirement row: ${line}`);
    return [];
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

function expand(prefix: string, from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => `${prefix}-${from + offset}`);
}

function rangeEnd(
  text: string,
  current: RegExpExecArray,
  next: RegExpExecArray | undefined,
): number | null {
  if (next === undefined || next[1] !== current[1]) return null;
  const between = text.slice(current.index + current[0].length, next.index);
  return between === ' to ' ? Number(next[2]) : null;
}

function idsIn(text: string): string[] {
  const found = [...text.matchAll(requirementId)];
  const ids: string[] = [];
  let at = 0;
  while (at < found.length) {
    const current = found[at];
    if (current === undefined) break;
    const to = rangeEnd(text, current, found[at + 1]);
    ids.push(...expand(current[1] ?? '', Number(current[2]), to ?? Number(current[2])));
    at += to === null ? 1 : 2;
  }
  return ids;
}

function checkSteps(prd: string, steps: BuildStep[]): BuildStep[] {
  const known = new Set(parseRequirements(prd).map((requirement) => requirement.id));
  const placed = new Map<string, number>();
  for (const { step, ids } of steps) {
    for (const id of ids) {
      if (!known.has(id))
        throw new Error(`build-order step ${step} names ${id}, which has no requirement row`);
      const earlier = placed.get(id);
      if (earlier !== undefined)
        throw new Error(`${id} is placed in step ${earlier} and step ${step}`);
      placed.set(id, step);
    }
  }
  return steps;
}

export function parseBuildOrder(prd: string): BuildStep[] {
  const steps = section(prd, '## 13. Build order').flatMap((line) => {
    const match = stepLine.exec(line);
    return match?.[1] ? [{ step: Number(match[1]), ids: idsIn(match[2] ?? '') }] : [];
  });
  return checkSteps(prd, steps);
}
