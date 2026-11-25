import { z } from 'zod';

export const policyLevelSchema = z.enum([
  'organization',
  'portfolio',
  'program',
  'project',
  'product',
]);

export type PolicyLevel = z.infer<typeof policyLevelSchema>;

export const policyEnforcementSchema = z.enum(['required', 'default', 'template']);

export type PolicyEnforcement = z.infer<typeof policyEnforcementSchema>;

const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

export const policyFrontmatterSchema = z
  .strictObject({
    enforcement: policyEnforcementSchema,
    applies_to: z.uuid().nullable().default(null),
    supersedes: z
      .array(z.uuid())
      .max(20)
      .refine(distinct, 'a policy names each superseded policy once')
      .default([]),
    effective_from: z.iso.date(),
    effective_until: z.iso.date().nullable().default(null),
  })
  .refine(
    (value) => value.effective_until === null || value.effective_until > value.effective_from,
    'a policy stops after it starts',
  );

export type PolicyFrontmatter = z.infer<typeof policyFrontmatterSchema>;

export const charterFrontmatterSchema = z.strictObject({
  applies_to: z.uuid().nullable().default(null),
});

export const charterSectionSchema = z.enum([
  'Need',
  'Idea',
  'Strategy',
  'Outcomes',
  'Risks',
  'Roadmap',
]);

export type CharterSection = z.infer<typeof charterSectionSchema>;

export type CharterSections = {
  readonly sections: Readonly<Partial<Record<CharterSection, string>>>;
  readonly missing: readonly CharterSection[];
};

const FENCE = /^\s*(```|~~~)/;
const SECTION_HEADING = /^##\s+(.+?)\s*#*\s*$/;

type Heading = { readonly title: string; readonly line: number };

function headingsOf(lines: readonly string[]): readonly Heading[] {
  const found: Heading[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (FENCE.test(line)) fenced = !fenced;
    const match = fenced ? null : SECTION_HEADING.exec(line);
    if (match?.[1] !== undefined) found.push({ title: match[1].toLowerCase(), line: index });
  });
  return found;
}

function textUnder(lines: readonly string[], headings: readonly Heading[], at: number): string {
  const start = (headings.at(at)?.line ?? 0) + 1;
  const end = headings.at(at + 1)?.line ?? lines.length;
  return lines.slice(start, end).join('\n').trim();
}

function longestInOrder(
  wanted: readonly string[],
  found: readonly Heading[],
): ReadonlyMap<number, number> {
  const rows = wanted.length + 1;
  const columns = found.length + 1;
  const best = new Int32Array(rows * columns);
  const cell = (row: number, column: number) => best.at(row * columns + column) ?? 0;
  for (let row = wanted.length - 1; row >= 0; row -= 1) {
    for (let column = found.length - 1; column >= 0; column -= 1) {
      const same = found.at(column)?.title === wanted.at(row);
      const value = same
        ? cell(row + 1, column + 1) + 1
        : Math.max(cell(row + 1, column), cell(row, column + 1));
      best.set([value], row * columns + column);
    }
  }
  const matched = new Map<number, number>();
  let [row, column] = [0, 0];
  while (row < wanted.length && column < found.length) {
    if (found.at(column)?.title === wanted.at(row)) {
      matched.set(row, column);
      [row, column] = [row + 1, column + 1];
    } else if (cell(row + 1, column) >= cell(row, column + 1)) row += 1;
    else column += 1;
  }
  return matched;
}

export function charterSections(bodyMd: string): CharterSections {
  const lines = bodyMd.split(/\r?\n/);
  const headings = headingsOf(lines);
  const order = charterSectionSchema.options;
  const matched = longestInOrder(
    order.map((section) => section.toLowerCase()),
    headings,
  );
  const sections = new Map<CharterSection, string>();
  const missing: CharterSection[] = [];
  order.forEach((section, index) => {
    const at = matched.get(index);
    if (at === undefined) missing.push(section);
    else sections.set(section, textUnder(lines, headings, at));
  });
  return { sections: Object.fromEntries(sections), missing };
}
