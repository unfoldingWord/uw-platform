export type TemplateCopy = {
  readonly id: string;
  readonly source: { readonly pageId: string; readonly version: number };
};

export type TemplateNow = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
};

type DriftState = 'behind' | 'source_retired' | 'source_missing';

export type TemplateDrift = {
  readonly copyId: string;
  readonly sourceId: string;
  readonly copied: number;
  readonly current: number | null;
  readonly state: DriftState;
};

function driftOf(copy: TemplateCopy, source: TemplateNow | undefined): TemplateDrift | null {
  const base = { copyId: copy.id, sourceId: copy.source.pageId, copied: copy.source.version };
  if (source === undefined) return { ...base, current: null, state: 'source_missing' };
  if (source.status === 'retired')
    return { ...base, current: source.version, state: 'source_retired' };
  if (source.version > copy.source.version) {
    return { ...base, current: source.version, state: 'behind' };
  }
  return null;
}

export function templateDrift(
  copies: readonly TemplateCopy[],
  sources: readonly TemplateNow[],
): readonly TemplateDrift[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return copies
    .flatMap((copy) => {
      const drift = driftOf(copy, byId.get(copy.source.pageId));
      return drift === null ? [] : [drift];
    })
    .toSorted((a, b) => (a.copyId < b.copyId ? -1 : a.copyId > b.copyId ? 1 : 0));
}
