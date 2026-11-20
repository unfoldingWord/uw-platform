import {
  areaOfCategory,
  knowledgeFrontmatterSchema,
  type JdArea,
  type PageType,
} from '@uw/contracts';

export function filedOutsideItsArea(
  type: PageType,
  frontmatter: Record<string, unknown>,
  area: JdArea,
): boolean {
  if (type !== 'knowledge') return false;
  const filed = knowledgeFrontmatterSchema.safeParse(frontmatter);
  return !filed.success || areaOfCategory(filed.data.jd_category) !== area;
}
