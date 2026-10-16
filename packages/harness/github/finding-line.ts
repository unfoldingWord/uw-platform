import { findingWeightSchema, type ReadFinding } from '@uw/contracts';

const weighed = /^([a-z]+): (.+)$/u;

export function weighedLine(line: string): ReadFinding {
  const match = weighed.exec(line.trim());
  const weight = findingWeightSchema.safeParse(match?.[1]);
  const text = match?.[2]?.trim() ?? '';
  return weight.success && text !== ''
    ? { text, weight: weight.data }
    : { text: line.trim(), weight: null };
}
