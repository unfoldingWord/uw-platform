export const evidenceLabels = ['observed', 'confirmed', 'inferred', 'assumed'] as const;

export type EvidenceLabelValue = (typeof evidenceLabels)[number];

export const evidenceDefinitions: Readonly<Record<EvidenceLabelValue, string>> = {
  observed: 'Seen directly in a system or a record.',
  confirmed: 'Checked by a person or a second source.',
  inferred: 'Concluded from other evidence, not seen directly.',
  assumed: 'Taken as true with no evidence yet.',
};
