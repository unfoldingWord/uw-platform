import { parse, stringify } from 'yaml';
import { verbIo, skillFrontmatterSchema } from '../../packages/contracts/index.ts';

export type SkillPage = { readonly frontmatter: unknown; readonly bodyMd: string };

const fence = '---\n';

export function skillFileOf(exported: unknown): string {
  const read = verbIo.read_page.output.safeParse(exported);
  const page = read.success ? read.data.page : null;
  const frontmatter = skillFrontmatterSchema.safeParse(page?.frontmatter);
  if (page === null || page.type !== 'skill' || !frontmatter.success) {
    throw new Error('the exported page is not a skill page');
  }
  return `${fence}${stringify(frontmatter.data, { lineWidth: 0 })}${fence}\n${page.bodyMd}`;
}

export function skillPageOf(file: string): SkillPage {
  if (!file.startsWith(fence)) throw new Error('the skill file has no frontmatter');
  const end = file.indexOf(`\n${fence}`, fence.length - 1);
  if (end < 0) throw new Error('the skill file frontmatter is not closed');
  const frontmatter: unknown = parse(file.slice(fence.length, end + 1));
  return { frontmatter, bodyMd: file.slice(end + 1 + fence.length).replace(/^\n/, '') };
}
