export type NamedPerson = { readonly id: string; readonly name: string };

export type NameTarget = { readonly toPersonId: string | null; readonly toText: string | null };

type ResolvedBy = 'id' | 'full_name' | 'loose_name' | 'first_name';

export type Resolution =
  | { readonly kind: 'resolved'; readonly person: NamedPerson; readonly by: ResolvedBy }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly NamedPerson[] }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'not_readable' };

type Keyed = ReadonlyMap<string, readonly NamedPerson[]>;

export type NameIndex = {
  readonly byId: ReadonlyMap<string, NamedPerson>;
  readonly tiers: readonly { readonly by: ResolvedBy; readonly keyed: Keyed }[];
};

function normal(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().split(/\s+/).join(' ');
}

function loose(text: string): string {
  return normal(text.replace(/[^\p{L}\p{N}]+/gu, ' '));
}

function firstName(text: string): string {
  return loose(normal(text).split(' ')[0] ?? '');
}

function keyedBy(people: readonly NamedPerson[], key: (name: string) => string): Keyed {
  const keyed = new Map<string, NamedPerson[]>();
  for (const person of people) {
    const found = key(person.name);
    if (found === '') continue;
    keyed.set(found, [...(keyed.get(found) ?? []), person]);
  }
  return keyed;
}

export function nameIndex(people: readonly NamedPerson[]): NameIndex {
  return {
    byId: new Map(people.map((person) => [person.id, person])),
    tiers: [
      { by: 'full_name', keyed: keyedBy(people, normal) },
      { by: 'loose_name', keyed: keyedBy(people, loose) },
      { by: 'first_name', keyed: keyedBy(people, firstName) },
    ],
  };
}

function keyFor(by: ResolvedBy, text: string): string {
  if (by === 'full_name') return normal(text);
  if (by === 'loose_name') return loose(text);
  return normal(text).includes(' ') ? '' : loose(text);
}

function byText(index: NameIndex, text: string): Resolution {
  for (const tier of index.tiers) {
    const key = keyFor(tier.by, text);
    const candidates = key === '' ? [] : (tier.keyed.get(key) ?? []);
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      return { kind: 'resolved', person: only, by: tier.by };
    }
    if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  }
  return { kind: 'unresolved' };
}

export function resolveTarget(index: NameIndex, target: NameTarget): Resolution {
  if (target.toPersonId !== null) {
    const person = index.byId.get(target.toPersonId);
    return person === undefined ? { kind: 'not_readable' } : { kind: 'resolved', person, by: 'id' };
  }
  return byText(index, target.toText ?? '');
}
