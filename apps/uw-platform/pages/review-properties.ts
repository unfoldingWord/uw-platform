import { frontmatterSchema, type Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { canonicalJson } from '../pdf/provenance.ts';
import { collectionOf } from './history.ts';
import { shownFields } from './property-rules.ts';
import type { FoundReviewSet } from './review-sets.ts';
import { checkFrontmatter } from './validate.ts';

type PropertyChange = {
  readonly key: string;
  readonly now: unknown;
  readonly proposed: unknown;
};

export type ProposedProperties = {
  readonly changes: readonly PropertyChange[];
  readonly withheld: boolean;
};

function filed(page: Page): Readonly<Record<string, unknown>> {
  const checked = checkFrontmatter(page.type, page.frontmatter);
  return checked.ok ? checked.frontmatter : page.frontmatter;
}

function changed(
  now: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
): PropertyChange[] {
  const before = new Map(Object.entries(now));
  const after = new Map(Object.entries(proposed));
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return keys.flatMap((key) => {
    const was = before.get(key) ?? null;
    const will = after.get(key) ?? null;
    return canonicalJson(was) === canonicalJson(will) ? [] : [{ key, now: was, proposed: will }];
  });
}

export async function proposedProperties(
  db: Executor,
  actor: Principal,
  found: FoundReviewSet,
  at: Date,
): Promise<ProposedProperties | null> {
  const { set, page } = found;
  if (set.frontmatter === null) return null;
  const parsed = frontmatterSchema.safeParse(set.frontmatter);
  if (!parsed.success) return { changes: [], withheld: true };
  const collectionId = await collectionOf(db, page.id);
  const proposedPage = { ...page, frontmatter: parsed.data };
  const proposed = await shownFields(db, actor, proposedPage, collectionId, at);
  return {
    changes: changed(filed(page), proposed.page.frontmatter),
    withheld: proposed.withheld,
  };
}
