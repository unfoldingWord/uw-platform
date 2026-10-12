import { pageTypeDefinition, pageTypeSchema, type PageType } from '@uw/contracts';

export type FrontmatterCheck =
  | { readonly ok: true; readonly type: PageType; readonly frontmatter: Record<string, unknown> }
  | { readonly ok: false; readonly reason: 'unknown_page_type' | 'invalid_frontmatter' };

export function checkFrontmatter(type: string, frontmatter: unknown): FrontmatterCheck {
  const definition = pageTypeDefinition(type);
  const known = pageTypeSchema.safeParse(type);
  if (!definition || !known.success) return { ok: false, reason: 'unknown_page_type' };
  const parsed = definition.frontmatter.safeParse(frontmatter);
  if (!parsed.success) return { ok: false, reason: 'invalid_frontmatter' };
  return { ok: true, type: known.data, frontmatter: parsed.data as Record<string, unknown> };
}
