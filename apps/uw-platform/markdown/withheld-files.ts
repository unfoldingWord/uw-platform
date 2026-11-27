export const withheldFileNotice = 'A file not cleared for this channel was left out.';

const FILE_LINK =
  /!?\[[^\]\n]*\]\(\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

export function withoutFiles(markdown: string, hidden: ReadonlySet<string>): string {
  if (hidden.size === 0) return markdown;
  return markdown.replaceAll(FILE_LINK, (link: string, id: string) =>
    hidden.has(id) ? `*${withheldFileNotice}*` : link,
  );
}
