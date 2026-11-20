import GithubSlugger from 'github-slugger';
import type { Page } from '@uw/contracts';
import type { EmbedSource } from './page-refs.ts';
import { pageAddress } from './wiki-syntax.ts';

type Sources = (id: string) => EmbedSource;

const FENCE = '```';
const GONE = '> This section no longer exists.';
const DENIED = '> You do not have access to this section.';

function frontMatter(page: Page): string[] {
  const filed = page.frontmatter;
  const shown: (readonly [string, unknown])[] = [
    ['title', page.title],
    ['jd_id', filed['jd_id']],
    ['category', filed['jd_category']],
    ['area', page.jdArea],
    ['version', page.version],
    ['owner', filed['owner']],
    ['tags', filed['tags']],
    ['verified_by', filed['verified_by']],
    ['verified_until', filed['verified_until']],
  ];
  const empty = (value: unknown) =>
    value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  const lines = shown
    .filter(([, value]) => !empty(value))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return ['---', ...lines, '---', ''];
}

function headingOf(line: string): { readonly level: number; readonly text: string } | null {
  const marks = line.length - line.trimStart().length === 0 ? line.split(' ')[0] : undefined;
  if (marks === undefined || marks === '' || marks.length > 6) return null;
  if (marks !== '#'.repeat(marks.length)) return null;
  return { level: marks.length, text: line.slice(marks.length).trim() };
}

type Heading = { readonly level: number; readonly text: string };

function headingsIn(lines: readonly string[]): (Heading | null)[] {
  let fenced = false;
  return lines.map((line) => {
    if (line.startsWith(FENCE)) fenced = !fenced;
    return fenced ? null : headingOf(line);
  });
}

function sectionOf(bodyMd: string, fragment: string | null): string | null {
  if (fragment === null) return bodyMd.trim();
  const lines = bodyMd.split('\n');
  const headings = headingsIn(lines);
  const slugger = new GithubSlugger();
  const from = headings.findIndex(
    (heading) => heading !== null && slugger.slug(heading.text) === fragment,
  );
  const level = headings.at(from)?.level;
  if (from < 0 || level === undefined) return null;
  const next = headings.findIndex(
    (heading, index) => index > from && heading !== null && heading.level <= level,
  );
  return lines
    .slice(from, next < 0 ? undefined : next)
    .join('\n')
    .trim();
}

function embedOn(line: string): { readonly id: string; readonly fragment: string | null } | null {
  const trimmed = line.trim();
  const open = trimmed.indexOf('](');
  if (!trimmed.startsWith('![') || !trimmed.endsWith(')') || open < 0) return null;
  return pageAddress(trimmed.slice(open + 2, -1));
}

const DEEPEST_EMBED = 2;

type Walk = {
  readonly sources: Sources;
  readonly depth: number;
  readonly seen: ReadonlySet<string>;
};

function written(address: { id: string; fragment: string | null }, walk: Walk): string {
  const source = walk.sources(address.id);
  if (source.kind === 'denied') return DENIED;
  if (source.kind === 'missing') return GONE;
  const link = `[${source.title}](/pages/${address.id})`;
  if (walk.depth >= DEEPEST_EMBED || walk.seen.has(address.id)) return `See ${link}.`;
  const section = sectionOf(source.bodyMd, address.fragment);
  if (section === null) return GONE;
  const inner = { ...walk, depth: walk.depth + 1, seen: new Set([...walk.seen, address.id]) };
  return `**From ${source.title}:**\n\n${expanded(section, inner)}`;
}

function expanded(bodyMd: string, walk: Walk): string {
  let fenced = false;
  return bodyMd
    .split('\n')
    .map((line) => {
      if (line.startsWith(FENCE)) fenced = !fenced;
      const address = fenced ? null : embedOn(line);
      return address === null ? line : written(address, walk);
    })
    .join('\n');
}

export function exportMarkdown(page: Page, sources: Sources): string {
  const body = expanded(page.bodyMd, { sources, depth: 0, seen: new Set([page.id]) });
  return `${[...frontMatter(page), body].join('\n').trimEnd()}\n`;
}
