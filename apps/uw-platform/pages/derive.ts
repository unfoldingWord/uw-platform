import { and, inArray, ne, eq } from 'drizzle-orm';
import {
  frontmatterSchema,
  personaFrontmatterSchema,
  type Page,
  type PageStatus,
  type PageType,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { learningProvenance, type ExternalWriter, type Provenance } from './provenance.ts';

export type Landing = {
  readonly status: PageStatus;
  readonly stored: PageStatus | null;
  readonly prior: Provenance | null;
  readonly writer: ExternalWriter | null;
};

export type DerivedFrontmatter =
  | { readonly ok: true; readonly frontmatter: StoredFrontmatter }
  | {
      readonly ok: false;
      readonly reason: 'activation_required' | 'malformed_command' | 'not_permitted';
    };

type Frontmatter = Readonly<Record<string, unknown>>;
type StoredFrontmatter = ReturnType<typeof frontmatterSchema.parse>;

function derived(frontmatter: Frontmatter): DerivedFrontmatter {
  return { ok: true, frontmatter: frontmatterSchema.parse(frontmatter) };
}

const STATUS = 'status';

type Landed = Pick<Landing, 'status' | 'stored'>;

function namesActivation(input: Frontmatter, landing: Landed): boolean {
  if (!Object.hasOwn(input, 'status') || input['status'] !== 'active') return false;
  return landing.status !== 'active' && landing.stored !== 'active';
}

function toolsetOf(frontmatter: Frontmatter): readonly unknown[] {
  const toolset = frontmatter['toolset'];
  return Array.isArray(toolset) ? toolset : [];
}

export function personaFrontmatterFor(
  parsed: Frontmatter,
  input: Frontmatter,
  landing: Landed,
): DerivedFrontmatter {
  if (namesActivation(input, landing)) return { ok: false, reason: 'activation_required' };
  return derived({ ...parsed, status: landing.status, requires_tools: [...toolsetOf(parsed)] });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value).filter(([key]) => key !== STATUS);
  return entries.toSorted(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]);
}

function comparable(frontmatter: Frontmatter): string | null {
  const parsed = personaFrontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) return null;
  return JSON.stringify(canonical({ ...parsed.data, requires_tools: parsed.data.toolset }));
}

function samePersona(before: Frontmatter, after: Frontmatter): boolean {
  const stored = comparable(before);
  return stored !== null && stored === comparable(after);
}

export function personaLanding(
  stored: Page,
  status: PageStatus,
  frontmatter: Frontmatter,
  bodyMd: string,
): PageStatus {
  if (stored.type !== 'persona' || stored.status !== 'active' || status !== 'active') {
    return status;
  }
  const unchanged = samePersona(stored.frontmatter, frontmatter) && stored.bodyMd === bodyMd;
  return unchanged ? status : 'suggested';
}

function supersededIds(parsed: Frontmatter): string[] {
  const supersedes = parsed['supersedes'];
  return Array.isArray(supersedes)
    ? supersedes.filter((id): id is string => typeof id === 'string')
    : [];
}

async function contradicts(tx: Executor, parsed: Frontmatter): Promise<boolean> {
  const ids = supersededIds(parsed);
  if (ids.length === 0) return false;
  const rows = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(and(inArray(pages.id, ids), eq(pages.type, 'learning'), ne(pages.status, 'retired')))
    .limit(1);
  return rows.length > 0;
}

export async function derivedFrontmatter(
  tx: Executor,
  type: PageType,
  parsed: Record<string, unknown>,
  input: Frontmatter,
  landing: Landing,
): Promise<DerivedFrontmatter> {
  if (type === 'persona') return personaFrontmatterFor(parsed, input, landing);
  if (type === 'learning') {
    const provenance = learningProvenance({
      parsed,
      raw: input,
      prior: landing.prior,
      writer: landing.writer,
    });
    if (!provenance.ok) return { ok: false, reason: provenance.reason };
    return derived({ ...provenance.frontmatter, contradicts: await contradicts(tx, parsed) });
  }
  return derived(parsed);
}
